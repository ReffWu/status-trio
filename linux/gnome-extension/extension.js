// SPDX-License-Identifier: Apache-2.0
// Status Trio for GNOME Shell: battery, network and volume in one icon.

import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {loadIconAssets} from './lib/renderer.js';
import {loadPanelSymbols, unloadPanelSymbols, Symbol} from './lib/symbols.js';
import {loadControls} from './lib/controls.js';
import {loadStrings, t} from './lib/l10n.js';
import {StatusModel} from './lib/model.js';
import {TrioButton} from './lib/indicator.js';

// GNOME's own indicators that the trio replaces in the top bar.
const REPLACED = ['_network', '_volumeOutput', '_system'];

export default class StatusTrioExtension extends Extension {
    enable() {
        const dir = this.path;
        loadStrings(`${dir}/locale`);
        loadPanelSymbols(`${dir}/assets/panel`);
        loadControls(dir);
        const readText = path => new TextDecoder().decode(GLib.file_get_contents(path)[1]);
        this._assets = {icon: loadIconAssets(`${dir}/assets/icon`, readText)};
        this._settings = this.getSettings();
        this._model = new StatusModel();
        this._button = new TrioButton(this, this._model, this._settings, this._assets);

        const qs = Main.panel.statusArea.quickSettings;
        const index = Math.max(0, Main.panel._rightBox.get_children().indexOf(qs.container));
        Main.panel.addToStatusArea(this.uuid, this._button, index, 'right');

        this._hidden = [];
        this._settings.connectObject(
            'changed::hide-system-indicators', () => this._syncSystemIndicators(),
            'changed::control-center-glyph', () => this._syncSystemIndicators(), this);
        // QuickSettings builds its indicators asynchronously; at login they
        // may not exist yet. _system is the last one it adds.
        if (qs._system) {
            this._syncSystemIndicators();
        } else {
            qs._indicators.connectObject('child-added', (_box, actor) => {
                if (actor !== qs._system)
                    return;
                qs._indicators.disconnectObject(this);
                this._syncSystemIndicators();
            }, this);
        }

    }

    _syncSystemIndicators() {
        this._restoreSystemIndicators();
        const qs = Main.panel.statusArea.quickSettings;
        const box = qs._indicators;
        if (!box)
            return;
        if (this._settings.get_boolean('hide-system-indicators')) {
            for (const name of REPLACED) {
                const actor = qs[name];
                if (actor?.get_parent() === box) {
                    const children = box.get_children();
                    this._hidden.push({actor, index: children.indexOf(actor)});
                    box.remove_child(actor);
                }
            }
        }
        if (this._settings.get_boolean('control-center-glyph')) {
            this._ccGlyph = new Symbol({symbol: 'switch.2', style: 'row',
                style_class: 'status-trio-cc', accessible_name: t('linux.controlCenter')});
            box.add_child(this._ccGlyph);
        }
    }

    _restoreSystemIndicators() {
        this._ccGlyph?.destroy();
        this._ccGlyph = null;
        const box = Main.panel.statusArea.quickSettings._indicators;
        for (const {actor, index} of (this._hidden ?? []).reverse())
            box?.insert_child_at_index(actor, index);
        this._hidden = [];
    }

    disable() {
        // Also runs on the lock screen (session-modes: unlock-dialog), so the
        // trio keeps showing battery state there.
        this._settings?.disconnectObject(this);
        Main.panel.statusArea.quickSettings._indicators?.disconnectObject(this);
        this._restoreSystemIndicators();
        this._button?.destroy();
        this._button = null;
        this._model?.destroy();
        this._model = null;
        this._settings = null;
        this._assets = null;
        unloadPanelSymbols();
    }
}
