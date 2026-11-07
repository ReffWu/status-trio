// SPDX-License-Identifier: Apache-2.0
// Port of Sources/StatusTrioCore/UI/Icon/StatusIconGeometry.swift.
//
// Every coordinate lives on the macOS app's 120 x 120 canvas, y pointing down
// (the Swift renderer flips its CGContext to the same orientation), so values
// are copied verbatim and Cairo's `arc()` / `arc_negative()` map 1:1 onto
// CoreGraphics' `clockwise: false` / `clockwise: true`.

const DEG = Math.PI / 180;

export const CANVAS = 120;
export const ARTWORK_CENTER_X = 59.5;

export const BATTERY_RADIUS = 51.5;
export const BATTERY_CENTER_Y = 61.48715261785473;
export const BATTERY_CENTER = [ARTWORK_CENTER_X, BATTERY_CENTER_Y];
const BATTERY_START = 148.69008689281117 * DEG;
const BATTERY_SWEEP = 242.6198262143777 * DEG;

export const BATTERY_VALUE_TOP_GAP_WIDTH = 64;
export const BATTERY_CHARGING_BOLT_TOP_GAP_WIDTH = 50;
export const BATTERY_VALUE_BASE_FONT_SIZE = 20;
export const BATTERY_CHARGING_BOLT_CALIBRATION = 220 / 180;
export const BATTERY_PLUG_HEIGHT_SCALE = 1.2;
export const BATTERY_CHARGING_BOLT_PIVOT = [ARTWORK_CENTER_X, 2.1];

/** Centre slot anchor shared by every middle glyph (StatusIconRenderer.centerAnchor). */
export const CENTER_ANCHOR = [ARTWORK_CENTER_X, BATTERY_CENTER_Y];
export const CENTER_SYMBOL_BASE_POINT_SIZE = 38;
export const CENTER_TEXT_BASELINE_FACTOR = 0.9;
export const CENTER_CHARGING_GLYPH_HEIGHT_FACTOR = 0.8;

/** Unified optical alpha for inactive tracks (ring groove, muted Wi-Fi, hidden dots). */
export const INACTIVE_TRACK_ALPHA = 0.22;

export const VOLUME_DOTS = [[33, 104.2], [50.5, 111.2], [68.5, 111.7], [86, 105.8]];
export const VOLUME_DOT_RADIUS = 5.5;
export const VOLUME_ARC_START = 121.82 * DEG;
export const VOLUME_ARC_END = 59.12 * DEG;

export const ETHERNET_STROKE_WIDTH = 4.886659979939819;
export const ETHERNET_DOT_RADIUS = 2.4433299899699095;

const clampUnit = v => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

export function batteryValueBaseline(fontSize) {
    const slope = (24 - 17) / (32 - 20);
    return [ARTWORK_CENTER_X, 17 + (fontSize - 20) * slope];
}

function batteryGapFraction(gapWidth) {
    if (!(gapWidth > 0))
        return 0;
    return Math.min(1, Math.max(0, gapWidth / (BATTERY_RADIUS * BATTERY_SWEEP)));
}

/**
 * Battery arc segments (progress space, 0…1) as [startAngle, endAngle] pairs.
 * Progress that falls inside the top gap is intentionally absent.
 */
export function batteryArcSegments(from, to, hasTopGap, gapWidth) {
    const start = clampUnit(from);
    const end = clampUnit(to);
    if (!(end > start))
        return [];
    const angle = p => BATTERY_START + BATTERY_SWEEP * p;
    if (!hasTopGap)
        return [[angle(start), angle(end)]];
    const gap = batteryGapFraction(gapWidth);
    const gapStart = (1 - gap) / 2;
    const gapEnd = gapStart + gap;
    const out = [];
    const firstEnd = Math.min(end, gapStart);
    if (firstEnd > start)
        out.push([angle(start), angle(firstEnd)]);
    const secondStart = Math.max(start, gapEnd);
    if (end > secondStart)
        out.push([angle(secondStart), angle(end)]);
    return out;
}

export function visibleFraction(progress, hasTopGap, gapWidth) {
    const p = clampUnit(progress);
    if (!hasTopGap)
        return p;
    const gap = batteryGapFraction(gapWidth);
    const gapStart = (1 - gap) / 2;
    if (p <= gapStart)
        return p;
    if (p >= gapStart + gap)
        return p - gap;
    return gapStart;
}

export function progressForVisibleFraction(fraction, hasTopGap, gapWidth) {
    const f = clampUnit(fraction);
    if (!hasTopGap)
        return f;
    const gap = batteryGapFraction(gapWidth);
    const visible = 1 - gap;
    if (!(visible > 0))
        return 0;
    const v = Math.min(visible, f);
    return v <= visible / 2 ? v : v + gap;
}

/** `.split` gap mode (#205): the visible arc spans the whole 0–100 % scale. */
export function splitFillProgress(progress, hasTopGap, gapWidth) {
    const p = clampUnit(progress);
    if (!hasTopGap)
        return p;
    return progressForVisibleFraction(p * visibleFraction(1, true, gapWidth), true, gapWidth);
}

export function lastVisibleProgress(progress, hasTopGap, gapWidth) {
    const p = clampUnit(progress);
    if (!hasTopGap)
        return p;
    const gap = batteryGapFraction(gapWidth);
    const gapStart = (1 - gap) / 2;
    return p > gapStart && p < gapStart + gap ? gapStart : p;
}

export function batteryPoint(progress) {
    const a = BATTERY_START + BATTERY_SWEEP * clampUnit(progress);
    return [ARTWORK_CENTER_X + BATTERY_RADIUS * Math.cos(a), BATTERY_CENTER_Y + BATTERY_RADIUS * Math.sin(a)];
}

export function batteryAngle(progress) {
    return BATTERY_START + BATTERY_SWEEP * clampUnit(progress);
}

// ---------------------------------------------------------------------------
// Path primitives. A path is a list of commands understood by renderer.js:
//   ['M', x, y] ['L', x, y] ['Q', cx, cy, x, y] ['C', c1x, c1y, c2x, c2y, x, y]
//   ['A', cx, cy, r, a0, a1] (increasing angle) ['N', cx, cy, r, a0, a1] (decreasing) ['Z']

/** The charging bolt, verbatim from status-menubar.svg. */
export const BOLT = [
    ['M', 62.1, 2.2], ['Q', 62.8, 2.5, 62.6, 3.3], ['L', 61.2, 7.8], ['L', 65.9, 7.8],
    ['Q', 66.9, 7.8, 67.3, 8.6], ['Q', 67.6, 9.3, 67, 10], ['L', 57, 21.3],
    ['Q', 56.4, 22, 55.6, 21.6], ['Q', 55, 21.3, 55.3, 20.5], ['L', 57.4, 14.1],
    ['L', 52.9, 14.1], ['Q', 52, 14.1, 51.6, 13.3], ['Q', 51.3, 12.6, 51.9, 12],
    ['L', 61.1, 2.7], ['Q', 61.6, 2.1, 62.1, 2.2], ['Z'],
];

/** Tight ink bounds of a command path (curves sampled), like CGPath.boundingBoxOfPath. */
export function pathBounds(path) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const add = (x, y) => {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    };
    let px = 0, py = 0;
    for (const c of path) {
        switch (c[0]) {
        case 'M': case 'L':
            [px, py] = [c[1], c[2]]; add(px, py); break;
        case 'Q':
            for (let t = 0.05; t <= 1.0001; t += 0.05) {
                const u = 1 - t;
                add(u * u * px + 2 * u * t * c[1] + t * t * c[3], u * u * py + 2 * u * t * c[2] + t * t * c[4]);
            }
            [px, py] = [c[3], c[4]]; break;
        case 'C':
            for (let t = 0.05; t <= 1.0001; t += 0.05) {
                const u = 1 - t;
                add(u ** 3 * px + 3 * u * u * t * c[1] + 3 * u * t * t * c[3] + t ** 3 * c[5],
                    u ** 3 * py + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t ** 3 * c[6]);
            }
            [px, py] = [c[5], c[6]]; break;
        case 'A': case 'N': {
            const [, cx, cy, r, a0, a1] = c;
            for (let i = 0; i <= 32; i++) {
                const a = a0 + (a1 - a0) * i / 32;
                add(cx + r * Math.cos(a), cy + r * Math.sin(a));
            }
            [px, py] = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)];
            break;
        }
        }
    }
    return {x: minX, y: minY, width: maxX - minX, height: maxY - minY,
        midX: (minX + maxX) / 2, midY: (minY + maxY) / 2};
}

/** Affine map of a command path: x' = a*x + tx, y' = d*y + ty (uniform for arcs). */
export function transformPath(path, a, d, tx, ty) {
    return path.map(c => {
        switch (c[0]) {
        case 'M': case 'L': return [c[0], a * c[1] + tx, d * c[2] + ty];
        case 'Q': return ['Q', a * c[1] + tx, d * c[2] + ty, a * c[3] + tx, d * c[4] + ty];
        case 'C': return ['C', a * c[1] + tx, d * c[2] + ty, a * c[3] + tx, d * c[4] + ty, a * c[5] + tx, d * c[6] + ty];
        case 'A': case 'N': return [c[0], a * c[1] + tx, d * c[2] + ty, c[3] * a, c[4], c[5]];
        default: return c;
        }
    });
}

export const BOLT_BOUNDS = pathBounds(BOLT);

/** Bolt scaled about its tip pivot (StatusIconGeometry.batteryChargingBolt(scale:)). */
export function scaledBolt(scale) {
    if (!(scale > 0) || scale === 1)
        return BOLT;
    const [px, py] = BATTERY_CHARGING_BOLT_PIVOT;
    return transformPath(BOLT, scale, scale, px * (1 - scale), py * (1 - scale));
}

/** Heartbeat scale around the bolt's own centre, clamped to the canvas vertically. */
export function heartbeatBolt(base, scale) {
    if (!(scale > 0) || scale === 1)
        return base;
    const b = pathBounds(base);
    const vs = Math.min(scale, Math.min(b.midY / (b.midY - b.y), (CANVAS - b.midY) / (b.y + b.height - b.midY)));
    return transformPath(base, scale, vs, b.midX * (1 - scale), b.midY * (1 - vs));
}

export function boltCenteredAt(target, targetHeight) {
    const b = BOLT_BOUNDS;
    const s = targetHeight / b.height;
    return transformPath(BOLT, s, s, target[0] - b.midX * s, target[1] - b.midY * s);
}

export function batteryTopIndicatorCenter(boltScale) {
    const b = BOLT_BOUNDS;
    const [px, py] = BATTERY_CHARGING_BOLT_PIVOT;
    return [px + (b.midX - px) * boltScale, py + (b.midY - py) * boltScale];
}

// Wi-Fi glyph — the status-menubar.svg artwork (outer r31, middle r18.5, fan
// dot) that the SF "wifi" symbol replaced on macOS. Calibrated in renderer.js
// to the SF symbol's optical size so the slot reads identically.
export const WIFI_OUTER = ['A', ARTWORK_CENTER_X, 78.3, 31, 227.35 * DEG, 312.65 * DEG];
export const WIFI_MIDDLE = ['A', ARTWORK_CENTER_X, 78.89, 18.5, 227.5 * DEG, 312.5 * DEG];
export const WIFI_DOT = [
    ['M', ARTWORK_CENTER_X, 69.9],
    ['C', 61.0, 69.9, 65.2, 70.8, 66.5, 73],
    ['C', 66.7, 73.8, 66.7, 74.3, 66.5, 75],
    ['C', 63.8, 78.8, 61.15, 80.95, ARTWORK_CENTER_X, 80.95],
    ['C', 57.85, 80.95, 55.2, 78.8, 52.5, 75],
    ['C', 52.3, 74.3, 52.3, 73.8, 52.5, 73],
    ['C', 53.8, 70.8, 58.0, 69.9, ARTWORK_CENTER_X, 69.9],
    ['Z'],
];
export const WIFI_STROKE = 7;

// Ethernet chevrons and dots, mapped from their 200-unit source artwork.
const ETH_SRC = {x: 56.132, y: 75.812, w: 87.736, h: 46.376};
const ETH_DST = {x: 31.5, y: 51.19959879638917, w: 56, h: 29.60080240722166};
const ethPoint = (x, y) => [
    ETH_DST.x + (x - ETH_SRC.x) * ETH_DST.w / ETH_SRC.w,
    ETH_DST.y + (y - ETH_SRC.y) * ETH_DST.h / ETH_SRC.h,
];
const polyline = pts => pts.map((p, i) => [i ? 'L' : 'M', ...ethPoint(...p)]);
export const ETHERNET_CHEVRONS = [
    polyline([[79.32, 79.64], [59.96, 99], [79.32, 118.36]]),
    polyline([[120.68, 79.64], [140.04, 99], [120.68, 118.36]]),
];
export const ETHERNET_DOTS = [ethPoint(84.688, 99), ethPoint(100, 99), ethPoint(115.312, 99)];

export const TEMPORARY_WEDGE = [WIFI_OUTER, ['L', ARTWORK_CENTER_X, 77.45], ['Z']];
export const SHARED_ARROW_CUTOUT = [
    ['M', ARTWORK_CENTER_X, 51.5], ['L', 67.5, 59.5], ['L', 63, 59.5], ['L', 63, 72.5],
    ['L', 56, 72.5], ['L', 56, 59.5], ['L', 51.5, 59.5], ['Z'],
];
export const TEMPORARY_SCREEN = {x: 50.5, y: 53.5, w: 18, h: 12, r: 2.5};
export const TEMPORARY_STAND = [
    ['M', 57.5, 65.5], ['L', 61.5, 65.5], ['L', 61.5, 67.5], ['L', 63, 67.5], ['L', 63, 70.5],
    ['L', 56, 70.5], ['L', 56, 67.5], ['L', 57.5, 67.5], ['Z'],
];
