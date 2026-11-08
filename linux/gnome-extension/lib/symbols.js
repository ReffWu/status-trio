// SPDX-License-Identifier: Apache-2.0
// SF Symbol glyphs for the popup panel. Each mask was rendered by AppKit at the
// exact point size and weight the macOS panel uses (see LinuxAssetExportTests),
// monochrome, with the symbol's full layout box so centring matches SwiftUI.
// The tint is the widget's CSS `color`, so stylesheets drive it like St.Icon.

import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import {typeName} from './gtype.js';

let _panel = null;

export function loadPanelSymbols(dir) {
    const [, bytes] = GLib.file_get_contents(`${dir}/manifest.json`);
    _panel = {dir, manifest: JSON.parse(new TextDecoder().decode(bytes)), surfaces: new Map()};
}

export function unloadPanelSymbols() {
    _panel = null;
}

const FALLBACKS = {'battery.slash': 'battery.0'};

function entry(symbol, style) {
    if (!_panel)
        return null;
    for (const name of [symbol, FALLBACKS[symbol]]) {
        const key = `${name}~${style}`;
        const meta = name && _panel.manifest[key];
        if (meta) {
            if (!_panel.surfaces.has(key))
                _panel.surfaces.set(key, Cairo.ImageSurface.createFromPNG(`${_panel.dir}/${key}.png`));
            return {meta, surface: _panel.surfaces.get(key)};
        }
    }
    return null;
}

/** Layout box of a symbol in points (= logical pixels), or [0, 0]. */
export function symbolSize(symbol, style) {
    const e = entry(symbol, style);
    return e ? [e.meta.w, e.meta.h] : [0, 0];
}

/**
 * Draws `symbol` in `style` centred in its allocation, the way SwiftUI centres
 * `Image(systemName:)` in a frame. Without an explicit width/height the actor
 * takes the symbol's natural layout box, like an unframed SwiftUI Image.
 * With `ink: true` the glyph's ink is centred instead: SF Symbols' layout boxes
 * are not symmetric about the glyph (Wi-Fi's ink is 1.33 pt from the left edge
 * and 2 pt from the right), which shows inside a circle.
 */
export const Symbol = GObject.registerClass({GTypeName: typeName('Symbol')},
class Symbol extends St.DrawingArea {
    _init({symbol = '', style = 'action', ink = false, ...params} = {}) {
        super._init({y_align: Clutter.ActorAlign.CENTER, ...params});
        this._symbol = symbol;
        this._style = style;
        this._ink = ink;
    }

    get symbol() {
        return this._symbol;
    }

    set symbol(v) {
        if (this._symbol === v)
            return;
        this._symbol = v;
        this.queue_relayout();
        this.queue_repaint();
    }

    get style_name() {
        return this._style;
    }

    set style_name(v) {
        this._style = v;
        this.queue_relayout();
        this.queue_repaint();
    }

    _scale() {
        return St.ThemeContext.get_for_stage(global.stage).scale_factor;
    }

    vfunc_get_preferred_width(_forHeight) {
        const w = Math.ceil(symbolSize(this._symbol, this._style)[0] * this._scale());
        return [w, w];
    }

    vfunc_get_preferred_height(_forWidth) {
        const h = Math.ceil(symbolSize(this._symbol, this._style)[1] * this._scale());
        return [h, h];
    }

    vfunc_repaint() {
        const cr = this.get_context();
        const e = entry(this._symbol, this._style);
        if (e) {
            const [w, h] = this.get_surface_size();
            const [aw] = this.get_size();
            // Canvas pixels per logical pixel (resource scale × theme scale).
            const k = (aw > 0 ? w / aw : 1) * this._scale();
            const dw = e.meta.w * k, dh = e.meta.h * k;
            const c = this.get_theme_node().get_foreground_color();
            const m = e.meta;
            if (this._ink && m.iw)
                cr.translate(w / 2 - (m.ix + m.iw / 2) * k, h / 2 - (m.iy + m.ih / 2) * k);
            else
                cr.translate((w - dw) / 2, (h - dh) / 2);
            cr.scale(k / e.meta.px, k / e.meta.px);
            cr.setSourceRGBA(c.red / 255, c.green / 255, c.blue / 255, c.alpha / 255);
            const pattern = new Cairo.SurfacePattern(e.surface);
            pattern.setFilter(Cairo.Filter.GOOD);
            cr.mask(pattern);
        }
        cr.$dispose();
    }
});
