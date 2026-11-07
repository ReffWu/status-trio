// SPDX-License-Identifier: Apache-2.0
// Cairo port of Sources/StatusTrioCore/UI/Icon/StatusIconRenderer.swift.
//
// Vector parts (ring, gap bolt, volume dots/arc) are drawn from the shared
// geometry. Every SF Symbol the macOS renderer draws (Wi-Fi levels, slash,
// exclamation, hotspot, plug, Bluetooth devices, …) is composited from an
// alpha mask exported by that renderer itself (tools/export-assets.md), so
// shape, weight and hierarchical layer opacity are the originals; only the
// tint is applied here.

import Cairo from 'cairo';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';

import * as G from './geometry.js';
import {automaticHighlight, blendRGB, boltHighlight, drawEffect, effectFrame} from './effects.js';

export const FONT_FAMILY = 'SF Pro Rounded, Nunito, Adwaita Sans';
const DEFAULT_TEXT_SCALE = 1.8;
const ASSET_WIFI_SCALE = 1.6; // centre masks are exported at the default Wi-Fi size

/** Status colours sampled from the macOS renderer's output (light / dark menu bar). */
export const PALETTES = {
    light: {
        fg: [0, 0, 0], powered: [52, 199, 89], critical: [255, 84, 62], lowPower: [255, 204, 0],
        highPower: [0, 122, 255], bluetooth: [0, 125, 214],
    },
    dark: {
        fg: [1, 1, 1].map(v => v * 255), powered: [48, 209, 88], critical: [255, 84, 62], lowPower: [255, 214, 0],
        highPower: [10, 132, 255], bluetooth: [92, 180, 255],
    },
};

const rgba = (c, a = 1) => [c[0] / 255, c[1] / 255, c[2] / 255, a];

function colorFor(role, palette) {
    switch (role) {
    case 'inactive': return rgba(palette.fg, G.INACTIVE_TRACK_ALPHA);
    case 'critical': case 'lowPower': case 'highPower': case 'powered': case 'bluetooth':
        return rgba(palette[role]);
    default: return rgba(palette.fg);
    }
}

function setColor(cr, c) {
    cr.setSourceRGBA(c[0], c[1], c[2], c[3]);
}

function tracePath(cr, path) {
    for (const c of path) {
        switch (c[0]) {
        case 'M': cr.moveTo(c[1], c[2]); break;
        case 'L': cr.lineTo(c[1], c[2]); break;
        case 'Q': {
            // Cairo has no quadratic curve: elevate to cubic.
            const [x0, y0] = cr.hasCurrentPoint() ? cr.getCurrentPoint() : [c[3], c[4]];
            cr.curveTo(x0 + 2 / 3 * (c[1] - x0), y0 + 2 / 3 * (c[2] - y0),
                c[3] + 2 / 3 * (c[1] - c[3]), c[4] + 2 / 3 * (c[2] - c[4]), c[3], c[4]);
            break;
        }
        case 'C': cr.curveTo(c[1], c[2], c[3], c[4], c[5], c[6]); break;
        case 'A': cr.arc(c[1], c[2], c[3], c[4], c[5]); break;
        case 'N': cr.arcNegative(c[1], c[2], c[3], c[4], c[5]); break;
        case 'Z': cr.closePath(); break;
        }
    }
}

// --- Text -------------------------------------------------------------------

const _layoutCache = new Map();

function textLayout(cr, text, fontSize, weight = 'Bold') {
    const layout = PangoCairo.create_layout(cr);
    const ctx = layout.get_context();
    ctx.set_round_glyph_positions(false);
    const desc = Pango.FontDescription.from_string(`${FONT_FAMILY} ${weight}`);
    desc.set_absolute_size(fontSize * Pango.SCALE);
    layout.set_font_description(desc);
    const attrs = new Pango.AttrList();
    attrs.insert(Pango.attr_letter_spacing_new(Math.round(-0.04 * fontSize * Pango.SCALE)));
    attrs.insert(Pango.attr_font_features_new('tnum'));
    layout.set_attributes(attrs);
    layout.set_text(text, -1);
    return layout;
}

/** Ink height of "100" at `fontSize` — the reference every top-gap glyph is sized from. */
function digitInkHeight(cr, fontSize) {
    const key = `100@${fontSize}`;
    if (!_layoutCache.has(key)) {
        const [ink] = textLayout(cr, '100', fontSize).get_extents();
        _layoutCache.set(key, ink.height / Pango.SCALE);
    }
    return _layoutCache.get(key);
}

function batteryValueFontSize(scale) {
    return G.BATTERY_VALUE_BASE_FONT_SIZE * scale;
}

function boltScaleForText(cr, textScale) {
    const target = digitInkHeight(cr, batteryValueFontSize(textScale)) * G.BATTERY_CHARGING_BOLT_CALIBRATION;
    return target > 0 ? target / G.BOLT_BOUNDS.height
        : textScale / DEFAULT_TEXT_SCALE * G.BATTERY_CHARGING_BOLT_CALIBRATION;
}

/** Top-gap text: centred on the typographic width, on the calibrated baseline. */
function drawGapText(cr, text, color, fontSize) {
    const layout = textLayout(cr, text, fontSize);
    const [, logical] = layout.get_extents();
    // CoreText's width includes the trailing kern; Pango splits letter spacing
    // half before / half after each glyph, so its logical box is already centred.
    const width = logical.width / Pango.SCALE;
    const baseline = layout.get_baseline() / Pango.SCALE;
    const [bx, by] = G.batteryValueBaseline(fontSize);
    cr.save();
    setColor(cr, color);
    cr.moveTo(bx - width / 2 - logical.x / Pango.SCALE, by - baseline);
    PangoCairo.show_layout(cr, layout);
    cr.restore();
}

/** Centre-slot text: its visible ink centre lands on the slot anchor. */
function drawCenterText(cr, text, color, fontSize) {
    const layout = textLayout(cr, text, fontSize);
    const [ink] = layout.get_extents();
    const cx = (ink.x + ink.width / 2) / Pango.SCALE;
    const cy = (ink.y + ink.height / 2) / Pango.SCALE;
    cr.save();
    setColor(cr, color);
    cr.moveTo(G.CENTER_ANCHOR[0] - cx, G.CENTER_ANCHOR[1] - cy);
    PangoCairo.show_layout(cr, layout);
    cr.restore();
}

// --- Masks ------------------------------------------------------------------

/**
 * Composites an exported mask. `entry` = {surface, x, y, w, h, px} in canvas
 * units; `scale` rescales it around `pivot` (the Wi-Fi size control).
 */
function drawMask(cr, entry, color, {scale = 1, pivot = G.CENTER_ANCHOR, offset = [0, 0]} = {}) {
    if (!entry)
        return false;
    cr.save();
    cr.translate(pivot[0] + offset[0], pivot[1] + offset[1]);
    cr.scale(scale, scale);
    cr.translate(-pivot[0], -pivot[1]);
    cr.translate(entry.x, entry.y);
    cr.scale(1 / entry.px, 1 / entry.px);
    setColor(cr, color);
    const pattern = new Cairo.SurfacePattern(entry.surface);
    pattern.setFilter(Cairo.Filter.GOOD);
    cr.mask(pattern);
    cr.restore();
    return true;
}

// --- Scene ------------------------------------------------------------------

/**
 * Draws `scene` into a `size` x `size` square at the current origin.
 * @param {object} assets  {icon: {name: maskEntry}}
 * @param {object} [phase] charging effect phase from ChargingClock.phase()
 */
export function drawScene(cr, scene, size, palette, assets, phase = null) {
    cr.save();
    cr.scale(size / G.CANVAS, size / G.CANVAS);
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setLineJoin(Cairo.LineJoin.ROUND);
    if (scene.ring)
        drawRing(cr, scene.ring, palette, assets, phase);
    if (scene.center)
        drawCenter(cr, scene.center, palette, assets);
    if (scene.footer)
        drawFooter(cr, scene.footer, palette);
    cr.restore();
}

function strokeSegments(cr, segments) {
    for (const [a0, a1] of segments) {
        cr.newSubPath();
        cr.arc(G.ARTWORK_CENTER_X, G.BATTERY_CENTER_Y, G.BATTERY_RADIUS, a0, a1);
    }
    cr.stroke();
}

function drawRing(cr, ring, palette, assets, phase) {
    const hasGap = ring.gap !== 'closed';
    const gapWidth = ring.gap === 'indicator' ? G.BATTERY_CHARGING_BOLT_TOP_GAP_WIDTH : G.BATTERY_VALUE_TOP_GAP_WIDTH;
    const lineWidth = 8 * ring.strokeScale;
    const progress = ring.splitProgress ? G.splitFillProgress(ring.progress, hasGap, gapWidth) : ring.progress;
    const arcColor = colorFor(ring.color, palette);

    cr.setLineWidth(lineWidth);
    setColor(cr, colorFor('inactive', palette));
    strokeSegments(cr, G.batteryArcSegments(0, 1, hasGap, gapWidth));

    setColor(cr, arcColor);
    strokeSegments(cr, G.batteryArcSegments(0, progress, hasGap, gapWidth));

    const frame = ring.effect && phase ? effectFrame(progress, phase, hasGap, gapWidth) : null;
    const highlight = frame ? automaticHighlight(arcColor.slice(0, 3)) : null;
    if (frame)
        drawEffect(cr, frame, highlight, lineWidth, hasGap, gapWidth);

    const acc = ring.accessory;
    if (!acc)
        return;
    const accColor = colorFor(acc.color, palette);
    if (acc.kind === 'text') {
        drawGapText(cr, acc.text, accColor, batteryValueFontSize(acc.scale));
    } else if (acc.kind === 'bolt') {
        const scale = boltScaleForText(cr, acc.scale);
        let bolt = G.scaledBolt(scale);
        let color = accColor;
        if (frame && ring.effect.pulsesAccessory) {
            bolt = G.heartbeatBolt(bolt, frame.boltScale);
            const base = accColor.slice(0, 3);
            const target = ring.effect.tintsAccessory ? boltHighlight(arcColor.slice(0, 3), highlight) : base;
            color = [...blendRGB(base, target, frame.boltArcColorAmount), accColor[3]];
        }
        cr.save();
        setColor(cr, color);
        tracePath(cr, bolt);
        cr.fill();
        cr.restore();
    } else if (acc.kind === 'plug') {
        // The mask was exported at the default text scale; follow other scales.
        const scale = boltScaleForText(cr, acc.scale) / boltScaleForText(cr, DEFAULT_TEXT_SCALE);
        const pivot = G.batteryTopIndicatorCenter(boltScaleForText(cr, DEFAULT_TEXT_SCALE));
        drawMask(cr, assets.icon['gap-plug'], accColor, {scale, pivot});
    }
}

function drawCenter(cr, center, palette, assets) {
    const color = colorFor(center.color, palette);
    const scale = (center.scale ?? ASSET_WIFI_SCALE) / ASSET_WIFI_SCALE;
    const icon = assets.icon;
    switch (center.kind) {
    case 'text':
        drawCenterText(cr, center.text, color,
            G.CENTER_SYMBOL_BASE_POINT_SIZE * center.scale * G.CENTER_TEXT_BASELINE_FACTOR);
        return;
    case 'wifi':
        drawMask(cr, icon[`wifi-${Math.max(0, Math.min(3, center.bars))}`], color, {scale});
        return;
    case 'wifiSlash': drawMask(cr, icon['wifi-slash'], color, {scale}); return;
    case 'wifiExclamation': drawMask(cr, icon['wifi-exclamation'], color, {scale}); return;
    case 'hotspot': drawMask(cr, icon['hotspot'], color, {scale}); return;
    case 'screenWedge': drawMask(cr, icon['screen-wedge'], color, {scale}); return;
    case 'arrowWedge': drawMask(cr, icon['arrow-wedge'], color, {scale}); return;
    case 'ethernet': drawMask(cr, icon['ethernet'], color); return;
    case 'bolt': drawMask(cr, icon['center-bolt'], color, {scale}); return;
    case 'plug': drawMask(cr, icon['center-plug'], color, {scale}); return;
    case 'icon': {
        // Bluetooth devices and the keyboard use the SF Symbol masks when one
        // exists; themed icons are drawn by the indicator on top of the canvas.
        const entry = icon[center.iconName];
        if (entry)
            drawMask(cr, entry, color, {scale: (center.scale ?? ASSET_WIFI_SCALE) / ASSET_WIFI_SCALE});
    }
    }
}

function drawFooter(cr, footer, palette) {
    const inactive = colorFor('inactive', palette);
    const active = colorFor(footer.color, palette);
    if (footer.kind === 'dots') {
        const radius = G.VOLUME_DOT_RADIUS * (1 + (footer.strokeScale - 1) * 0.5);
        G.VOLUME_DOTS.slice(0, footer.count).forEach(([x, y], i) => {
            setColor(cr, i < footer.active ? active : inactive);
            cr.newSubPath();
            cr.arc(x, y, radius, 0, 2 * Math.PI);
            cr.fill();
        });
        return;
    }
    const [cx, cy] = G.BATTERY_CENTER;
    cr.setLineWidth(7 * footer.strokeScale);
    setColor(cr, inactive);
    cr.newSubPath();
    cr.arcNegative(cx, cy, G.BATTERY_RADIUS, G.VOLUME_ARC_START, G.VOLUME_ARC_END);
    cr.stroke();
    const p = Math.min(1, Math.max(0, footer.progress));
    if (p > 0) {
        setColor(cr, active);
        cr.newSubPath();
        cr.arcNegative(cx, cy, G.BATTERY_RADIUS, G.VOLUME_ARC_START,
            G.VOLUME_ARC_START - (G.VOLUME_ARC_START - G.VOLUME_ARC_END) * p);
        cr.stroke();
    }
}

// --- Assets -----------------------------------------------------------------

/** Loads `assets/icon/*.png` + manifest.json into mask entries. */
export function loadIconAssets(dirPath, readText) {
    const manifest = JSON.parse(readText(`${dirPath}/manifest.json`));
    const out = {};
    for (const [name, m] of Object.entries(manifest))
        out[name] = {...m, surface: Cairo.ImageSurface.createFromPNG(`${dirPath}/${name}.png`)};
    return out;
}
