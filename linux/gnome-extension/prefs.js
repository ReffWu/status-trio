// SPDX-License-Identifier: Apache-2.0
// The macOS Settings window (UI/Settings/SettingsView.swift), rebuilt in GTK 4:
// a 196 pt sidebar with the same categories, tiles and App Icon subtopics, and
// detail pages of SettingsGroup cards under a live menu bar preview. Rows that
// only exist for macOS hardware or services (Dock, charge-to-full, Apple
// devices, BetterDisplay, …) are left out; everything shown is wired to the
// extension's GSettings.

import Cairo from 'cairo';
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {language, loadStrings, t} from './lib/l10n.js';
import {drawScene, loadIconAssets, PALETTES} from './lib/renderer.js';
import {buildScene} from './lib/scene.js';
import {readOptions} from './lib/settings.js';
import * as K from './lib/prefsKit.js';

const STROKE = {light: 1.0, regular: 1.25, bold: 1.5};
const BASE_TEXT_SCALE = 1.8; // battery-text-scale at the macOS 100 % symbol size

// --- Live preview -------------------------------------------------------------

/** UPower's display device, so the preview ring shows the real charge. */
class LiveBattery {
    constructor(onChange) {
        this.value = null;
        try {
            this._proxy = Gio.DBusProxy.new_for_bus_sync(Gio.BusType.SYSTEM, 0, null,
                'org.freedesktop.UPower', '/org/freedesktop/UPower/devices/DisplayDevice',
                'org.freedesktop.UPower.Device', null);
            this._id = this._proxy.connect('g-properties-changed', () => {
                this._read();
                onChange();
            });
            this._read();
        } catch {
            this._proxy = null;
        }
    }

    _read() {
        const get = n => this._proxy.get_cached_property(n)?.unpack();
        if (!get('IsPresent')) {
            this.value = null;
            return;
        }
        const state = get('State'); // 1 charging · 2 discharging · 4 full · 5 pending charge
        this.value = {
            isPresent: true, percentage: Math.round(get('Percentage') ?? 0),
            isCharging: state === 1, isCharged: state === 4,
            isConnectedToPower: [1, 4, 5].includes(state),
            isLowPowerMode: false, isHighPowerMode: false,
        };
    }

    destroy() {
        if (this._proxy && this._id)
            this._proxy.disconnect(this._id);
        this._proxy = null;
    }
}

function snapshot(battery, extra = {}) {
    return {
        battery: battery ?? {isPresent: true, percentage: 76, isCharging: false, isCharged: false,
            isConnectedToPower: false, isLowPowerMode: false, isHighPowerMode: false},
        connection: 'wifi',
        wifi: {state: 'connected', strength: 80},
        volume: {scalar: 0.75, isMuted: false, isBluetooth: false, deviceIcon: null},
        inputSource: {label: language().startsWith('zh') ? '中' : 'A'},
        systemPowerWatts: 24,
        ...extra,
    };
}

/** MenuBarPreviewBackdrop: the simulated menu bar's vertical gradient. */
function paintBackdrop(cr, w, h, darkBar) {
    const g = new Cairo.LinearGradient(0, 0, 0, h);
    if (darkBar) {
        g.addColorStopRGB(0, 0.16, 0.16, 0.19);
        g.addColorStopRGB(1, 0.10, 0.10, 0.12);
    } else {
        g.addColorStopRGB(0, 0.96, 0.96, 0.98);
        g.addColorStopRGB(1, 0.89, 0.89, 0.92);
    }
    cr.setSource(g);
    cr.rectangle(0, 0, w, h);
    cr.fill();
}

// --- Window -------------------------------------------------------------------

const SECTIONS = [
    {id: 'appIcon', title: 'settings.tab.appIcon', symbol: 'macwindow.on.rectangle', tint: 'indigo',
        subtopics: [
            ['appearance', 'settings.subtopic.appIcon.appearance'],
            ['ring', 'settings.subtopic.appIcon.ring'],
            ['middleIcon', 'settings.subtopic.appIcon.middleIcon'],
            ['bottomIndicator', 'settings.subtopic.appIcon.bottomIndicator'],
        ]},
    {id: 'battery', title: 'settings.tab.battery', symbol: 'battery.100percent', tint: 'green'},
    {id: 'network', title: 'settings.tab.network', symbol: 'wifi', tint: 'blue'},
    {id: 'bluetooth', title: 'settings.tab.bluetooth', symbol: 'rune', tint: 'blue'},
    {id: 'audio', title: 'settings.tab.audio', symbol: 'speaker.wave.3.fill', tint: 'cyan'},
    {id: 'popover', title: 'settings.tab.panel', symbol: 'list.bullet.rectangle', tint: 'purple'},
];
const PINNED = [
    {id: 'general', title: 'settings.page.general', symbol: 'gearshape.fill', tint: 'gray'},
    {id: 'about', title: 'settings.tab.about', symbol: 'info.circle.fill', tint: 'orange'},
];
/** Pages that keep the live menu bar preview pinned above their groups. */
const PREVIEW_PAGES = new Set(['appIcon', 'battery', 'network', 'bluetooth', 'audio']);

const PANEL_SECTIONS = [
    ['battery', 'settings.popup.order.battery', 'mask-battery.100percent-13-regular'],
    ['network', 'settings.popup.order.network', 'mask-wifi-13-regular'],
    ['vpn', 'vpn.title', 'mask-lock.shield-13-regular'],
    ['bluetooth', 'bluetooth.title', 'mask-antenna.radiowaves.left.and.right-13-regular'],
    ['volume', 'settings.popup.order.volume', 'mask-speaker.wave.2-13-regular'],
    ['inputSource', 'settings.popup.order.inputSource', 'mask-keyboard-13-regular'],
];

class SettingsWindow {
    constructor(window, settings, ext) {
        this._window = window;
        this._s = settings;
        this._ext = ext;
        this._section = 'appIcon';
        this._subtopic = 'appearance';
        this._expanded = 'appIcon';
        this._previewDark = true;
        this._previewAreas = new Set();
        this._assets = {icon: loadIconAssets(`${ext.path}/assets/icon`, path => {
            const [, bytes] = GLib.file_get_contents(path);
            return new TextDecoder().decode(bytes);
        })};
        this._battery = new LiveBattery(() => this._redrawPreviews());

        this.root = K.box(false, 0, ['st-prefs']);
        this._sidebar = K.box(true, 0, ['st-sidebar'], {width_request: 196, hexpand: false});
        this._detail = K.box(true, 0, [], {hexpand: true});
        K.append(this.root, this._sidebar, K.box(false, 0, ['st-vrule']), this._detail);

        this._settingsId = settings.connect('changed', () => this._redrawPreviews());
        const style = Adw.StyleManager.get_default();
        this._styleId = style.connect('notify::dark', () => this._syncDark(true));
        this._syncDark(false);
        this._buildSidebar();
        this._showPage();
    }

    destroy() {
        this._s.disconnect(this._settingsId);
        Adw.StyleManager.get_default().disconnect(this._styleId);
        this._battery.destroy();
    }

    _syncDark(rebuild) {
        const dark = Adw.StyleManager.get_default().dark;
        for (const w of [this._window, this.root])
            w[dark ? 'add_css_class' : 'remove_css_class']('dark');
        if (rebuild)
            this._showPage();
    }

    // --- Sidebar --------------------------------------------------------------

    _buildSidebar() {
        let child;
        while ((child = this._sidebar.get_first_child()))
            this._sidebar.remove(child);

        const head = new Gtk.WindowHandle({child: K.append(K.box(false, 0, ['st-sidebar-head']), K.trafficLights())});

        const list = K.box(true, 4, ['st-sidebar-list']);
        for (const s of SECTIONS)
            list.append(this._categoryBlock(s));
        const scroller = new Gtk.ScrolledWindow({child: list, vexpand: true,
            hscrollbar_policy: Gtk.PolicyType.NEVER, vscrollbar_policy: Gtk.PolicyType.EXTERNAL});

        const pinned = K.box(true, 4, ['st-sidebar-pinned']);
        for (const s of PINNED)
            pinned.append(this._categoryBlock(s));

        K.append(this._sidebar, head, scroller, K.box(false, 0, ['st-sidebar-rule']), pinned);
    }

    _categoryBlock(s) {
        const block = K.box(true, 0);
        const isParent = !!s.subtopics;
        const selected = this._section === s.id;
        const cat = K.box(false, 10, ['st-cat']);
        if (selected && !isParent)
            cat.add_css_class('selected');
        K.append(cat,
            s.symbol === 'rune' ? K.tile('rune', 'blue', 22) : K.tile(s.symbol, s.tint, 22),
            K.text(t(s.title), ['st-cat-title'], {hexpand: true, ellipsize: 3}));
        if (s.id === 'about')
            cat.append(K.text(`v${this._ext.metadata['version-name']?.replace(/-linux$/, '') ?? ''}`, ['st-cat-version']));
        if (isParent)
            cat.append(K.glyph('mask-chevron.down-10-semibold', ['st-cat-chevron'], this._expanded === s.id ? 0 : -90));
        this._onClick(cat, () => {
            if (isParent) {
                if (this._expanded === s.id) {
                    this._expanded = null;
                } else {
                    this._expanded = s.id;
                    if (this._section !== s.id) {
                        this._section = s.id;
                        this._subtopic = s.subtopics[0][0];
                        this._showPage();
                    }
                }
            } else {
                this._section = s.id;
                this._showPage();
            }
            this._buildSidebar();
        });
        block.append(cat);
        if (isParent && this._expanded === s.id) {
            for (const [id, key] of s.subtopics) {
                const sub = K.box(false, 0, ['st-sub']);
                if (selected && this._subtopic === id)
                    sub.add_css_class('selected');
                sub.append(K.text(t(key), [], {hexpand: true, ellipsize: 3}));
                this._onClick(sub, () => {
                    this._section = s.id;
                    this._subtopic = id;
                    this._showPage();
                    this._buildSidebar();
                });
                block.append(sub);
            }
        }
        return block;
    }

    _onClick(widget, fn) {
        const click = new Gtk.GestureClick();
        click.connect('released', fn);
        widget.add_controller(click);
    }

    // --- Detail ---------------------------------------------------------------

    _showPage() {
        let child;
        while ((child = this._detail.get_first_child()))
            this._detail.remove(child);
        this._previewAreas.clear();

        const pinned = PREVIEW_PAGES.has(this._section);
        if (pinned)
            this._detail.append(this._previewCard());
        const page = K.box(true, 20, ['st-page', ...(pinned ? [] : ['unpinned'])]);
        const id = this._section === 'appIcon' ? `appIcon_${this._subtopic}` : this._section;
        for (const g of this[`_page_${id}`]())
            page.append(g);
        this._detail.append(new Gtk.ScrolledWindow({child: page, vexpand: true,
            hscrollbar_policy: Gtk.PolicyType.NEVER}));
    }

    _redrawPreviews() {
        for (const a of this._previewAreas)
            (a._redraw ?? (() => a.queue_draw()))();
    }

    /** Options as the panel icon reads them, with per-preview overrides. */
    _options(patch = {}) {
        const o = readOptions(this._s);
        for (const [k, v] of Object.entries(patch))
            o[k] = {...o[k], ...v};
        return o;
    }

    /** StatusIconPreviewCard: the simulated menu bar plus its caption. */
    _previewCard() {
        const bar = K.box(false, 14, ['st-bar']);
        const size = () => this._s.get_int('icon-size');
        const icon = new Gtk.DrawingArea({valign: Gtk.Align.CENTER});
        icon.set_draw_func((_a, cr) => {
            drawScene(cr, buildScene(snapshot(this._battery.value), this._options()), size(),
                PALETTES[this._previewDark ? 'dark' : 'light'], this._assets);
            cr.$dispose();
        });
        icon._redraw = () => {
            icon.content_width = icon.content_height = size();
            icon.queue_draw();
        };
        icon._redraw();
        this._previewAreas.add(icon);

        const left = K.append(K.box(false, 6, [], {valign: Gtk.Align.CENTER}),
            K.glyph('mask-apple.logo-12-medium'), K.text('Finder', ['st-bar-app']));
        const right = K.append(K.box(false, 6, ['st-bar-right'], {valign: Gtk.Align.CENTER}),
            K.glyph('mask-switch.2-10-regular'), K.text('9:41', ['st-bar-clock']));
        const toggleIcon = K.glyph(this._previewDark ? 'mask-moon.fill-10-regular' : 'mask-sun.max.fill-10-regular');
        const toggle = new Gtk.Button({css_classes: ['st-bar-toggle'], valign: Gtk.Align.CENTER,
            child: K.append(K.box(false, 4), toggleIcon,
                K.text(t(this._previewDark ? 'settings.preview.dark' : 'settings.preview.light')))});
        toggle.connect('clicked', () => {
            this._previewDark = !this._previewDark;
            this._showPage();
        });
        if (!this._previewDark)
            bar.add_css_class('light');
        K.append(bar, left, K.spacer(), icon, right, toggle);
        const card = K.box(true, 8, ['st-pinned']);
        K.append(card, bar, K.text(t('settings.preview.hint'), ['st-preview-hint'], {xalign: 0.5}));
        return card;
    }

    /** A picture-option paint that draws the icon on the menu bar backdrop. */
    _iconPaint(patchFor, {size = 28, barDark = () => this._previewDark, snapFor = () => snapshot(this._battery.value)} = {}) {
        return (cr, w, h, _dark, value) => {
            const darkBar = barDark();
            paintBackdrop(cr, w, h, darkBar);
            cr.translate((w - size) / 2, (h - size) / 2);
            drawScene(cr, buildScene(snapFor(value), this._options(patchFor(value))), size,
                PALETTES[darkBar ? 'dark' : 'light'], this._assets);
        };
    }

    _pictureRow(opts, keys, options, get, set) {
        const strip = K.pictureOptions(this._s, keys, options, get, set);
        this._previewAreas.add(strip);
        return K.row({...opts, accessory: strip});
    }

    // --- App Icon pages ---------------------------------------------------------

    _page_appIcon_appearance() {
        const s = this._s;
        const stroke = this._iconPaint(v => ({battery: {ringStrokeScale: STROKE[v]}, volume: {ringStrokeScale: STROKE[v]}}));
        return [
            K.group(t('linux.prefs.topBarIcon'), [
                K.row({symbol: 'menubar.rectangle', tint: 'indigo', title: t('settings.iconSize'),
                    subtitle: t('linux.prefs.iconSize.description'),
                    accessory: K.intSlider(s, 'icon-size', 16, 36, ' pt')}),
            ]),
            K.group(t('settings.statusIcon.title'), [
                this._pictureRow({symbol: 'circle.circle', tint: 'indigo', title: t('settings.ringStrokeStyle'),
                    subtitle: t('settings.ringStrokeStyle.description')}, ['ring-stroke'],
                [['light', t('settings.ringStrokeStyle.light'), stroke],
                    ['regular', t('settings.ringStrokeStyle.regular'), stroke],
                    ['bold', t('settings.ringStrokeStyle.bold'), stroke]],
                () => s.get_string('ring-stroke'), v => s.set_string('ring-stroke', v)),
            ]),
        ];
    }

    _page_appIcon_ring() {
        const s = this._s;
        const on = k => s.get_boolean(k);
        const percent = v => `${Math.round(v * 100)}%`;
        const fullThreshold = K.row({symbol: 'battery100.bolt', tint: 'green', title: t('settings.battery.fullThreshold'),
            subtitle: t('settings.battery.fullThresholdDescription'),
            accessory: K.intSlider(s, 'full-threshold', 50, 100, '%')});
        return [
            K.group(t('settings.battery.group.topMarkers'), [
                K.toggleRow(s, 'show-percentage', {symbol: 'percent', tint: 'green',
                    title: t('settings.battery.showPercentage')}),
                K.toggleRow(s, 'show-charging-indicator', {symbol: 'bolt.fill', tint: 'yellow',
                    title: t('settings.battery.showChargingIndicator'),
                    subtitle: t('settings.battery.chargingDescription')}),
                K.showWhen(s, ['show-percentage', 'show-charging-indicator'], K.row({
                    symbol: 'powerplug.portrait.fill', tint: 'teal', title: t('settings.battery.connectedIndicator'),
                    subtitle: t('settings.battery.connectedIndicatorDescription'),
                    accessory: K.popup(s, 'connected-indicator', [
                        ['plug', t('settings.battery.connectedIndicator.plug')],
                        ['bolt', t('settings.battery.connectedIndicator.bolt')],
                        ['percentage', t('settings.battery.connectedIndicator.percentage')],
                    ])}), () => on('show-percentage') && on('show-charging-indicator')),
                K.showWhen(s, ['show-percentage', 'show-charging-indicator'], K.row({
                    symbol: 'textformat.size', tint: 'blue', title: t('settings.battery.symbolScale'),
                    subtitle: t('settings.battery.symbolScaleDescription'),
                    accessory: K.slider(s, 'battery-text-scale', {min: 0.9, max: 1.1, step: 0.05,
                        get: (st, k) => st.get_double(k) / BASE_TEXT_SCALE,
                        set: (st, k, v) => st.set_double(k, Math.round(v * 20) / 20 * BASE_TEXT_SCALE),
                        format: percent})}), () => on('show-percentage') || on('show-charging-indicator')),
            ]),
            K.group(t('settings.battery.group.progress'), [
                K.toggleRow(s, 'split-gap-progress', {symbol: 'circle.lefthalf.filled', tint: 'blue',
                    title: t('settings.battery.splitGapProgress'),
                    subtitle: t('settings.battery.splitGapProgressDescription')}),
                fullThreshold,
            ]),
            K.group(t('settings.battery.group.colors'), [
                K.toggleRow(s, 'status-colors', {symbol: 'paintpalette.fill', tint: 'orange',
                    title: t('settings.battery.statusColors'), subtitle: t('linux.prefs.statusColors.description')}),
                K.showWhen(s, ['status-colors'], K.row({symbol: 'exclamationmark.triangle.fill', tint: 'red',
                    title: t('settings.battery.criticalThreshold'),
                    subtitle: t('settings.battery.criticalThresholdDescription'),
                    accessory: K.intSlider(s, 'critical-threshold', 0, 100, '%')}), () => on('status-colors')),
            ]),
            K.group(t('settings.battery.group.chargingEffects'), [
                K.toggleRow(s, 'charging-effect', {symbol: 'menubar.rectangle', tint: 'green',
                    title: t('linux.prefs.chargingEffect'), subtitle: t('linux.prefs.chargingEffect.description')}),
                K.toggleRow(s, 'bolt-heartbeat', {symbol: 'bolt.fill', tint: 'yellow',
                    title: t('settings.battery.chargingBoltHeartbeat'),
                    subtitle: t('settings.battery.chargingBoltHeartbeatDescription')}),
            ]),
        ];
    }

    _page_appIcon_middleIcon() {
        const s = this._s;
        const sources = [
            ['network', 'settings.appIcon.middleIcon.network'],
            ['bluetoothDevice', 'settings.appIcon.middleIcon.bluetooth'],
            ['inputSource', 'settings.appIcon.middleIcon.inputSource'],
            ['batteryPercentage', 'settings.appIcon.middleIcon.batteryPercentage'],
            ['power', 'settings.appIcon.middleIcon.power'],
            ['chargingStatus', 'settings.appIcon.middleIcon.chargingStatus'],
        ];
        // MiddleIconSourcePreview: each tile draws what the slot would show,
        // on the window's own appearance rather than the menu bar's.
        const paint = this._iconPaint(v => ({connection: {centerSource: v, prioritizesNetworkErrors: false}}), {
            size: 30, barDark: () => this.root.has_css_class('dark'),
            snapFor: v => snapshot(this._battery.value, v === 'bluetoothDevice'
                ? {volume: {scalar: 0.75, isMuted: false, isBluetooth: true, deviceIcon: 'bt-airpods.pro'}} : {}),
        });
        const strip = K.pictureOptions(s, ['center-source'], sources.map(([v, k]) => [v, t(k), paint]),
            () => s.get_string('center-source'), v => s.set_string('center-source', v),
            {w: 40, h: 42, spacing: 8, expand: true});
        this._previewAreas.add(strip);
        const chargingNote = K.append(K.box(false, 6),
            K.glyph('mask-exclamationmark.circle-11-regular', ['st-fg2']),
            K.label(t('settings.appIcon.middleIcon.chargingStatus.description'), ['st-note']));
        K.showWhen(s, ['center-source'], chargingNote, () => s.get_string('center-source') === 'chargingStatus');
        const picker = K.append(K.box(true, 10, ['st-row']),
            K.label(t('settings.appIcon.middleIcon.description'), ['st-note']), strip, chargingNote);
        picker._dividerInset = 14;
        const source = () => s.get_string('center-source');
        const iconRows = K.disclosure({symbol: 'cable.connector', tint: 'teal',
            title: t('settings.network.connectionIcons'), subtitle: t('settings.network.connectionIcons.description')}, [
            K.toggleRow(s, 'wifi-icon-for-ethernet', {symbol: 'cable.connector', tint: 'teal',
                title: t('settings.network.wifiIconForEthernet')}),
            K.toggleRow(s, 'wifi-icon-for-hotspot', {symbol: 'personalhotspot', tint: 'blue',
                title: t('settings.network.wifiIconForHotspot')}),
            K.toggleRow(s, 'wifi-icon-for-temporary', {symbol: 'network', tint: 'purple',
                title: t('settings.network.wifiIconForTemporaryConnection')}),
            K.toggleRow(s, 'wifi-icon-for-sharing', {symbol: 'antenna.radiowaves.left.and.right', tint: 'indigo',
                title: t('settings.network.wifiIconForInternetSharing')}),
        ]);
        // The disclosure owns its children's visibility; only the head follows the source.
        const head = iconRows[0];
        K.showWhen(s, ['center-source'], head, () => source() === 'network');
        K.watch(s, ['center-source'], head, () => {
            if (source() !== 'network')
                iconRows.slice(1).forEach(r => (r.visible = false));
        });
        return [K.group(null, [
            picker,
            K.row({symbol: 'circle.inset.filled', tint: 'indigo', title: t('settings.appIcon.middleIcon.size'),
                subtitle: t('settings.appIcon.middleIcon.size.description'),
                accessory: K.slider(s, 'wifi-scale', {min: 1.0, max: 1.8, step: 0.05,
                    get: (st, k) => st.get_double(k),
                    set: (st, k, v) => {
                        const x = Math.round(v * 20) / 20;
                        st.set_double(k, x);
                        st.set_double('bluetooth-scale', x);
                    },
                    format: v => `${Math.round(v * 100)}%`})}),
            ...iconRows,
            K.showWhen(s, ['center-source'], K.row({symbol: 'paintpalette.fill', tint: 'blue',
                title: t('settings.bluetooth.iconColor'), subtitle: t('linux.prefs.bluetoothIconColor.description'),
                accessory: K.popup(s, 'bluetooth-icon-color', [
                    ['blue', t('settings.bluetooth.iconColor.blue')],
                    ['primary', t('settings.bluetooth.iconColor.primary')],
                ])}), () => source() === 'bluetoothDevice'),
            K.showWhen(s, ['center-source'], K.toggleRow(s, 'prioritize-network-errors', {
                symbol: 'wifi.exclamationmark', tint: 'orange',
                title: t('settings.appIcon.middleIcon.networkWarnings'),
                subtitle: t('linux.prefs.networkWarnings.description')}), () => source() !== 'network'),
        ])];
    }

    _page_appIcon_bottomIndicator() {
        const s = this._s;
        const paint = this._iconPaint(v => ({volume: {displayStyle: v}}));
        return [K.group(t('settings.audio.indicatorStyleTitle'), [
            this._pictureRow({symbol: 'waveform', tint: 'indigo', title: t('settings.audio.indicatorStyle'),
                subtitle: t('settings.audio.indicatorStyleDescription')}, ['volume-style'],
            [['dots', t('settings.audio.indicatorStyle.dots'), paint],
                ['arc', t('settings.audio.indicatorStyle.arc'), paint]],
            () => s.get_string('volume-style'), v => s.set_string('volume-style', v)),
            K.toggleRow(s, 'bluetooth-volume-color', {symbol: 'speaker.wave.2.fill', tint: 'cyan',
                title: t('settings.bluetooth.volumeColor'), subtitle: t('settings.bluetooth.volumeColorDescription')}),
        ])];
    }

    // --- Module pages -------------------------------------------------------------

    /** A switch bound to membership of `key` in panel-sections. */
    _sectionSwitch(key) {
        const sw = K.macSwitch();
        let syncing = false;
        K.watch(this._s, ['panel-sections'], sw, () => {
            syncing = true;
            sw.active = this._s.get_strv('panel-sections').includes(key);
            syncing = false;
        });
        sw.connect('notify::active', () => {
            if (!syncing)
                this._setSection(key, sw.active);
        });
        return sw;
    }

    _order() {
        const known = PANEL_SECTIONS.map(p => p[0]);
        const saved = this._s.get_strv('panel-order').filter(k => known.includes(k));
        return [...saved, ...known.filter(k => !saved.includes(k))];
    }

    _setSection(key, enabled) {
        const on = new Set(this._s.get_strv('panel-sections'));
        if (enabled)
            on.add(key);
        else
            on.delete(key);
        this._s.set_strv('panel-sections', this._order().filter(k => on.has(k)));
    }

    _panelToggle(key, opts) {
        return K.row({...opts, subtitle: opts.subtitle ?? t('settings.panel.showItemDescription'),
            accessory: this._sectionSwitch(key)});
    }

    _page_battery() {
        return [K.group(t('settings.network.panelGroup'), [
            this._panelToggle('battery', {symbol: 'battery.100percent', tint: 'green',
                title: t('settings.panel.showBattery')}),
        ])];
    }

    _page_network() {
        const s = this._s;
        return [K.group(t('settings.network.panelGroup'), [
            this._panelToggle('network', {symbol: 'wifi', tint: 'blue', title: t('settings.panel.showNetwork')}),
            K.showWhen(s, ['panel-sections'], K.toggleRow(s, 'wifi-power-control', {symbol: 'power.circle', tint: 'blue',
                title: t('settings.network.powerControl'), subtitle: t('settings.network.powerControlDescription')}),
            () => s.get_strv('panel-sections').includes('network')),
            this._panelToggle('vpn', {symbol: 'lock.shield', tint: 'indigo', title: t('linux.prefs.showVPN')}),
        ])];
    }

    _page_bluetooth() {
        const s = this._s;
        return [
            K.group(t('settings.network.panelGroup'), [
                this._panelToggle('bluetooth', {symbol: 'list.bullet.rectangle', tint: 'purple',
                    title: t('settings.bluetooth.showInStatusPanel'),
                    subtitle: t('settings.bluetooth.showInStatusPanelDescription')}),
            ]),
            K.group(t('settings.bluetooth.deviceListGroup'), [
                K.row({symbol: 'number', tint: 'teal', title: t('settings.bluetooth.maximumVisible'),
                    subtitle: t('settings.bluetooth.maximumVisibleDescription'),
                    accessory: K.stepper(s, 'max-bluetooth-devices', 1, 20)}),
            ]),
        ];
    }

    _page_audio() {
        const s = this._s;
        return [
            K.group(t('settings.network.panelGroup'), [
                this._panelToggle('volume', {symbol: 'speaker.wave.2', tint: 'cyan', title: t('settings.panel.showAudio')}),
            ]),
            K.group(t('settings.audio.volumeScroll.group'), [
                K.toggleRow(s, 'scroll-adjusts-volume', {symbol: 'arrow.up.arrow.down.circle.fill', tint: 'cyan',
                    title: t('settings.popup.volumeScroll'), subtitle: t('linux.prefs.volumeScroll.description')}),
            ]),
            K.group(t('settings.audio.displayRules'), [
                K.row({symbol: 'number', tint: 'teal', title: t('settings.audio.maximumVisible'),
                    subtitle: t('settings.audio.maximumVisibleDescription'),
                    accessory: K.stepper(s, 'max-output-devices', 1, 20)}),
            ]),
        ];
    }

    /** PopoverSectionView's checklist: tick to show, drag to reorder. */
    _page_popover() {
        const list = K.box(true, 0, ['st-order-list']);
        const rebuild = () => {
            let child;
            while ((child = list.get_first_child()))
                list.remove(child);
            const enabled = this._s.get_strv('panel-sections');
            this._order().forEach((key, i) => {
                const [, title, icon] = PANEL_SECTIONS.find(p => p[0] === key);
                if (i > 0)
                    list.append(K.box(false, 0, ['st-divider'], {margin_start: 22}));
                const check = K.macCheck();
                check.active = enabled.includes(key);
                check.connect('notify::active', () => this._setSection(key, check.active));
                const iconBox = K.append(K.box(false, 0, [], {width_request: 18, hexpand: false}),
                    K.glyph(icon, ['st-fg2']));
                iconBox.get_first_child().hexpand = true;
                iconBox.get_first_child().halign = Gtk.Align.CENTER;
                const handle = K.glyph('mask-line.3.horizontal-11-regular', ['st-fg3']);
                handle.set_cursor_from_name('grab');
                const r = K.append(K.box(false, 8, ['st-order-row']), check, iconBox,
                    K.text(t(title), [], {hexpand: true}), handle);

                const drag = new Gtk.DragSource({actions: Gdk.DragAction.MOVE});
                drag.connect('prepare', () => Gdk.ContentProvider.new_for_value(key));
                handle.add_controller(drag);
                const drop = Gtk.DropTarget.new(GObject.TYPE_STRING, Gdk.DragAction.MOVE);
                drop.connect('enter', () => {
                    r.add_css_class('drop-target');
                    return Gdk.DragAction.MOVE;
                });
                drop.connect('leave', () => r.remove_css_class('drop-target'));
                drop.connect('drop', (_d, from) => {
                    r.remove_css_class('drop-target');
                    if (from === key)
                        return false;
                    const order = this._order().filter(k => k !== from);
                    order.splice(order.indexOf(key) + (this._order().indexOf(from) < i ? 1 : 0), 0, from);
                    this._s.set_strv('panel-order', order);
                    const on = new Set(this._s.get_strv('panel-sections'));
                    this._s.set_strv('panel-sections', order.filter(k => on.has(k)));
                    return true;
                });
                r.add_controller(drop);
                list.append(r);
            });
        };
        const custom = K.box(true, 0);
        custom.append(list);
        K.watch(this._s, ['panel-order', 'panel-sections'], list, () => GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            rebuild();
            return GLib.SOURCE_REMOVE;
        }));
        rebuild();
        custom._dividerInset = 0;
        return [K.group(t('settings.popup.order'), [custom], t('settings.popup.order.description'))];
    }

    _page_general() {
        const s = this._s;
        return [K.group(t('linux.prefs.topBar'), [
            K.toggleRow(s, 'hide-system-indicators', {symbol: 'eye.slash', tint: 'indigo',
                title: t('linux.prefs.hideSystemIndicators'), subtitle: t('linux.prefs.hideSystemIndicators.description')}),
            K.toggleRow(s, 'control-center-glyph', {symbol: 'switch.2', tint: 'blue',
                title: t('linux.prefs.controlCenterGlyph'), subtitle: t('linux.prefs.controlCenterGlyph.description')}),
        ])];
    }

    _page_about() {
        const md = this._ext.metadata;
        const open = url => Gtk.show_uri(this._window, url, Gdk.CURRENT_TIME);
        const name = K.append(K.box(false, 8),
            K.text('Status Trio', ['st-about-name']),
            K.text(`v${md['version-name']?.replace(/-linux$/, '') ?? ''}`, ['st-badge'], {valign: Gtk.Align.CENTER}));
        const texts = K.append(K.box(true, 4, [], {hexpand: true, valign: Gtk.Align.CENTER}), name,
            K.label(t('linux.prefs.about.description'), ['st-about-text']),
            K.label(t('settings.about.copyright'), ['st-about-copy'], {margin_top: 2}));
        const icon = K.picture('app-icon.png', 64, 64);
        const head = K.append(K.box(false, 18), icon, texts);
        const chip = (mask, title, url) => {
            const b = new Gtk.Button({css_classes: ['st-chip'],
                child: K.append(K.box(false, 5), K.glyph(mask), K.text(title))});
            b.connect('clicked', () => open(url));
            return b;
        };
        const links = K.append(K.box(false, 8),
            chip('mask-star.fill-11-regular', t('settings.about.starOnGitHub'), md.url),
            chip('mask-globe-11-regular', t('settings.about.project'), 'https://statustrio.lingai.net/'),
            chip('mask-link-11-regular', t('settings.about.repository'), md.url),
            chip('mask-person.circle-11-regular', 'lingyired', 'https://github.com/lingyired'));
        const body = K.append(K.box(true, 16, ['st-row'], {margin_top: 4, margin_bottom: 4}),
            head, K.box(false, 0, ['st-divider']), links);
        body._dividerInset = 0;
        return [
            K.group(null, [body]),
            K.group(null, [K.hintRow(t('linux.prefs.port'))]),
        ];
    }
}

export default class StatusTrioPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        loadStrings(`${this.path}/locale`);
        K.initKit(this.path);

        const provider = new Gtk.CssProvider();
        provider.load_from_path(`${this.path}/prefs.css`);
        const display = Gdk.Display.get_default();
        Gtk.StyleContext.add_provider_for_display(display, provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);

        // ExtensionPrefsDialog insists on a visible page; the real UI replaces
        // the dialog's content outright.
        window.add(new Adw.PreferencesPage());
        const ui = new SettingsWindow(window, this.getSettings(), this);
        window.add_css_class('st-prefs-window');
        window.set_content(ui.root);
        window.set_default_size(720, 530);
        window.connect('close-request', () => {
            ui.destroy();
            Gtk.StyleContext.remove_provider_for_display(display, provider);
            return false;
        });
    }
}
