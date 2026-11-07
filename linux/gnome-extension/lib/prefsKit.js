// SPDX-License-Identifier: Apache-2.0
// GTK 4 building blocks for the preferences window, one per SwiftUI component
// in Sources/StatusTrioCore/UI/Settings/SettingsChrome.swift. Tiles and SF
// Symbol masks come from assets/prefs (LinuxPrefsAssetExportTests).

import Cairo from 'cairo';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {typeName} from './gtype.js';

const ASSET_SCALE = 3;
let _dir = null;
let _masks = {};
const _surfaces = new Map();

export function initKit(dir) {
    _dir = `${dir}/assets/prefs`;
    const [, bytes] = GLib.file_get_contents(`${_dir}/masks.json`);
    _masks = JSON.parse(new TextDecoder().decode(bytes));
}

function surface(file) {
    let s = _surfaces.get(file);
    if (!s) {
        s = Cairo.ImageSurface.createFromPNG(`${_dir}/${file}`);
        _surfaces.set(file, s);
    }
    return s;
}

const CENTER = Gtk.Align.CENTER;

// --- Layout helpers ----------------------------------------------------------

export function box(vertical, spacing = 0, css = [], props = {}) {
    return new Gtk.Box({
        orientation: vertical ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL,
        spacing, css_classes: css, ...props,
    });
}

export function append(parent, ...children) {
    for (const c of children)
        if (c)
            parent.append(c);
    return parent;
}

/** A wrapping label that takes the width it is given instead of asking for it. */
export function label(text, css = [], props = {}) {
    return new Gtk.Label({
        label: text, xalign: 0, wrap: true, wrap_mode: 2 /* WORD_CHAR */,
        max_width_chars: 1, hexpand: true, css_classes: css, ...props,
    });
}

/** A one-line label sized to its text. */
export function text(str, css = [], props = {}) {
    return new Gtk.Label({label: str, xalign: 0, css_classes: css, ...props});
}

export function spacer() {
    return new Gtk.Box({hexpand: true});
}

// --- Images ------------------------------------------------------------------

/** A PNG from assets/prefs drawn at `w` x `h` points. */
export function picture(file, w, h, props = {}) {
    const area = new Gtk.DrawingArea({content_width: w, content_height: h, valign: CENTER, halign: CENTER, ...props});
    area.set_draw_func((_a, cr, aw, ah) => {
        const s = surface(file);
        cr.scale(aw / s.getWidth(), ah / s.getHeight());
        cr.setSourceSurface(s, 0, 0);
        cr.getSource().setFilter(Cairo.Filter.GOOD);
        cr.paint();
        cr.$dispose();
    });
    return area;
}

/** SettingsIcon: a tinted squircle tile (26 pt in rows, 22 pt in the sidebar). */
export function tile(symbol, tint, size = 26) {
    return picture(`tile-${symbol}-${tint}-${size}.png`, size, size);
}

/**
 * An SF Symbol mask painted in the widget's CSS colour. `rotation` (degrees)
 * turns it about its centre, as SwiftUI's rotationEffect does.
 */
export function glyph(name, css = [], rotation = 0) {
    const m = _masks[name];
    if (!m)
        throw new Error(`no mask ${name}`);
    const side = rotation % 180 ? Math.max(m.width, m.height) : 0;
    const area = new Gtk.DrawingArea({
        content_width: side || m.width, content_height: side || m.height,
        valign: CENTER, halign: CENTER, css_classes: css,
    });
    area._rotation = rotation;
    area.set_draw_func((a, cr, w, h) => {
        const c = a.get_color();
        cr.translate(w / 2, h / 2);
        cr.rotate(a._rotation * Math.PI / 180);
        cr.translate(-m.width / 2, -m.height / 2);
        cr.scale(1 / ASSET_SCALE, 1 / ASSET_SCALE);
        cr.setSourceRGBA(c.red, c.green, c.blue, c.alpha);
        cr.maskSurface(surface(`${name}.png`), 0, 0);
        cr.$dispose();
    });
    return area;
}

// --- Drawn controls ----------------------------------------------------------

function roundedRect(cr, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    cr.newSubPath();
    cr.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
    cr.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
    cr.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
    cr.arc(x + r, y + r, r, Math.PI, 1.5 * Math.PI);
    cr.closePath();
}
export {roundedRect};

const ACCENT = {light: [0, 122 / 255, 1], dark: [10 / 255, 132 / 255, 1]};

function isDark(widget) {
    return !!widget.get_root?.()?.has_css_class?.('dark');
}

function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

/** A Cairo-drawn two-state control with a 150 ms eased transition. */
const Toggle = GObject.registerClass({
    GTypeName: typeName('Toggle'),
    Properties: {
        active: GObject.ParamSpec.boolean('active', null, null, GObject.ParamFlags.READWRITE, false),
    },
}, class Toggle extends Gtk.DrawingArea {
    constructor(w, h, draw) {
        super({content_width: w, content_height: h, valign: CENTER, halign: CENTER, focusable: true});
        this._active = false;
        this._t = 0;
        this._anim = 0;
        this.set_cursor_from_name('default');
        this.set_draw_func((_a, cr, aw, ah) => {
            draw(cr, aw, ah, easeInOut(this._t), isDark(this));
            cr.$dispose();
        });
        const click = new Gtk.GestureClick();
        click.connect('released', () => {
            this.active = !this.active;
        });
        this.add_controller(click);
        const keys = new Gtk.EventControllerKey();
        keys.connect('key-pressed', (_c, keyval) => {
            if (keyval !== 0x20 && keyval !== 0xff0d)
                return false;
            this.active = !this.active;
            return true;
        });
        this.add_controller(keys);
        this.connect('unrealize', () => this._stop());
    }

    get active() {
        return this._active;
    }

    set active(v) {
        v = !!v;
        if (v === this._active)
            return;
        this._active = v;
        this.notify('active');
        this._animate();
    }

    _stop() {
        if (this._anim)
            GLib.source_remove(this._anim);
        this._anim = 0;
    }

    _animate() {
        this._stop();
        const target = this._active ? 1 : 0;
        if (!this.get_mapped()) {
            this._t = target;
            this.queue_draw();
            return;
        }
        const from = this._t;
        const start = GLib.get_monotonic_time();
        this._anim = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
            const k = Math.min(1, (GLib.get_monotonic_time() - start) / 150000);
            this._t = from + (target - from) * k;
            this.queue_draw();
            if (k < 1)
                return GLib.SOURCE_CONTINUE;
            this._anim = 0;
            return GLib.SOURCE_REMOVE;
        });
    }
});

/** NSSwitch (macOS 26): 44 x 20 track, 26 x 16 pill knob. */
export function macSwitch() {
    return new Toggle(44, 20, (cr, w, h, t, dark) => {
        const off = dark ? [1, 1, 1, 0.16] : [0, 0, 0, 0.09];
        const on = [...ACCENT[dark ? 'dark' : 'light'], 1];
        const c = off.map((v, i) => v + (on[i] - v) * t);
        roundedRect(cr, 0, 0, w, h, h / 2);
        cr.setSourceRGBA(...c);
        cr.fill();
        const kw = 26, kh = h - 4;
        const x = 2 + (w - kw - 4) * t;
        roundedRect(cr, x, 2.5, kw, kh, kh / 2);
        cr.setSourceRGBA(0, 0, 0, 0.10);
        cr.fill();
        roundedRect(cr, x, 2, kw, kh, kh / 2);
        cr.setSourceRGBA(1, 1, 1, 1);
        cr.fillPreserve();
        cr.setLineWidth(0.5);
        cr.setSourceRGBA(0, 0, 0, 0.08);
        cr.stroke();
    });
}

/** NSButton checkbox: 14 pt rounded square, white check on the accent. */
export function macCheck() {
    const toggle = new Toggle(14, 14, (cr, w, h, t, dark) => {
        roundedRect(cr, 0.5, 0.5, w - 1, h - 1, 3.5);
        cr.setSourceRGBA(...(dark ? [1, 1, 1, 0.08] : [1, 1, 1, 1]));
        cr.fillPreserve();
        cr.setLineWidth(1);
        cr.setSourceRGBA(...(dark ? [1, 1, 1, 0.22] : [0, 0, 0, 0.22]));
        cr.stroke();
        if (t <= 0)
            return;
        roundedRect(cr, 0, 0, w, h, 3.5);
        cr.setSourceRGBA(...ACCENT[dark ? 'dark' : 'light'], t);
        cr.fill();
        const m = _masks['mask-checkmark-9-bold'];
        cr.translate((w - m.width) / 2, (h - m.height) / 2);
        cr.scale(1 / ASSET_SCALE, 1 / ASSET_SCALE);
        cr.setSourceRGBA(1, 1, 1, t);
        cr.maskSurface(surface('mask-checkmark-9-bold.png'), 0, 0);
    });
    return toggle;
}

// --- Settings bindings ---------------------------------------------------------

/** Calls `fn` now and whenever one of `keys` changes; disconnects with `widget`. */
export function watch(settings, keys, widget, fn) {
    const ids = keys.map(k => settings.connect(`changed::${k}`, fn));
    widget.connect('destroy', () => ids.forEach(id => settings.disconnect(id)));
    fn();
}

export function bindSwitch(settings, key) {
    const sw = macSwitch();
    settings.bind(key, sw, 'active', 0);
    return sw;
}

/** Slider + trailing value label (130 pt slider, 44 pt monospaced value). */
export function slider(settings, key, {min, max, step, get, set, format}) {
    const adj = new Gtk.Adjustment({lower: min, upper: max, step_increment: step, page_increment: step});
    const scale = new Gtk.Scale({adjustment: adj, draw_value: false, width_request: 130, valign: CENTER});
    const value = text('', ['st-value'], {xalign: 1, width_request: 44});
    let syncing = false;
    const sync = () => {
        syncing = true;
        adj.value = get(settings, key);
        value.label = format(adj.value);
        syncing = false;
    };
    adj.connect('value-changed', () => {
        const v = Math.round(adj.value / step) * step;
        value.label = format(v);
        if (!syncing)
            set(settings, key, v);
    });
    const out = append(box(false, 8, [], {valign: CENTER}), scale, value);
    watch(settings, [key], out, sync);
    return out;
}

export const intSlider = (settings, key, min, max, unit) => slider(settings, key, {
    min, max, step: 1,
    get: (s, k) => s.get_int(k), set: (s, k, v) => s.set_int(k, Math.round(v)),
    format: v => `${Math.round(v)}${unit}`,
});

/** Pop-up button with a check-marked menu; `options` is [[nick, label], …]. */
export function popup(settings, key, options) {
    const name = text('', [], {hexpand: true, ellipsize: 3});
    const content = append(box(false, 6), name, glyph('mask-chevron.up.chevron.down-9-bold'));
    const button = new Gtk.MenuButton({child: content, css_classes: ['st-popup'], width_request: 160,
        valign: CENTER, always_show_arrow: false});
    const pop = new Gtk.Popover({has_arrow: false, css_classes: ['st-menu-popover'], position: Gtk.PositionType.BOTTOM});
    const list = box(true, 0);
    const checks = [];
    for (const [nick, title] of options) {
        const check = glyph('mask-checkmark-9-bold');
        checks.push([nick, check]);
        const item = new Gtk.Button({child: append(box(false, 6), check, text(title))});
        item.connect('clicked', () => {
            settings.set_string(key, nick);
            pop.popdown();
        });
        list.append(item);
    }
    pop.set_child(list);
    pop.connect('show', () => pop[isDark(button) ? 'add_css_class' : 'remove_css_class']('dark'));
    button.set_popover(pop);
    watch(settings, [key], button, () => {
        const nick = settings.get_string(key);
        name.label = options.find(o => o[0] === nick)?.[1] ?? '';
        for (const [n, c] of checks)
            c.opacity = n === nick ? 1 : 0;
    });
    return button;
}

/** Value + NSStepper. */
export function stepper(settings, key, min, max) {
    const value = text('', ['st-value'], {xalign: 1, width_request: 22});
    const up = new Gtk.Button({child: glyph('mask-chevron.up-8-bold')});
    const down = new Gtk.Button({child: glyph('mask-chevron.down-8-bold')});
    up.connect('clicked', () => settings.set_int(key, Math.min(max, settings.get_int(key) + 1)));
    down.connect('clicked', () => settings.set_int(key, Math.max(min, settings.get_int(key) - 1)));
    const arrows = append(box(true, 0, ['st-stepper'], {valign: CENTER}), up, down);
    const out = append(box(false, 8, [], {valign: CENTER}), value, arrows);
    watch(settings, [key], out, () => {
        value.label = `${settings.get_int(key)}`;
    });
    return out;
}

// --- Rows and groups -----------------------------------------------------------

/** SettingsRow: tile · title/subtitle · trailing accessory. */
export function row({symbol, tint, leading, title, subtitle, accessory, extra}) {
    const texts = box(true, 2, [], {hexpand: true, valign: CENTER});
    texts.append(label(title, ['st-row-title']));
    if (subtitle)
        texts.append(label(subtitle, ['st-row-subtitle']));
    if (extra)
        texts.append(extra);
    const r = box(false, 12, ['st-row']);
    append(r, leading ?? (symbol ? tile(symbol, tint) : null), texts);
    if (accessory) {
        accessory.valign = CENTER;
        r.append(accessory);
    }
    return r;
}

export function toggleRow(settings, key, opts) {
    return row({...opts, accessory: bindSwitch(settings, key)});
}

export function hintRow(str, symbol = 'mask-info.circle-11-regular') {
    const g = glyph(symbol, ['st-fg2']);
    g.valign = Gtk.Align.START;
    g.margin_top = 1;
    return append(box(false, 6, ['st-hint']), g, label(str));
}

/**
 * SettingsGroup: optional title, a rounded card of rows with SettingsDivider
 * between visible neighbours, optional footnote. A row's `_dividerInset`
 * overrides the default 14 + 26 + 12 pt inset.
 */
export function group(title, rows, footnote) {
    const outer = box(true, 7);
    if (title)
        outer.append(label(title, ['st-group-title']));
    const card = box(true, 0, ['st-card'], {overflow: Gtk.Overflow.HIDDEN});
    const pairs = [];
    for (const r of rows.filter(Boolean)) {
        const divider = box(false, 0, ['st-divider'], {margin_start: r._dividerInset ?? 52});
        card.append(divider);
        card.append(r);
        pairs.push([divider, r]);
    }
    const sync = () => {
        let first = true;
        for (const [d, r] of pairs) {
            d.visible = r.visible && !first;
            if (r.visible)
                first = false;
        }
        outer.visible = pairs.some(([, r]) => r.visible);
    };
    for (const [, r] of pairs)
        r.connect('notify::visible', sync);
    sync();
    outer.append(card);
    if (footnote)
        outer.append(label(footnote, ['st-footnote']));
    return outer;
}

/** Shows `widget` only while `fn()` holds, re-evaluated when `keys` change. */
export function showWhen(settings, keys, widget, fn) {
    watch(settings, keys, widget, () => {
        widget.visible = fn();
    });
    return widget;
}

// --- Picture options (SettingsPictureRow) -----------------------------------------

/**
 * A preview card with SwiftUI's selectionRing: the ring sits `inset` (5 pt)
 * outside the card, a 2.5 pt gap then a 2.5 pt accent stroke.
 */
export function pictureCard(w, h, paint, {corner = 6, expand = false} = {}) {
    const inset = 5;
    const area = new Gtk.DrawingArea({content_width: w + inset * 2, content_height: h + inset * 2,
        hexpand: expand, halign: expand ? Gtk.Align.FILL : CENTER});
    area._selected = false;
    area.set_draw_func((a, cr, aw, ah) => {
        const dark = isDark(a);
        const cw = aw - inset * 2;
        if (a._selected) {
            const r = corner + 2.5 + 1.25;
            roundedRect(cr, 1.25, 1.25, aw - 2.5, ah - 2.5, r);
            cr.setSourceRGBA(...ACCENT[dark ? 'dark' : 'light'], 1);
            cr.setLineWidth(2.5);
            cr.stroke();
        }
        cr.save();
        roundedRect(cr, inset, inset, cw, h, corner);
        cr.clip();
        cr.translate(inset, inset);
        paint(cr, cw, h, dark);
        cr.restore();
        roundedRect(cr, inset + 0.5, inset + 0.5, cw - 1, h - 1, corner);
        cr.setSourceRGBA(...(dark ? [1, 1, 1, 0.12] : [0, 0, 0, 0.12]));
        cr.setLineWidth(1);
        cr.stroke();
        cr.$dispose();
    });
    return area;
}

/**
 * The options column of a SettingsPictureRow. `options` is
 * [[value, caption, paint(cr, w, h, dark, value)], …]; `get`/`set` read and
 * write the selection.
 */
export function pictureOptions(settings, keys, options, get, set, {w = 64, h = 42, spacing = 6, expand = false} = {}) {
    const strip = box(false, spacing, [], {homogeneous: expand, hexpand: expand});
    const items = options.map(([value, caption, paint]) => {
        const card = pictureCard(w, h, (cr, cw, ch, dark) => paint(cr, cw, ch, dark, value), {expand});
        const cap = text(caption, ['st-caption'], {xalign: 0.5, justify: Gtk.Justification.CENTER,
            wrap: true, max_width_chars: 1, hexpand: true});
        const item = append(box(true, 1, [], {hexpand: expand}), card, cap);
        const click = new Gtk.GestureClick();
        click.connect('released', () => set(value));
        item.add_controller(click);
        strip.append(item);
        return [value, card, cap];
    });
    const sync = () => {
        const cur = get();
        for (const [value, card, cap] of items) {
            card._selected = value === cur;
            cap[value === cur ? 'add_css_class' : 'remove_css_class']('selected');
            card.queue_draw();
        }
    };
    watch(settings, keys, strip, sync);
    strip._redraw = () => items.forEach(([, card]) => card.queue_draw());
    return strip;
}

/** SettingsDisclosureRow + the rows it reveals. */
export function disclosure(opts, children) {
    const chevron = glyph('mask-chevron.down-11-medium', ['st-fg2'], 0);
    const head = row({...opts, accessory: chevron});
    const click = new Gtk.GestureClick();
    let open = false;
    click.connect('released', () => {
        open = !open;
        chevron._rotation = open ? 180 : 0;
        chevron.queue_draw();
        for (const c of children)
            c.visible = open;
    });
    head.add_controller(click);
    for (const c of children)
        c.visible = false;
    return [head, ...children];
}
