// SPDX-License-Identifier: Apache-2.0
// The top bar button: the live trio icon plus its popup panel.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {buildScene} from './scene.js';
import {drawScene, PALETTES} from './renderer.js';
import {ChargingClock, FRAMES_PER_SECOND} from './effects.js';
import {StatusPanel} from './panel.js';
import {readOptions} from './settings.js';
import {typeName} from './gtype.js';

const TrioIcon = GObject.registerClass({GTypeName: typeName('TrioIcon')},
class TrioIcon extends St.DrawingArea {
    _init(owner) {
        super._init({style_class: 'status-trio-icon', y_align: Clutter.ActorAlign.CENTER});
        this._owner = owner;
    }

    vfunc_repaint() {
        const cr = this.get_context();
        const [w, h] = this.get_surface_size();
        const size = Math.min(w, h);
        cr.translate((w - size) / 2, (h - size) / 2);
        this._owner.paintIcon(cr, size, this);
        cr.$dispose();
    }
});

export const TrioButton = GObject.registerClass({GTypeName: typeName('TrioButton')},
class TrioButton extends PanelMenu.Button {
    _init(extension, model, settings, assets) {
        super._init(0.5, 'Status Trio', false);
        this.add_style_class_name('status-trio-button');
        this._extension = extension;
        this._model = model;
        this._settings = settings;
        this._assets = assets;
        this._clock = new ChargingClock();
        this._tickId = 0;

        // GNOME 51 opens panel menus from a ClickGesture; keep it on the primary
        // button and give the secondary button the preferences, like the
        // macOS app's right-click.
        this._clickGesture.required_button = Clutter.BUTTON_PRIMARY;
        const prefsGesture = new Clutter.ClickGesture({required_button: Clutter.BUTTON_SECONDARY});
        prefsGesture.connect('recognize', () => extension.openPreferences());
        this.add_action(prefsGesture);

        this._icon = new TrioIcon(this);
        this.add_child(this._icon);
        this._applySize();

        this._panel = new StatusPanel(this, model, settings, extension);
        this.menu.box.add_child(this._panel);
        this.menu.actor.add_style_class_name('status-trio-menu');
        this.menu.connect('open-state-changed', (_m, open) => this._panel.setOpen(open));

        model.connectObject('changed', (_m, what) => this._onModelChanged(what), this);
        settings.connectObject('changed', () => {
            this._options = readOptions(settings);
            this._applySize();
            this._syncAnimation();
            this._icon.queue_repaint();
        }, this);
        this._options = readOptions(settings);
        this._icon.connect('style-changed', () => this._icon.queue_repaint());
        Main.overview.connectObject('showing', () => this._icon.queue_repaint(),
            'hidden', () => this._icon.queue_repaint(), this);
        this._onModelChanged(new Set(['battery']));
    }

    _applySize() {
        const size = this._settings.get_int('icon-size');
        this._icon.set_size(size, size);
    }

    _onModelChanged(what) {
        if (what.has('battery'))
            this._syncAnimation();
        if (['battery', 'network', 'volume', 'input', 'bluetooth'].some(k => what.has(k))) {
            this._icon.queue_repaint();
            this._syncAccessibleName();
        }
        this._panel.sync(what);
    }

    _syncAccessibleName() {
        const {battery, network, volume} = this._model;
        const parts = [];
        if (battery.isPresent)
            parts.push(`${battery.percentage}%`);
        parts.push(network.wifi.state);
        if (volume.scalar !== null)
            parts.push(`${Math.round(volume.scalar * 100)}%`);
        this.accessible_name = `Status Trio: ${parts.join(', ')}`;
    }

    // --- Charging effect --------------------------------------------------------

    _syncAnimation() {
        const enabled = this._options.battery.showsChargingEffect &&
            St.Settings.get().enable_animations;
        const animate = this._clock.update(this._model.battery, enabled);
        if (animate && !this._tickId) {
            this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000 / FRAMES_PER_SECOND, () => {
                // Nothing to animate while the screen is locked or blanked.
                if (!Main.sessionMode.isLocked)
                    this._icon.queue_repaint();
                return GLib.SOURCE_CONTINUE;
            });
        } else if (!animate && this._tickId) {
            GLib.source_remove(this._tickId);
            this._tickId = 0;
        }
    }

    // --- Painting ---------------------------------------------------------------

    paintIcon(cr, size, actor) {
        const fg = actor.get_theme_node().get_foreground_color();
        const dark = (0.2126 * fg.red + 0.7152 * fg.green + 0.0722 * fg.blue) / 255 > 0.5;
        const base = PALETTES[dark ? 'dark' : 'light'];
        const palette = {...base, fg: [fg.red, fg.green, fg.blue]};
        const scene = buildScene(this._model.snapshot, this._options);
        drawScene(cr, scene, size, palette, this._assets, this._tickId ? this._clock.phase() : null);
    }

    // --- Input --------------------------------------------------------------------

    vfunc_scroll_event(event) {
        if (this._settings.get_boolean('scroll-adjusts-volume') && this.adjustVolumeFromScroll(event))
            return Clutter.EVENT_STOP;
        return Clutter.EVENT_PROPAGATE;
    }

    /** Scroll up = louder, 5 % per notch (smooth scrolling scales the step). */
    adjustVolumeFromScroll(event) {
        const dir = event.get_scroll_direction();
        let delta = 0;
        if (dir === Clutter.ScrollDirection.UP)
            delta = 1;
        else if (dir === Clutter.ScrollDirection.DOWN)
            delta = -1;
        else if (dir === Clutter.ScrollDirection.SMOOTH)
            delta = -event.get_scroll_delta()[1];
        if (!delta || this._model.volume.scalar === null)
            return false;
        const step = 0.05 * Math.sign(delta) * Math.min(3, Math.abs(delta));
        this._model.setVolume(this._model.sinkStream, this._model.volume.scalar + step);
        return true;
    }

    destroy() {
        if (this._tickId)
            GLib.source_remove(this._tickId);
        this._tickId = 0;
        this._model.disconnectObject(this);
        this._settings.disconnectObject(this);
        Main.overview.disconnectObject(this);
        super.destroy();
    }
});
