// SPDX-License-Identifier: Apache-2.0
// The popup panel: a widget-for-widget port of the macOS StatusPopoverView.
// Metrics (in points = logical pixels) come from the SwiftUI sources and were
// checked against renders of the real views (LinuxPanelReferenceTests).

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Symbol} from './symbols.js';
import {t} from './l10n.js';
import {bluetoothSymbolFor} from './model.js';
import {typeName} from './gtype.js';

// --- Small building blocks ----------------------------------------------------

function box(vertical, params = {}) {
    return new St.BoxLayout({
        orientation: vertical ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL,
        ...params,
    });
}

/**
 * A single-line label whose line box comes from the primary font alone, like
 * SwiftUI Text. Pango sizes a line by every font it falls back to, so a CJK
 * run (Noto Sans CJK: 1.45 em) would make each Chinese row ~3 pt taller than
 * on macOS. The text keeps its baseline at the primary font's ascent.
 */
const Text = GObject.registerClass({GTypeName: typeName('Text')},
class Text extends St.Label {
    /** Baseline and height (logical px) of `layout`, or of a Latin probe line. */
    _line(probe) {
        let layout = this.clutter_text.get_layout();
        if (probe) {
            layout = layout.copy();
            layout.set_text('x', -1);
        }
        // ClutterText lays text out at the actor's resource scale.
        const k = this.clutter_text.get_resource_scale() || 1;
        return {baseline: layout.get_baseline() / Pango.SCALE / k, height: layout.get_pixel_size()[1] / k};
    }

    vfunc_get_preferred_height(forWidth) {
        if (this.clutter_text.line_wrap)
            return super.vfunc_get_preferred_height(forWidth);
        const h = this._line(true).height;
        return this.get_theme_node().adjust_preferred_height(h, h);
    }

    vfunc_allocate(box) {
        super.vfunc_allocate(box);
        if (this.clutter_text.line_wrap)
            return;
        const content = this.get_theme_node().get_content_box(box);
        const line = this._line(false);
        const y1 = content.y1 - (line.baseline - this._line(true).baseline);
        this.clutter_text.allocate(new Clutter.ActorBox({x1: content.x1, x2: content.x2,
            y1, y2: y1 + line.height}));
    }
});

function label(text, style_class, params = {}) {
    const l = new Text({text, style_class, y_align: Clutter.ActorAlign.CENTER, ...params});
    if (style_class.includes('st-wrap')) {
        l.clutter_text.line_wrap = true;
        l.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    } else {
        l.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    }
    return l;
}

function divider(extra = '') {
    return new St.Widget({style_class: `st-divider ${extra}`, x_expand: true});
}

function spacer() {
    return new St.Widget({x_expand: true});
}

/** A trailing glyph button: natural glyph width plus 6 pt insets, 24 pt tall. */
function actionButton(symbol, style, cls, onClick, tooltip = '') {
    const glyph = new Symbol({symbol, style});
    const button = new St.Button({style_class: `st-action ${cls}`, child: glyph, can_focus: true,
        y_align: Clutter.ActorAlign.CENTER, accessible_name: tooltip});
    button.connect('clicked', () => onClick());
    button.glyph = glyph;
    return button;
}

/** A 24 pt round badge with a glyph, as used by output and Bluetooth rows. */
function badge(symbol, style, selected) {
    const b = new St.Bin({style_class: `st-badge${selected ? ' selected' : ''}`,
        child: new Symbol({symbol, style, x_align: Clutter.ActorAlign.CENTER}),
        y_align: Clutter.ActorAlign.CENTER});
    return b;
}

function openSettingsPanel(button, panel) {
    button.menu.close();
    try {
        GLib.spawn_command_line_async(`gnome-control-center ${panel}`);
    } catch (e) {
        console.warn(`[status-trio] ${e}`);
    }
}

function formatDuration(seconds) {
    const minutes = Math.round(seconds / 60);
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

function percent(v) {
    return `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;
}

// --- Level slider (PanelLevelSlider, compact) --------------------------------

const LevelSlider = GObject.registerClass({
    GTypeName: typeName('LevelSlider'),
    Signals: {
        'value-changed': {param_types: [GObject.TYPE_DOUBLE]},
        'drag-begin': {}, 'drag-end': {},
    },
}, class LevelSlider extends St.DrawingArea {
    _init(params = {}) {
        super._init({style_class: 'st-slider', reactive: true, can_focus: true, x_expand: true,
            y_align: Clutter.ActorAlign.CENTER, ...params});
        this._value = 0;
        this._muted = false;
        this._grab = null;
        this.connect('style-changed', () => this.queue_repaint());
    }

    get value() {
        return this._value;
    }

    set value(v) {
        v = Math.max(0, Math.min(1, v));
        if (this._grab || v === this._value)
            return;
        this._value = v;
        this.queue_repaint();
    }

    set muted(m) {
        this._muted = m;
        this.queue_repaint();
    }

    _color(name, fallback) {
        const [ok, c] = this.get_theme_node().lookup_color(name, false);
        return ok ? c : fallback;
    }

    vfunc_repaint() {
        const cr = this.get_context();
        const [w, h] = this.get_surface_size();
        const k = h / 20; // canvas px per point; the slot is 20 pt tall
        const bar = 12 * k, r = 9 * k, cy = h / 2;
        const set = c => cr.setSourceRGBA(c.red / 255, c.green / 255, c.blue / 255, c.alpha / 255);
        const capsule = (x0, x1) => {
            const rr = bar / 2;
            cr.newSubPath();
            cr.arc(x0 + rr, cy, rr, Math.PI / 2, 3 * Math.PI / 2);
            cr.arc(Math.max(x0 + rr, x1 - rr), cy, rr, -Math.PI / 2, Math.PI / 2);
            cr.closePath();
        };
        const track = this._color('-trio-track');
        const fill = this._muted ? this._color('-trio-fill-muted') : this._color('-trio-fill');
        if (track) {
            set(track);
            capsule(0, w);
            cr.fill();
        }
        const x = r + this._value * Math.max(0, w - 2 * r);
        if (fill) {
            set(fill);
            capsule(0, x);
            cr.fill();
        }
        // Knob: white disc with the macOS 0.16 black, 2 pt blur shadow.
        for (let i = 4; i >= 1; i--) {
            cr.setSourceRGBA(0, 0, 0, 0.16 * 0.25 * (5 - i) / 2.5);
            cr.arc(x, cy, r + i * 0.5 * k, 0, 2 * Math.PI);
            cr.fill();
        }
        set(this._color('-trio-thumb') ?? {red: 255, green: 255, blue: 255, alpha: 255});
        cr.arc(x, cy, r, 0, 2 * Math.PI);
        cr.fill();
        cr.$dispose();
    }

    _valueAt(event) {
        const [sx] = event.get_coords();
        const [ok, x] = this.transform_stage_point(sx, 0);
        if (!ok)
            return this._value;
        const r = 9 * St.ThemeContext.get_for_stage(global.stage).scale_factor;
        return (x - r) / Math.max(1, this.width - 2 * r);
    }

    _update(event) {
        this._value = Math.max(0, Math.min(1, this._valueAt(event)));
        this.queue_repaint();
        this.emit('value-changed', this._value);
    }

    vfunc_button_press_event(event) {
        if (event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;
        this._grab = global.stage.grab(this);
        this.emit('drag-begin');
        this._update(event);
        return Clutter.EVENT_STOP;
    }

    vfunc_motion_event(event) {
        if (this._grab)
            this._update(event);
        return Clutter.EVENT_STOP;
    }

    vfunc_button_release_event(event) {
        if (!this._grab)
            return Clutter.EVENT_PROPAGATE;
        this._update(event);
        this._grab.dismiss();
        this._grab = null;
        this.emit('drag-end');
        return Clutter.EVENT_STOP;
    }

    vfunc_key_press_event(event) {
        const key = event.get_key_symbol();
        const delta = {[Clutter.KEY_Right]: 0.05, [Clutter.KEY_Up]: 0.05,
            [Clutter.KEY_Left]: -0.05, [Clutter.KEY_Down]: -0.05}[key];
        if (delta === undefined)
            return super.vfunc_key_press_event(event);
        this._value = Math.max(0, Math.min(1, this._value + delta));
        this.queue_repaint();
        this.emit('value-changed', this._value);
        return Clutter.EVENT_STOP;
    }
});

// --- Summary row (Battery/NetworkStatusView) ---------------------------------

class SummaryRow {
    constructor({onActivate = null} = {}) {
        this.actor = box(false, {style_class: 'st-summary', x_expand: true});
        this._glyph = new Symbol({symbol: '', style: 'row', x_align: Clutter.ActorAlign.CENTER});
        const slot = new St.Bin({style_class: 'st-glyph-slot', child: this._glyph});
        this._title = label('', 'st-headline');
        this._subtitle = label('', 'st-caption st-secondary');
        const texts = box(true, {style_class: 'st-texts', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        texts.add_child(this._title);
        texts.add_child(this._subtitle);
        const content = box(false, {style_class: 'st-row-content', x_expand: true});
        content.add_child(slot);
        content.add_child(texts);
        this._main = new St.Button({style_class: 'st-row-button', child: content, x_expand: true,
            reactive: !!onActivate, can_focus: !!onActivate});
        if (onActivate)
            this._main.connect('clicked', onActivate);
        this.actor.add_child(this._main);
        this.slot = slot;
    }

    set({symbol, tint = 'secondary', title, subtitle}) {
        this._glyph.symbol = symbol;
        this._glyph.style_class = `st-tint-${tint}`;
        this._title.text = title;
        this._subtitle.text = subtitle || ' ';
    }

    add(actor) {
        this.actor.add_child(actor);
        return actor;
    }
}

// --- Sections -----------------------------------------------------------------

class BatterySection {
    constructor(panel) {
        this.panel = panel;
        this.row = new SummaryRow({onActivate: () => panel.route('battery')});
        this.actor = this.row.actor;
        this._high = this.row.add(actionButton('bolt.batteryblock.fill', 'action', 'st-secondary',
            () => this._toggle('performance'), t('battery.highPowerMode.toggle')));
        this._low = this.row.add(actionButton('leaf', 'action', 'st-secondary',
            () => this._toggle('power-saver'), t('battery.lowPowerMode.toggle')));
        this.row.add(actionButton('chevron.right', 'chev', 'st-tertiary', () => panel.route('battery'),
            t('battery.details.title')));
        this.row.add(actionButton('gearshape', 'action', 'st-secondary gear',
            () => openSettingsPanel(panel.button, 'power'), t('battery.action.openSettings')));
    }

    _toggle(profile) {
        const m = this.panel.model;
        m.setPowerProfile(m.profiles.active === profile ? 'balanced' : profile);
    }

    sync() {
        const {battery: b, profiles} = this.panel.model;
        let symbol = 'battery.slash', tint = 'secondary';
        if (b.isPresent) {
            const p = b.percentage;
            symbol = b.isCharging || b.isConnectedToPower ? 'battery.100.bolt'
                : p >= 88 ? 'battery.100' : p >= 63 ? 'battery.75' : p >= 38 ? 'battery.50'
                    : p >= 13 ? 'battery.25' : 'battery.0';
            tint = b.isCharging ? 'positive' : b.isLowPowerMode ? 'caution'
                : b.isConnectedToPower ? 'positive' : p <= 20 ? 'critical' : 'primary';
        }
        const info = this.panel.model.batteryInfo;
        let subtitle;
        if (!b.isPresent)
            subtitle = t('battery.state.notPresent');
        else if (b.isCharged)
            subtitle = t('battery.state.charged');
        else if (b.isCharging)
            subtitle = timeToFull(info.timeToFull);
        else if (b.isHighPowerMode)
            subtitle = t('battery.highPowerMode.toggle');
        else if (b.isLowPowerMode)
            subtitle = t('battery.state.lowPowerMode');
        else if (b.isConnectedToPower)
            subtitle = t('battery.state.connectedToPower');
        else
            subtitle = t('battery.state.onBattery');
        this.row.set({symbol, tint, title: b.isPresent ? t('battery.title', b.percentage)
            : t('battery.title.powerUnavailable'), subtitle});
        const has = profiles.available;
        this._high.visible = has && profiles.profiles.includes('performance');
        this._low.visible = has;
        this._high.glyph.style_class = profiles.active === 'performance' ? 'st-tint-accent' : '';
        this._low.glyph.symbol = profiles.active === 'power-saver' ? 'leaf.fill' : 'leaf';
        this._low.glyph.style_class = profiles.active === 'power-saver' ? 'st-tint-positive' : '';
        this._high.reactive = b.isConnectedToPower || !b.isPresent;
        this._high.opacity = this._high.reactive ? 255 : 110;
    }
}

function timeToFull(seconds) {
    if (!seconds)
        return t('battery.state.calculatingTimeToFull');
    const minutes = Math.round(seconds / 60), h = Math.floor(minutes / 60), m = minutes % 60;
    if (!h)
        return t('battery.timeToFull.minutes', m);
    return m ? t('battery.timeToFull.hoursMinutes', h, m) : t('battery.timeToFull.hours', h);
}

const WIFI_SUBTITLE = {
    connected: 'wifi.subtitle.connected', notAssociated: 'wifi.subtitle.notAssociated',
    off: 'wifi.subtitle.off', noInternet: 'wifi.subtitle.noInternet', hotspot: 'wifi.subtitle.hotspot',
    temporary: 'wifi.subtitle.temporary', shared: 'wifi.subtitle.shared', unavailable: 'wifi.subtitle.unavailable',
};

function wifiSymbol(state, strength) {
    switch (state) {
    case 'connected': {
        const bars = strength >= 60 ? 3 : strength >= 44 ? 2 : strength >= 24 ? 1 : 0;
        return `wifi-${[25, 33, 67, 100][bars]}`;
    }
    case 'off': case 'unavailable': return 'wifi.slash';
    case 'noInternet': case 'notAssociated': return 'wifi.exclamationmark';
    case 'hotspot': return 'personalhotspot';
    default: return 'wifi';
    }
}

class NetworkSection {
    constructor(panel) {
        this.panel = panel;
        this.row = new SummaryRow({onActivate: () => this._activate()});
        this.actor = this.row.actor;
        this._power = this.row.add(actionButton('power', 'action', 'st-secondary',
            () => panel.model.setWirelessEnabled(!panel.model.networkInfo.wirelessEnabled), t('wifi.power.turnOff')));
        this._chevron = this.row.add(actionButton('chevron.right', 'chev', 'st-tertiary', () => this._activate()));
        this._gear = this.row.add(actionButton('gearshape', 'action', 'st-secondary gear',
            () => openSettingsPanel(panel.button, this._wired ? 'network' : 'wifi')));
    }

    _activate() {
        this.panel.route(this._wired ? 'ethernet' : 'wifi');
    }

    sync() {
        const {network: n, networkInfo: info} = this.panel.model;
        this._wired = n.connection === 'ethernet';
        const sep = ' · ';
        if (this._wired) {
            const speed = info.ethernetSpeed ? `${info.ethernetSpeed >= 1000 ? `${info.ethernetSpeed / 1000} Gb/s`
                : `${info.ethernetSpeed} Mb/s`}` : t('ethernet.subtitle.connected');
            this.row.set({symbol: 'cable.connector', title: t('ethernet.title'),
                subtitle: [info.address, speed].filter(Boolean).join(sep)});
        } else {
            const state = n.wifi.state;
            const named = ['connected', 'noInternet', 'hotspot', 'temporary', 'shared'].includes(state) && info.ssid;
            let subtitle;
            if (named) {
                const measure = [info.band?.replace(' GHz', '') && t('wifi.summary.band', info.band.replace(' GHz', '')),
                    info.dbm !== null && info.dbm !== undefined ? t('wifi.summary.signal', info.dbm) : null].filter(Boolean);
                const base = state === 'connected' ? measure.join(sep) || t('wifi.subtitle.connected')
                    : [t(WIFI_SUBTITLE[state]), ...measure].join(sep);
                subtitle = [info.address, base].filter(Boolean).join(sep);
            } else {
                subtitle = t(WIFI_SUBTITLE[state] ?? 'wifi.subtitle.unavailable');
            }
            this.row.set({symbol: wifiSymbol(state, n.wifi.strength),
                title: named ? info.ssid : t('wifi.title'), subtitle});
        }
        const on = !!info.wirelessEnabled;
        this._power.visible = !this._wired && this.panel.settings.get_boolean('wifi-power-control');
        this._power.glyph.style_class = on ? 'st-tint-accent' : '';
        this._power.accessible_name = t(on ? 'wifi.power.turnOff' : 'wifi.power.turnOn');
        this._gear.accessible_name = t(this._wired ? 'ethernet.action.openSettings' : 'wifi.action.openSettings');
    }
}

class VpnSection {
    constructor(panel) {
        this.panel = panel;
        this.row = new SummaryRow();
        this.actor = this.row.actor;
        this._power = this.row.add(actionButton('power', 'action', 'st-secondary', () => panel.model.toggleVpn()));
    }

    get visible() {
        const m = this.panel.model;
        return (m.networkInfo.vpn?.length ?? 0) > 0 || m.vpnProfiles.length > 0;
    }

    sync() {
        const active = this.panel.model.networkInfo.vpn ?? [];
        const connected = active.some(v => v.state === 2 /* NM.ActiveConnectionState.ACTIVATED */);
        const connecting = !connected && active.length > 0;
        const name = active[0]?.id ?? this.panel.model.vpnProfiles[0]?.id ?? '';
        this.row.set({symbol: connected ? 'lock.shield.fill' : 'lock.shield',
            tint: connected ? 'positive' : connecting ? 'caution' : 'secondary', title: t('vpn.title'),
            subtitle: connecting ? t('vpn.power.changing')
                : [t(connected ? 'vpn.value.connected' : 'vpn.value.disconnected'), name].filter(Boolean).join(' · ')});
        this._power.glyph.style_class = connected ? 'st-tint-accent' : '';
        this._power.accessible_name = t(connected ? 'vpn.power.turnOff' : 'vpn.power.turnOn');
    }
}

class DeviceRow {
    constructor({onClick}) {
        this._content = box(false, {style_class: 'st-device-content', x_expand: true});
        this.actor = new St.Button({style_class: 'st-device-row', child: this._content, x_expand: true,
            can_focus: true});
        this.actor.connect('clicked', onClick);
    }

    set({symbol, style, selected, name, trailing = null}) {
        this._content.destroy_all_children();
        this._content.add_child(badge(symbol, style, selected));
        this._content.add_child(label(name, `st-body${selected ? ' st-semibold' : ''}`, {x_expand: true}));
        if (trailing)
            this._content.add_child(label(trailing, 'st-caption st-mono st-secondary'));
    }
}

function outputSymbol(o) {
    const hint = `${o.icon ?? ''} ${o.origin ?? ''}`;
    if (/bluez|bluetooth/i.test(hint))
        return bluetoothSymbolFor(o.name ?? '').replace(/^bt-/, '');
    if (/hdmi|displayport|video-display/i.test(`${hint} ${o.name ?? ''}`))
        return 'display';
    if (/headphone|headset/i.test(`${hint} ${o.name ?? ''}`))
        return 'headphones';
    return 'hifispeaker.fill';
}

class VolumeSection {
    constructor(panel) {
        this.panel = panel;
        this.actor = box(true, {style_class: 'st-volume', x_expand: true});
        const row = box(false, {style_class: 'st-volume-row', x_expand: true});
        this._mute = new St.Button({style_class: 'st-mute', can_focus: true,
            child: new Symbol({symbol: 'speaker.wave.2.fill', style: 'row', x_align: Clutter.ActorAlign.CENTER})});
        this._mute.connect('clicked', () => panel.model.toggleMute(panel.model.sinkStream));
        this._slider = new LevelSlider();
        this._slider.connect('value-changed', (_s, v) => {
            panel.model.setVolume(panel.model.sinkStream, v);
            this._percent.text = percent(v);
        });
        this._percent = label('', 'st-caption st-mono st-secondary st-percent');
        this._percent.clutter_text.x_align = Clutter.ActorAlign.END;
        row.add_child(this._mute);
        row.add_child(this._slider);
        row.add_child(this._percent);
        row.add_child(actionButton('gearshape', 'action', 'st-secondary gear',
            () => openSettingsPanel(panel.button, 'sound'), t('volume.action.openSettings')));
        this.actor.add_child(row);
        this._listDivider = divider('st-list-divider');
        this._list = box(true, {style_class: 'st-device-list', x_expand: true});
        this.actor.add_child(this._listDivider);
        this.actor.add_child(this._list);
        this._listKey = '';
    }

    sync() {
        const {volume: v, audio} = this.panel.model;
        const scalar = v.scalar ?? 0;
        this._slider.value = scalar;
        this._slider.muted = v.isMuted;
        this._slider.reactive = v.scalar !== null;
        this._percent.text = v.scalar === null ? '—' : percent(scalar);
        const glyph = this._mute.child;
        glyph.symbol = v.isMuted ? 'speaker.slash.fill' : !scalar ? 'speaker.fill'
            : scalar < 0.33 ? 'speaker.wave.1.fill' : scalar < 0.66 ? 'speaker.wave.2.fill' : 'speaker.wave.3.fill';
        glyph.style_class = v.isMuted ? 'st-tint-critical' : 'st-secondary';
        this._mute.accessible_name = t(v.isMuted ? 'volume.unmuted' : 'volume.muted');

        const outputs = audio.outputs ?? [];
        const limit = this.panel.settings.get_int('max-output-devices');
        const key = JSON.stringify([outputs.map(o => [o.id, o.name, o.icon]), audio.output, limit]);
        if (key === this._listKey)
            return;
        this._listKey = key;
        this._list.destroy_all_children();
        const show = outputs.length > 1;
        this._listDivider.visible = this._list.visible = show;
        if (!show)
            return;
        for (const o of outputs.slice(0, limit)) {
            const row = new DeviceRow({onClick: () => this.panel.model.activateOutput(o)});
            const selected = o.id === audio.output;
            row.set({symbol: outputSymbol(o), style: 'device', selected, name: o.name});
            row.actor.accessible_name = selected ? t('volume.output.current') : t('volume.output.switchTo', o.name);
            this._list.add_child(row.actor);
        }
    }
}

class BluetoothSection {
    constructor(panel) {
        this.panel = panel;
        this.row = new SummaryRow();
        this.actor = box(true, {style_class: 'st-bluetooth', x_expand: true});
        this.actor.add_child(this.row.actor);
        // Bluetooth uses the system template glyph, not an SF Symbol.
        this.row._glyph.style_name = 'template';
        this._power = this.row.add(actionButton('power', 'action', 'st-secondary', () => {
            const bt = panel.model.bluetooth;
            panel.model.setBluetoothPowered(!bt.powered);
        }));
        this.row.add(actionButton('gearshape', 'action', 'st-secondary gear',
            () => openSettingsPanel(panel.button, 'bluetooth'), t('bluetooth.action.openSettings')));
        this._list = box(true, {style_class: 'st-device-list', x_expand: true});
        this.actor.add_child(this._list);
        this._pending = new Map();
    }

    get visible() {
        return this.panel.model.bluetooth.available;
    }

    sync() {
        const bt = this.panel.model.bluetooth;
        const connected = bt.devices.filter(d => d.connected);
        this.row.set({symbol: 'bluetooth', title: t('bluetooth.title'),
            subtitle: !bt.powered ? t('wifi.value.off')
                : connected.length ? connected.map(d => d.name).join(', ') : t('vpn.value.disconnected')});
        this._power.glyph.style_class = bt.powered ? 'st-tint-accent' : '';
        this._power.accessible_name = t(bt.powered ? 'bluetooth.power.turnOff' : 'bluetooth.power.turnOn');

        this._list.destroy_all_children();
        const limit = this.panel.settings.get_int('max-bluetooth-devices');
        this._list.visible = bt.powered && bt.devices.length > 0;
        for (const d of bt.devices.slice(0, limit)) {
            const pending = this._pending.get(d.path);
            if (pending && pending.connected !== d.connected)
                this._pending.delete(d.path);
            const status = this._pending.has(d.path)
                ? t(d.connected ? 'bluetooth.state.disconnecting' : 'bluetooth.state.connecting')
                : d.battery !== null ? `${d.battery}%` : null;
            const row = new DeviceRow({onClick: () => {
                this._pending.set(d.path, {connected: d.connected});
                this.panel.model.toggleBluetoothDevice(d);
                this.sync();
            }});
            row.set({symbol: d.symbol.replace(/^bt-/, ''), style: 'action', selected: d.connected,
                name: d.name, trailing: status});
            row.actor.accessible_name = `${d.name}, ${t(d.connected ? 'bluetooth.action.disconnect' : 'bluetooth.action.connect')}`;
            this._list.add_child(row.actor);
        }
    }
}

class InputSourceSection {
    constructor(panel) {
        this.panel = panel;
        this.row = new SummaryRow({onActivate: () => panel.route('inputSource')});
        this.actor = this.row.actor;
        this.row.add(actionButton('chevron.right', 'chev', 'st-tertiary', () => panel.route('inputSource')));
        this.row.add(actionButton('gearshape', 'action', 'st-secondary gear',
            () => openSettingsPanel(panel.button, 'keyboard'), t('inputSource.openSettings')));
    }

    sync() {
        const src = this.panel.model.inputSource;
        this.row.set({symbol: 'keyboard', title: src?.name ?? t('inputSource.title'),
            subtitle: t('inputSource.title')});
    }
}

const SECTIONS = {
    battery: BatterySection, network: NetworkSection, vpn: VpnSection,
    bluetooth: BluetoothSection, volume: VolumeSection, inputSource: InputSourceSection,
};

// --- Detail pages ---------------------------------------------------------------

function backRow(panel, title, trailing = []) {
    const row = box(false, {style_class: 'st-back-row', x_expand: true});
    const content = box(false, {style_class: 'st-back-content', x_expand: true});
    content.add_child(new St.Bin({style_class: 'st-back-slot',
        child: new Symbol({symbol: 'chevron.backward', style: 'action', x_align: Clutter.ActorAlign.CENTER})}));
    content.add_child(label(title, 'st-headline', {x_expand: true}));
    const button = new St.Button({style_class: 'st-row-button', child: content, x_expand: true,
        can_focus: true, accessible_name: t('common.back')});
    button.connect('clicked', () => panel.route('summary'));
    row.add_child(button);
    for (const a of trailing)
        row.add_child(a);
    return row;
}

function detailRows(rows) {
    const list = box(true, {style_class: 'st-detail-rows', x_expand: true});
    for (const [name, value, tint] of rows) {
        if (value === null || value === undefined || value === '')
            continue;
        const r = box(false, {style_class: 'st-detail-row', x_expand: true});
        r.add_child(label(name, 'st-caption st-secondary'));
        r.add_child(spacer());
        r.add_child(label(String(value), `st-caption st-mono${tint ? ` st-tint-${tint}` : ''}`));
        list.add_child(r);
    }
    return list;
}

/**
 * Lays its one child out `dx`/`dy` past its own box on every side, like
 * SwiftUI's negative padding (St has no negative margins).
 */
const OutsetLayout = GObject.registerClass({GTypeName: typeName('OutsetLayout')},
class OutsetLayout extends Clutter.LayoutManager {
    _init(dx, dy) {
        super._init();
        this._dx = dx;
        this._dy = dy;
    }

    vfunc_get_preferred_width(container, forHeight) {
        const child = container.get_first_child();
        const [min, nat] = child.get_preferred_width(forHeight < 0 ? -1 : forHeight + 2 * this._dy);
        return [Math.max(0, min - 2 * this._dx), Math.max(0, nat - 2 * this._dx)];
    }

    vfunc_get_preferred_height(container, forWidth) {
        const child = container.get_first_child();
        const [min, nat] = child.get_preferred_height(forWidth < 0 ? -1 : forWidth + 2 * this._dx);
        return [Math.max(0, min - 2 * this._dy), Math.max(0, nat - 2 * this._dy)];
    }

    vfunc_allocate(container, box) {
        const b = box.copy();
        b.x1 -= this._dx; b.x2 += this._dx;
        b.y1 -= this._dy; b.y2 += this._dy;
        container.get_first_child().allocate(b);
    }
});

/** BatterySettingsLinkRow: a full-width, leading-aligned link whose hover
 * fill reaches 8/5 pt past the text without moving it. */
function linkButton(text, onClick) {
    const b = new St.Button({style_class: 'st-link', x_expand: true, can_focus: true,
        child: label(text, '', {x_align: Clutter.ActorAlign.START, x_expand: true})});
    b.connect('clicked', onClick);
    const row = new St.Widget({layout_manager: new OutsetLayout(8, 5), x_expand: true});
    row.add_child(b);
    return row;
}

function sectionTitle(text) {
    return label(text, 'st-caption st-semibold st-secondary st-section-title');
}

class BatteryPage {
    constructor(panel) {
        this.panel = panel;
        this.actor = box(true, {style_class: 'st-page-stack', x_expand: true});
    }

    sync() {
        const panel = this.panel;
        const {battery: b, batteryInfo: i, profiles} = panel.model;
        this.actor.destroy_all_children();
        this.actor.add_child(backRow(panel, t('battery.details.title')));
        const remaining = b.isCharging ? timeToFull(i.timeToFull)
            : !i.onBattery ? t('battery.state.connectedToPower')
                : i.timeToEmpty ? formatDuration(i.timeToEmpty) : t('battery.details.collecting');
        const watts = i.rate ? `${i.rate.toFixed(1)} W` : null;
        this.actor.add_child(detailRows([
            [t('battery.details.batteryCondition'), i.health === null ? null
                : t(i.health >= 80 ? 'battery.details.condition.normal' : 'battery.details.condition.service'),
            i.health !== null && i.health < 80 ? 'caution' : null],
            [t('battery.details.maxCapacity'), i.health === null ? null : `${i.health}%`],
            [t('battery.details.cycles'), i.cycles],
            [t('battery.details.remaining'), b.isPresent ? remaining : null],
            [t(b.isCharging ? 'battery.details.charging' : 'battery.details.discharging'), watts],
            [t('battery.details.voltage'), i.voltage ? `${i.voltage.toFixed(2)} V` : null],
            [t('linux.battery.energy'), i.energyFull ? `${i.energy.toFixed(1)} / ${i.energyFull.toFixed(1)} Wh` : null],
            [t('linux.battery.design'), i.energyFullDesign ? `${i.energyFullDesign.toFixed(1)} Wh` : null],
            [t('linux.battery.temperature'), i.temperature ? `${i.temperature.toFixed(1)} °C` : null],
            [t('linux.battery.chargeLimit'), i.thresholdSupported
                ? i.thresholdEnabled ? `${i.thresholdEnd}%` : t('battery.details.off') : null],
            [t('linux.battery.model'), [i.vendor, i.model].filter(Boolean).join(' ') || null],
        ]));
        if (profiles.available) {
            this.actor.add_child(divider());
            this.actor.add_child(this._powerModes(profiles));
        }
        this.actor.add_child(divider());
        const links = box(true, {style_class: 'st-links', x_expand: true});
        links.add_child(linkButton(t('battery.action.openSettings'), () => openSettingsPanel(panel.button, 'power')));
        this.actor.add_child(links);
    }

    _powerModes(profiles) {
        const outer = box(true, {style_class: 'st-power-modes', x_expand: true});
        const seg = box(false, {style_class: 'st-segmented', x_expand: true});
        const options = [
            ['power-saver', 'leaf.fill', 'battery.powerMode.low'],
            ['balanced', 'gauge', 'battery.powerMode.automatic'],
            ['performance', 'bolt.batteryblock.fill', 'battery.powerMode.high'],
        ].filter(([p]) => profiles.profiles.includes(p));
        for (const [profile, symbol, key] of options) {
            const selected = profiles.active === profile;
            const content = box(false, {style_class: 'st-segment-content', x_align: Clutter.ActorAlign.CENTER});
            content.add_child(new Symbol({symbol, style: 'caption'}));
            content.add_child(label(t(key), 'st-caption'));
            const b = new St.Button({style_class: `st-segment${selected ? ' selected' : ''}`, child: content,
                x_expand: true, can_focus: true, accessible_name: t(key)});
            b.connect('clicked', () => this.panel.model.setPowerProfile(profile));
            seg.add_child(b);
        }
        outer.add_child(seg);
        const b = this.panel.model.battery;
        if (b.isPresent && !b.isConnectedToPower && profiles.active === 'performance')
            outer.add_child(label(t('battery.powerMode.highRequiresPower'), 'st-caption st-secondary st-wrap'));
        return outer;
    }
}

class WifiPage {
    constructor(panel) {
        this.panel = panel;
        this.actor = box(true, {style_class: 'st-page-stack', x_expand: true});
        this._showDetails = false;
    }

    enter() {
        this.panel.model.requestScan();
    }

    sync() {
        const panel = this.panel, m = panel.model, info = m.networkInfo;
        this.actor.destroy_all_children();
        const refresh = actionButton('arrow.clockwise', 'action', 'st-secondary', () => m.requestScan(), t('wifi.refresh'));
        this.actor.add_child(backRow(panel, t('wifi.title'), [refresh]));

        const toggle = box(false, {style_class: 'st-toggle-row', x_expand: true});
        toggle.add_child(label(t('wifi.power'), 'st-body', {x_expand: true}));
        const sw = new St.Button({style_class: `st-switch${info.wirelessEnabled ? ' checked' : ''}`,
            can_focus: true, accessible_name: t('wifi.power'),
            // Clutter only honours a child's START/END alignment while it expands.
            child: new St.Widget({style_class: 'st-switch-knob', x_expand: true, x_align: info.wirelessEnabled
                ? Clutter.ActorAlign.END : Clutter.ActorAlign.START})});
        sw.connect('clicked', () => m.setWirelessEnabled(!info.wirelessEnabled));
        toggle.add_child(sw);
        this.actor.add_child(toggle);

        if (info.wirelessEnabled) {
            const sections = box(true, {style_class: 'st-network-sections', x_expand: true});
            const aps = m.accessPoints;
            const saved = new Set(m.savedSsids ?? []);
            const known = aps.filter(a => a.active || saved.has(a.ssid));
            const other = aps.filter(a => !a.active && !saved.has(a.ssid));
            if (known.length) {
                sections.add_child(sectionTitle(t('wifi.knownNetworks')));
                for (const ap of known)
                    sections.add_child(this._networkRow(ap));
                if (known.some(a => a.active))
                    sections.add_child(this._details());
            }
            if (other.length) {
                sections.add_child(sectionTitle(t('wifi.otherNetworks')));
                for (const ap of other.slice(0, 12))
                    sections.add_child(this._networkRow(ap));
            }
            if (!aps.length)
                sections.add_child(label(t('wifi.scanning'), 'st-caption st-secondary'));
            this.actor.add_child(sections);
        }
        this.actor.add_child(divider());
        this.actor.add_child(linkButton(t('wifi.action.openSettings'), () => openSettingsPanel(panel.button, 'wifi')));
    }

    _networkRow(ap) {
        const content = box(false, {style_class: 'st-network-content', x_expand: true});
        const lead = new Symbol({symbol: ap.active ? 'checkmark' : 'wifi', style: 'action',
            style_class: ap.active ? 'st-tint-accent' : 'st-secondary'});
        content.add_child(new St.Bin({style_class: 'st-network-slot', child: lead}));
        content.add_child(label(ap.ssid, 'st-body', {x_expand: true}));
        if (ap.secure)
            content.add_child(new St.Bin({style_class: 'st-network-slot',
                child: new Symbol({symbol: 'lock.fill', style: 'caption', style_class: 'st-secondary'})}));
        content.add_child(new St.Bin({style_class: 'st-network-slot',
            child: new Symbol({symbol: wifiSymbol('connected', ap.strength), style: 'signal', style_class: 'st-secondary'})}));
        const b = new St.Button({style_class: 'st-network-row', child: content, x_expand: true, can_focus: true,
            accessible_name: ap.ssid});
        b.connect('clicked', () => {
            if (!ap.active) {
                this.panel.button.menu.close();
                this.panel.model.connectToNetwork(ap).catch(e => console.warn(`[status-trio] ${e}`));
            }
        });
        return b;
    }

    _details() {
        const info = this.panel.model.networkInfo;
        const wrap = box(true, {style_class: 'st-wifi-details', x_expand: true});
        if (this._showDetails) {
            wrap.add_child(detailRows([
                [t('wifi.detail.ssid'), info.ssid],
                [t('wifi.detail.bssid'), info.bssid],
                [t('wifi.detail.band'), info.band],
                [t('wifi.detail.channel'), info.channel],
                [t('wifi.detail.rssi'), info.dbm !== null ? `${info.dbm} dBm` : null],
                [t('wifi.detail.txRate'), info.bitrate ? `${info.bitrate} Mb/s` : null],
                [t('wifi.detail.security'), info.security],
                ['IP', info.address],
                [t('linux.network.gateway'), info.gateway],
                ['DNS', (info.dns ?? []).join(', ') || null],
                [t('linux.network.interface'), info.interface],
            ]));
        }
        const toggle = new St.Button({style_class: 'st-link-small', can_focus: true,
            label: t(this._showDetails ? 'wifi.details.hide' : 'wifi.details.show'),
            x_align: Clutter.ActorAlign.START});
        toggle.connect('clicked', () => {
            this._showDetails = !this._showDetails;
            this.sync();
        });
        wrap.add_child(toggle);
        return wrap;
    }
}

class EthernetPage {
    constructor(panel) {
        this.panel = panel;
        this.actor = box(true, {style_class: 'st-page-stack', x_expand: true});
    }

    sync() {
        const info = this.panel.model.networkInfo;
        this.actor.destroy_all_children();
        this.actor.add_child(backRow(this.panel, t('ethernet.title')));
        this.actor.add_child(detailRows([
            [t('linux.network.interface'), info.interface],
            ['IP', info.address],
            [t('linux.network.gateway'), info.gateway],
            ['DNS', (info.dns ?? []).join(', ') || null],
            [t('linux.network.speed'), info.ethernetSpeed ? `${info.ethernetSpeed} Mb/s` : null],
        ]));
        this.actor.add_child(divider());
        this.actor.add_child(linkButton(t('ethernet.action.openSettings'),
            () => openSettingsPanel(this.panel.button, 'network')));
    }
}

class InputSourcePage {
    constructor(panel) {
        this.panel = panel;
        this.actor = box(true, {style_class: 'st-page-stack', x_expand: true});
    }

    sync() {
        const m = this.panel.model;
        this.actor.destroy_all_children();
        this.actor.add_child(backRow(this.panel, t('inputSource.title')));
        const list = box(true, {style_class: 'st-device-list', x_expand: true});
        const sources = m.inputSources;
        if (!sources.length)
            list.add_child(label(t('inputSource.empty'), 'st-caption st-secondary st-wrap'));
        for (const src of sources) {
            const selected = src.id === m.inputSource?.id;
            const content = box(false, {style_class: 'st-network-content', x_expand: true});
            content.add_child(new St.Bin({style_class: 'st-network-slot', child: new Symbol({
                symbol: 'checkmark', style: 'action', style_class: 'st-tint-accent', opacity: selected ? 255 : 0})}));
            content.add_child(label(src.displayName, `st-body${selected ? ' st-semibold' : ''}`, {x_expand: true}));
            content.add_child(label(src.shortName, 'st-caption st-secondary'));
            const b = new St.Button({style_class: 'st-network-row', child: content, x_expand: true, can_focus: true});
            b.connect('clicked', () => src.activate(true));
            list.add_child(b);
        }
        this.actor.add_child(list);
        this.actor.add_child(divider());
        this.actor.add_child(linkButton(t('inputSource.openSettings'),
            () => openSettingsPanel(this.panel.button, 'keyboard')));
    }
}

const PAGES = {battery: BatteryPage, wifi: WifiPage, ethernet: EthernetPage, inputSource: InputSourcePage};

// --- The panel --------------------------------------------------------------------

export const StatusPanel = GObject.registerClass({GTypeName: typeName('StatusPanel')},
class StatusPanel extends St.Widget {
    _init(button, model, settings, extension) {
        super._init({layout_manager: new Clutter.BinLayout(), style_class: 'status-trio-panel',
            x_expand: true, y_expand: true});
        this.button = button;
        this.model = model;
        this.settings = settings;
        this.extension = extension;
        this._route = 'summary';

        const column = box(true, {x_expand: true, y_expand: true});
        this._scroll = new St.ScrollView({style_class: 'st-scroll', hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC, overlay_scrollbars: true, x_expand: true});
        this._page = box(true, {style_class: 'st-page', x_expand: true});
        this._scroll.set_child(this._page);
        column.add_child(this._scroll);
        this._footer = this._buildFooter();
        column.add_child(this._footer);
        this.add_child(column);
        this._overlay = this._buildMoreMenu();
        this.add_child(this._overlay);

        settings.connectObject('changed::panel-sections', () => this._rebuild(),
            'changed::max-output-devices', () => this.sync(new Set(['audio'])),
            'changed::max-bluetooth-devices', () => this.sync(new Set(['bluetooth'])),
            'changed::wifi-power-control', () => this.sync(new Set(['network'])), this);
        this._rebuild();
    }

    // Routing ---------------------------------------------------------------------

    route(name) {
        this._route = name;
        this._overlay.hide();
        this._rebuild();
        this._detail?.enter?.();
    }

    setOpen(open) {
        if (!open) {
            this._overlay.hide();
            if (this._route !== 'summary') {
                this._route = 'summary';
                this._rebuild();
            }
        } else {
            this.sync(new Set(['battery', 'network', 'volume', 'audio', 'bluetooth', 'input']));
            this._capHeight();
        }
    }

    _capHeight() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (monitor)
            this._scroll.style = `max-height: ${Math.floor(monitor.height * 0.8) - 60}px;`;
    }

    _rebuild() {
        this._page.destroy_all_children();
        this._sections = [];
        this._detail = null;
        const summary = this._route === 'summary';
        this._page.style_class = summary ? 'st-page summary' : 'st-page detail';
        this._footer.visible = summary;
        if (summary) {
            const enabled = this.settings.get_strv('panel-sections');
            for (const key of enabled) {
                const Section = SECTIONS[key];
                if (!Section)
                    continue;
                const section = new Section(this);
                section.key = key;
                section.divider = divider();
                this._sections.push(section);
                this._page.add_child(section.divider);
                this._page.add_child(section.actor);
            }
            this.sync(new Set(['battery', 'network', 'volume', 'audio', 'bluetooth', 'input']));
        } else {
            this._detail = new PAGES[this._route](this);
            this._page.add_child(this._detail.actor);
            this._detail.sync();
        }
    }

    // Updates ---------------------------------------------------------------------

    sync(what) {
        if (this._detail) {
            const relevant = {battery: ['battery'], wifi: ['network', 'networks'], ethernet: ['network'],
                inputSource: ['input']}[this._route] ?? [];
            if (relevant.some(k => what.has(k)))
                this._detail.sync();
            return;
        }
        const deps = {battery: ['battery'], network: ['network'], vpn: ['network'],
            bluetooth: ['bluetooth'], volume: ['volume', 'audio'], inputSource: ['input']};
        for (const s of this._sections ?? []) {
            if (deps[s.key].some(k => what.has(k)))
                s.sync();
        }
        // Sections without content (no VPN profiles, no Bluetooth adapter) drop
        // out together with their separator, like the macOS displayedSections.
        let first = true;
        for (const s of this._sections ?? []) {
            const shown = s.visible ?? true;
            s.actor.visible = shown;
            s.divider.visible = shown && !first;
            if (shown)
                first = false;
        }
        this._footerRule.visible = !first;
    }

    // Footer ----------------------------------------------------------------------

    _buildFooter() {
        const footer = box(true, {style_class: 'st-footer', x_expand: true});
        this._footerRule = divider('st-footer-rule');
        footer.add_child(this._footerRule);
        const row = box(false, {style_class: 'st-footer-row', x_expand: true});
        const content = box(false, {style_class: 'st-footer-label', x_align: Clutter.ActorAlign.START,
            x_expand: true});
        content.add_child(new Symbol({symbol: 'gearshape', style: 'footer'}));
        content.add_child(label(t('menu.settings'), 'st-callout'));
        const settings = new St.Button({style_class: 'st-footer-settings', child: content, x_expand: true,
            can_focus: true, accessible_name: t('menu.settings')});
        settings.connect('clicked', () => {
            this.button.menu.close();
            this.extension.openPreferences();
        });
        row.add_child(settings);
        row.add_child(label(this.extension.metadata['version-name'] ?? String(this.extension.metadata.version ?? ''),
            'st-callout st-version'));
        this._more = actionButton('ellipsis.circle', 'action', 'st-primary-glyph', () => {
            this._overlay.visible = !this._overlay.visible;
        }, t('menu.more'));
        row.add_child(this._more);
        footer.add_child(row);
        return footer;
    }

    _buildMoreMenu() {
        // Lives inside the popup so it needs no grab of its own; a click outside
        // the card dismisses it, like an NSMenu.
        const overlay = new St.Widget({layout_manager: new Clutter.BinLayout(), reactive: true,
            x_expand: true, y_expand: true, visible: false});
        overlay.connect('button-press-event', (_a, event) => {
            if (global.stage.get_event_actor(event) === overlay)
                overlay.hide();
            return Clutter.EVENT_PROPAGATE;
        });
        const card = box(true, {style_class: 'st-menu-card', x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.END, x_expand: true, y_expand: true, reactive: true});
        const item = (text, cb) => {
            const b = new St.Button({style_class: 'st-menu-item', x_expand: true, can_focus: true,
                child: label(text, '', {x_align: Clutter.ActorAlign.START, x_expand: true})});
            b.connect('clicked', () => {
                overlay.hide();
                cb();
            });
            card.add_child(b);
        };
        item(t('menu.about', 'Status Trio'), () => {
            this.button.menu.close();
            this.extension.openPreferences();
        });
        item(t('linux.menu.gnomeSettings'), () => openSettingsPanel(this.button, ''));
        card.add_child(new St.Widget({style_class: 'st-menu-separator', x_expand: true}));
        item(t('menu.quit'), () => {
            this.button.menu.close();
            Main.extensionManager.disableExtension(this.extension.uuid);
        });
        overlay.add_child(card);
        return overlay;
    }

    vfunc_scroll_event(event) {
        // The macOS panel adjusts the volume from anywhere on the summary page.
        if (this._route !== 'summary' || !this.settings.get_boolean('scroll-adjusts-volume'))
            return Clutter.EVENT_PROPAGATE;
        const adj = this._scroll.vadjustment;
        if (adj.upper > adj.page_size + 1)
            return Clutter.EVENT_PROPAGATE;
        return this.button.adjustVolumeFromScroll(event) ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
    }

    destroy() {
        this.settings.disconnectObject(this);
        super.destroy();
    }
});
