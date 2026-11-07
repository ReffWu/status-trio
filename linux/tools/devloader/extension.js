// Development helper, not part of the shipped extension. GJS caches ES modules
// by URI, so GNOME Shell cannot reload an extension's code in place; loading a
// copy from a new directory gives fresh modules.
//
//   gdbus call --session --dest org.gnome.Shell --object-path /org/reffwu/StatusTrioDev \
//     --method org.reffwu.StatusTrioDev.Reload /path/to/copy

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {ExtensionType} from 'resource:///org/gnome/shell/misc/extensionUtils.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const UUID = 'status-trio@reffwu';
const XML = `<node><interface name="org.reffwu.StatusTrioDev">
  <method name="Reload"><arg type="s" direction="in" name="path"/><arg type="s" direction="out" name="result"/></method>
</interface></node>`;

export default class DevLoader extends Extension {
    enable() {
        this._dbus = Gio.DBusExportedObject.wrapJSObject(XML, this);
        this._dbus.export(Gio.DBus.session, '/org/reffwu/StatusTrioDev');
    }

    disable() {
        this._dbus?.unexport();
        this._dbus = null;
    }

    async ReloadAsync([path], invocation) {
        try {
            const mgr = Main.extensionManager;
            const old = mgr.lookup(UUID);
            if (old)
                await mgr.unloadExtension(old);
            const ext = mgr.createExtensionObject(UUID, Gio.File.new_for_path(path), ExtensionType.PER_USER);
            await mgr.loadExtension(ext);
            const now = mgr.lookup(UUID);
            invocation.return_value(new GLib.Variant('(s)',
                [`state=${now?.state} error=${now?.error ?? ''}`]));
        } catch (e) {
            invocation.return_value(new GLib.Variant('(s)', [`exception: ${e}\n${e.stack}`]));
        }
    }
}
