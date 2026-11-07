// SPDX-License-Identifier: Apache-2.0
// Live system status for the trio icon and its panel.
//
// Everything is event driven, mirroring the macOS app's "system events first,
// low-frequency polling as a backstop" rule — except that on GNOME every
// source has signals, so there is no polling at all:
//   battery     UPower DisplayDevice + the physical battery + OnBattery
//   power mode  UPower PowerProfiles (power-saver → Low Power, performance → High Power)
//   network     libnm client (primary connection, connectivity, Wi-Fi AP, VPN)
//   volume      GNOME Shell's Gvc mixer (PipeWire/PulseAudio)
//   bluetooth   GnomeBluetooth client
//   input       GNOME Shell's input source manager

import 'gi://GnomeBluetooth?version=3.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GnomeBluetooth from 'gi://GnomeBluetooth';
import Gvc from 'gi://Gvc';
import NM from 'gi://NM';

import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';
import {loadInterfaceXML} from 'resource:///org/gnome/shell/misc/fileUtils.js';
import {getMixerControl} from 'resource:///org/gnome/shell/ui/status/volume.js';
import {getInputSourceManager} from 'resource:///org/gnome/shell/ui/status/keyboard.js';

Gio._promisify(GnomeBluetooth.Client.prototype, 'connect_service');
Gio._promisify(NM.Client, 'new_async');
Gio._promisify(NM.Client.prototype, 'activate_connection_async');
Gio._promisify(NM.Client.prototype, 'deactivate_connection_async');
Gio._promisify(NM.Client.prototype, 'add_and_activate_connection_async');
Gio._promisify(NM.DeviceWifi.prototype, 'request_scan_async');

const UPOWER = 'org.freedesktop.UPower';
const UPowerProxy = Gio.DBusProxy.makeProxyWrapper(loadInterfaceXML('org.freedesktop.UPower'));
const DeviceProxy = Gio.DBusProxy.makeProxyWrapper(loadInterfaceXML('org.freedesktop.UPower.Device'));
const ProfilesProxy = Gio.DBusProxy.makeProxyWrapper(loadInterfaceXML('org.freedesktop.UPower.PowerProfiles'));

const DeviceState = {CHARGING: 1, DISCHARGING: 2, EMPTY: 3, FULLY_CHARGED: 4, PENDING_CHARGE: 5, PENDING_DISCHARGE: 6};
const DeviceType = {LINE_POWER: 1, BATTERY: 2};

function proxy(Wrapper, path, bus = Gio.DBus.system, name = UPOWER) {
    return new Promise(resolve => {
        // eslint-disable-next-line no-new
        new Wrapper(bus, name, path, (p, error) => resolve(error ? null : p),
            null, Gio.DBusProxyFlags.NONE);
    });
}

/** Maps an audio/Bluetooth device to the SF Symbol mask the macOS app would pick. */
export function bluetoothSymbolFor(name = '', kind = '') {
    const n = name.toLowerCase();
    if (n.includes('airpods max'))
        return 'bt-airpods.max';
    if (n.includes('airpods pro'))
        return 'bt-airpods.pro';
    if (n.includes('airpods'))
        return 'bt-airpods.gen4';
    if (n.includes('beats studio buds') || n.includes('studio buds'))
        return 'bt-beats.studiobuds';
    if (n.includes('beats'))
        return 'bt-beats.headphones';
    if (n.includes('homepod'))
        return 'bt-homepod.mini.fill';
    if (/buds|earbud|freebuds|wf-|galaxy buds|pixel buds/.test(n))
        return 'bt-earbuds';
    if (/speaker|soundbar|boom|flip|charge|soundlink/.test(n) || kind === 'speaker')
        return 'bt-hifispeaker.fill';
    return 'bt-headphones';
}

/**
 * Whether a Gvc UI device's port is plugged in. Gvc keeps devices for jacks
 * PipeWire reports as "not available" (unplugged headphones, idle HDMI), which
 * the macOS panel would never list. Unknown availability counts as present.
 */
function portAvailable(mixer, device, stream) {
    const name = device.get_port();
    if (!name)
        return !!stream;
    const streamPort = stream?.get_ports?.().find(p => p.port === name);
    if (streamPort)
        return streamPort.available !== false;
    // The UI device's `card` is a raw pointer GJS can't read; its origin is the
    // card's description, which identifies the card instead.
    const card = mixer.get_cards().find(c => c.get_name() === device.get_origin() ||
        c.name === device.get_origin()) ?? mixer.get_cards().find(c => c.get_ports().some(p => p.port === name));
    const cardPort = card?.get_ports().find(p => p.port === name);
    if (cardPort)
        return cardPort.available !== 1; /* PA_PORT_AVAILABLE_NO */
    return true;
}

export class StatusModel extends Signals.EventEmitter {
    constructor() {
        super();
        this.battery = {isPresent: false, percentage: 100, isCharging: false, isCharged: false,
            isConnectedToPower: false, isLowPowerMode: false, isHighPowerMode: false};
        this.batteryInfo = {};
        this.network = {connection: 'unknown', wifi: {state: 'unavailable', strength: null}};
        this.networkInfo = {};
        this.volume = {scalar: null, isMuted: false, isBluetooth: false, deviceIcon: null};
        this.audio = {outputs: [], inputs: [], output: null, input: null};
        this.bluetooth = {available: false, powered: false, devices: []};
        this.profiles = {available: false, active: null, profiles: []};
        this.inputSource = null;
        this._destroyed = false;
        this._emitId = 0;
        this._cancellable = new Gio.Cancellable();
        this._initAll().catch(e => console.error(`[status-trio] init: ${e}`));
    }

    async _initAll() {
        this._initVolume();
        this._initBluetooth();
        this._initInputSources();
        await Promise.all([this._initUPower(), this._initProfiles(), this._initNetwork()]);
    }

    /** Snapshot for scene.buildScene(). */
    get snapshot() {
        return {
            battery: this.battery,
            connection: this.network.connection,
            wifi: this.network.wifi,
            volume: this.volume,
            inputSource: this.inputSource,
            systemPowerWatts: this.batteryInfo.dischargeWatts ?? null,
        };
    }

    _changed(what) {
        // Coalesce bursts of D-Bus property changes into a single repaint.
        this._pending = (this._pending ?? new Set()).add(what);
        if (this._emitId || this._destroyed)
            return;
        this._emitId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._emitId = 0;
            const set = this._pending;
            this._pending = null;
            this.emit('changed', set);
            return GLib.SOURCE_REMOVE;
        });
    }

    // --- Battery & power ------------------------------------------------------

    async _initUPower() {
        this._upower = await proxy(UPowerProxy, '/org/freedesktop/UPower');
        this._display = await proxy(DeviceProxy, '/org/freedesktop/UPower/devices/DisplayDevice');
        if (this._destroyed)
            return;
        this._upower?.connectObject('g-properties-changed', () => this._syncBattery(), this);
        this._display?.connectObject('g-properties-changed', () => this._syncBattery(), this);
        // The physical battery carries the detail the aggregate DisplayDevice drops.
        try {
            const [paths] = await this._upower.EnumerateDevicesAsync();
            for (const path of paths) {
                // eslint-disable-next-line no-await-in-loop
                const dev = await proxy(DeviceProxy, path);
                if (!dev)
                    continue;
                if (dev.Type === DeviceType.BATTERY && dev.PowerSupply && !this._battery)
                    this._battery = dev;
                else if (dev.Type === DeviceType.LINE_POWER && !this._adapter)
                    this._adapter = dev;
            }
        } catch (e) {
            console.debug(`[status-trio] EnumerateDevices: ${e}`);
        }
        this._battery?.connectObject('g-properties-changed', () => this._syncBattery(), this);
        this._adapter?.connectObject('g-properties-changed', () => this._syncBattery(), this);
        this._syncBattery();
    }

    _syncBattery() {
        const d = this._display;
        if (!d)
            return;
        const state = d.State;
        const onBattery = this._upower?.OnBattery ?? (state === DeviceState.DISCHARGING);
        const pct = Math.round(Math.min(100, Math.max(0, d.Percentage ?? 0)));
        const isPresent = !!d.IsPresent && (d.Type === DeviceType.BATTERY || d.Type === 0 || d.Type === 3);
        this.battery = {
            ...this.battery,
            isPresent,
            percentage: pct,
            isCharging: state === DeviceState.CHARGING,
            isCharged: state === DeviceState.FULLY_CHARGED,
            isConnectedToPower: !onBattery,
        };
        const b = this._battery ?? d;
        const rate = Math.abs(b.EnergyRate ?? d.EnergyRate ?? 0);
        const design = b.EnergyFullDesign ?? 0;
        this.batteryInfo = {
            state,
            onBattery,
            percentage: pct,
            timeToFull: d.TimeToFull ?? 0,
            timeToEmpty: d.TimeToEmpty ?? 0,
            energy: b.Energy ?? 0,
            energyFull: b.EnergyFull ?? 0,
            energyFullDesign: design,
            health: design > 0 ? Math.min(100, Math.round(100 * (b.EnergyFull ?? 0) / design)) : null,
            rate,
            dischargeWatts: state === DeviceState.DISCHARGING && rate > 0 ? rate : null,
            voltage: b.Voltage ?? 0,
            cycles: b.ChargeCycles > 0 ? b.ChargeCycles : null,
            temperature: b.Temperature > 0 ? b.Temperature : null,
            vendor: b.Vendor ?? '',
            model: b.Model ?? '',
            technology: b.Technology ?? 0,
            adapterOnline: this._adapter?.Online ?? !onBattery,
            thresholdSupported: !!b.ChargeThresholdSupported,
            thresholdEnabled: !!b.ChargeThresholdEnabled,
            thresholdEnd: b.ChargeEndThreshold ?? 100,
        };
        this._changed('battery');
    }

    async _initProfiles() {
        this._profiles = await proxy(ProfilesProxy, '/org/freedesktop/UPower/PowerProfiles',
            Gio.DBus.system, 'org.freedesktop.UPower.PowerProfiles');
        if (this._destroyed || !this._profiles)
            return;
        this._profiles.connectObject('g-properties-changed', () => this._syncProfiles(), this);
        this._syncProfiles();
    }

    _syncProfiles() {
        const p = this._profiles;
        const active = p?.ActiveProfile ?? null;
        const list = (p?.Profiles ?? []).map(v => v.Profile?.unpack?.() ?? v.Profile?.deepUnpack?.()).filter(Boolean);
        this.profiles = {available: !!active, active, profiles: list.length ? list : ['power-saver', 'balanced', 'performance']};
        this.battery = {...this.battery,
            isLowPowerMode: active === 'power-saver', isHighPowerMode: active === 'performance'};
        this._changed('battery');
    }

    setPowerProfile(profile) {
        if (this._profiles)
            this._profiles.ActiveProfile = profile;
    }

    // --- Network ----------------------------------------------------------------

    async _initNetwork() {
        try {
            this._nm = await NM.Client.new_async(this._cancellable);
        } catch (e) {
            console.error(`[status-trio] NetworkManager: ${e}`);
            return;
        }
        if (this._destroyed)
            return;
        const sync = () => this._syncNetwork();
        this._nm.connectObject(
            'notify::primary-connection', sync, 'notify::connectivity', sync,
            'notify::wireless-enabled', sync, 'notify::wireless-hardware-enabled', sync,
            'notify::networking-enabled', sync, 'notify::state', sync,
            'device-added', () => this._watchDevices(), 'device-removed', () => this._watchDevices(),
            'active-connection-added', sync, 'active-connection-removed', sync,
            'connection-added', sync, 'connection-removed', sync, this);
        this._watchDevices();
    }

    _watchDevices() {
        for (const dev of this._watchedDevices ?? [])
            dev.disconnectObject(this);
        this._watchedDevices = this._nm.get_devices().filter(d =>
            d.device_type === NM.DeviceType.WIFI || d.device_type === NM.DeviceType.ETHERNET);
        for (const dev of this._watchedDevices) {
            dev.connectObject('state-changed', () => this._syncNetwork(), this);
            if (dev instanceof NM.DeviceWifi) {
                dev.connectObject('notify::active-access-point', () => this._watchAp(), 'access-point-added',
                    () => this._changed('networks'), 'access-point-removed', () => this._changed('networks'), this);
            }
        }
        this._watchAp();
    }

    get wifiDevice() {
        return (this._watchedDevices ?? []).find(d => d instanceof NM.DeviceWifi) ?? null;
    }

    _watchAp() {
        this._ap?.disconnectObject(this);
        this._ap = this.wifiDevice?.active_access_point ?? null;
        this._ap?.connectObject('notify::strength', () => this._syncNetwork(), this);
        this._syncNetwork();
    }

    _syncNetwork() {
        const nm = this._nm;
        if (!nm)
            return;
        const wifiDev = this.wifiDevice;
        const primary = nm.primary_connection;
        const connectivity = nm.connectivity;
        const online = connectivity === NM.ConnectivityState.FULL || connectivity === NM.ConnectivityState.UNKNOWN;

        let primaryType = primary?.type ?? null;
        if (primaryType === 'vpn' || primaryType === 'wireguard') {
            const base = primary.get_devices()?.[0];
            primaryType = base?.device_type === NM.DeviceType.WIFI ? '802-11-wireless'
                : base?.device_type === NM.DeviceType.ETHERNET ? '802-3-ethernet' : primaryType;
        }
        let connection = 'unknown';
        if (primaryType === '802-3-ethernet')
            connection = 'ethernet';
        else if (primaryType === '802-11-wireless')
            connection = 'wifi';
        else if (primary)
            connection = 'other';
        else if (connectivity === NM.ConnectivityState.NONE)
            connection = 'offline';

        let state = 'unavailable';
        let strength = null;
        const ap = wifiDev?.active_access_point ?? null;
        const ac = wifiDev?.active_connection ?? null;
        if (!wifiDev) {
            state = 'unavailable';
        } else if (!nm.wireless_enabled || !nm.wireless_hardware_enabled) {
            state = 'off';
        } else if (wifiDev.state === NM.DeviceState.ACTIVATED) {
            strength = ap?.strength ?? null;
            const settings = ac?.get_connection?.();
            const mode = settings?.get_setting_wireless?.()?.get_mode?.();
            const method = settings?.get_setting_ip4_config?.()?.get_method?.();
            if (mode === 'ap' || method === 'shared')
                state = 'shared';
            else if (mode === 'adhoc')
                state = 'temporary';
            else if (!online && connection === 'wifi')
                state = 'noInternet';
            else if (wifiDev.get_metered?.() === NM.Metered.GUESS_YES &&
                     ac?.get_ip4_config?.()?.get_gateway?.() === '172.20.10.1')
                // NetworkManager only guesses "metered"; an iPhone's Personal
                // Hotspot always serves 172.20.10.0/28 from 172.20.10.1.
                state = 'hotspot';
            else
                state = 'connected';
        } else if (wifiDev.state === NM.DeviceState.UNAVAILABLE) {
            state = 'off';
        } else {
            state = 'notAssociated';
        }
        this.network = {connection, wifi: {state, strength}};

        const ssid = ap?.get_ssid?.();
        const freq = ap?.frequency ?? 0;
        const ip4 = (connection === 'ethernet' ? primary : ac)?.get_ip4_config?.();
        const vpns = nm.get_active_connections().filter(c => c.vpn || c.type === 'wireguard');
        this.networkInfo = {
            ssid: ssid ? new TextDecoder().decode(ssid.get_data()) : null,
            frequency: freq,
            band: freq >= 5925 ? '6 GHz' : freq >= 4900 ? '5 GHz' : freq ? '2.4 GHz' : null,
            channel: ap ? channelFor(freq) : null,
            strength,
            dbm: strength === null ? null : Math.round(strength / 2 - 100),
            bitrate: wifiDev?.bitrate ? Math.round(wifiDev.bitrate / 1000) : null,
            bssid: ap?.bssid ?? null,
            security: ap ? securityName(ap) : null,
            address: ip4?.get_addresses?.()?.[0]?.get_address?.() ?? null,
            gateway: ip4?.get_gateway?.() ?? null,
            dns: ip4?.get_nameservers?.() ?? [],
            interface: (connection === 'ethernet' ? primary?.get_devices()?.[0] : wifiDev)?.get_iface?.() ?? null,
            ethernetSpeed: primary?.get_devices?.()?.[0]?.speed ?? null,
            connectivity,
            wirelessEnabled: !!nm.wireless_enabled,
            vpn: vpns.map(v => ({id: v.id, state: v.state, active: v})),
        };
        this._changed('network');
    }

    /** Nearby networks, strongest first, one row per SSID. */
    get accessPoints() {
        const dev = this.wifiDevice;
        if (!dev)
            return [];
        const activeSsid = this.networkInfo.ssid;
        const bySsid = new Map();
        for (const ap of dev.get_access_points()) {
            const raw = ap.get_ssid();
            if (!raw)
                continue;
            const ssid = new TextDecoder().decode(raw.get_data());
            const prev = bySsid.get(ssid);
            if (!prev || ap.strength > prev.strength)
                bySsid.set(ssid, {ssid, strength: ap.strength, secure: securityName(ap) !== null, ap, active: ssid === activeSsid});
        }
        return [...bySsid.values()].sort((a, b) => Number(b.active) - Number(a.active) || b.strength - a.strength);
    }

    /** SSIDs with a saved profile for the Wi-Fi device ("Known Networks"). */
    get savedSsids() {
        const dev = this.wifiDevice;
        if (!dev || !this._nm)
            return [];
        // Not dev.filter_connections(): its transfer annotation is wrong for
        // bindings (libnm docs, gobject-introspection#305), so GJS unrefs
        // connections NMClient still owns and later reads hit freed objects.
        return this._nm.get_connections().filter(c => dev.connection_valid(c))
            .map(c => c.get_setting_wireless()?.get_ssid())
            .filter(Boolean)
            .map(b => new TextDecoder().decode(b.get_data()));
    }

    requestScan() {
        this.wifiDevice?.request_scan_async(null).catch(() => {});
    }

    setWirelessEnabled(on) {
        if (this._nm)
            this._nm.dbus_set_property(NM.DBUS_PATH, NM.DBUS_INTERFACE, 'WirelessEnabled',
                GLib.Variant.new_boolean(on), -1, null, null);
    }

    /**
     * Joins a network. Saved profiles activate directly; a new secured network
     * goes through add_and_activate, and GNOME Shell's own network agent asks
     * for the password, so this extension never sees or stores it.
     */
    async connectToNetwork({ssid, ap}) {
        const dev = this.wifiDevice;
        if (!dev || !this._nm)
            return;
        const saved = this._nm.get_connections().filter(c => dev.connection_valid(c))
            .find(c => {
                const s = c.get_setting_wireless()?.get_ssid();
                return s && new TextDecoder().decode(s.get_data()) === ssid;
            });
        if (saved)
            await this._nm.activate_connection_async(saved, dev, null, null);
        else
            await this._nm.add_and_activate_connection_async(null, dev, ap.get_path(), null);
    }

    /** Configured VPN / WireGuard profiles, most recently used first. */
    get vpnProfiles() {
        if (!this._nm)
            return [];
        return this._nm.get_connections()
            .filter(c => c.is_type('vpn') || c.is_type('wireguard'))
            .map(c => ({connection: c, id: c.get_id(), uuid: c.get_uuid(),
                timestamp: c.get_setting_connection()?.get_timestamp() ?? 0}))
            .sort((a, b) => b.timestamp - a.timestamp);
    }

    /** Disconnects every active tunnel, or connects the most recent profile. */
    async toggleVpn() {
        const active = this.networkInfo.vpn ?? [];
        try {
            if (active.length) {
                for (const v of active)
                    await this._nm.deactivate_connection_async(v.active, null);
            } else {
                const profile = this.vpnProfiles[0];
                if (profile)
                    await this._nm.activate_connection_async(profile.connection, null, null, null);
            }
        } catch (e) {
            console.warn(`[status-trio] vpn: ${e}`);
        }
    }

    // --- Volume -----------------------------------------------------------------

    _initVolume() {
        this._mixer = getMixerControl();
        this._mixer.connectObject(
            'state-changed', () => this._syncAudio(),
            'default-sink-changed', () => this._syncAudio(),
            'default-source-changed', () => this._syncAudio(),
            'output-added', () => this._syncAudio(), 'output-removed', () => this._syncAudio(),
            'input-added', () => this._syncAudio(), 'input-removed', () => this._syncAudio(),
            'active-output-update', () => this._syncAudio(), 'active-input-update', () => this._syncAudio(),
            'stream-added', () => this._syncAudio(), 'stream-removed', () => this._syncAudio(), this);
        this._syncAudio();
    }

    get mixer() {
        return this._mixer;
    }

    _syncAudio() {
        const m = this._mixer;
        if (m.get_state() !== Gvc.MixerControlState.READY)
            return;
        const sink = m.get_default_sink();
        const source = m.get_default_source();
        if (sink !== this._sink) {
            this._sink?.disconnectObject(this);
            this._sink = sink;
            sink?.connectObject('notify::volume', () => this._syncVolume(), 'notify::is-muted',
                () => this._syncVolume(), 'notify::port', () => this._syncAudio(), this);
        }
        if (source !== this._source) {
            this._source?.disconnectObject(this);
            this._source = source;
            source?.connectObject('notify::volume', () => this._changed('audio'), 'notify::is-muted',
                () => this._changed('audio'), this);
        }
        // Gvc ids are a single increasing counter; probe them so devices that
        // appeared before the extension started are listed too.
        const outputs = [], inputs = [];
        for (let id = 1; id < 256; id++) {
            const out = m.lookup_output_id(id);
            if (out)
                outputs.push({id, device: out, name: out.get_description(), origin: out.get_origin(),
                    icon: out.get_icon_name(), stream: m.get_stream_from_device(out)});
            const inp = m.lookup_input_id(id);
            if (inp)
                inputs.push({id, device: inp, name: inp.get_description(), origin: inp.get_origin(),
                    icon: inp.get_icon_name(), stream: m.get_stream_from_device(inp)});
        }
        const activeOut = sink ? m.lookup_device_from_stream(sink) : null;
        const activeIn = source ? m.lookup_device_from_stream(source) : null;
        const activeOutId = activeOut?.get_id() ?? null;
        const activeInId = activeIn?.get_id() ?? null;
        this.audio = {
            outputs: outputs.filter(o => o.id === activeOutId || portAvailable(m, o.device, o.stream)),
            inputs: inputs.filter(i => i.id === activeInId || (i.stream && portAvailable(m, i.device, i.stream))),
            output: activeOut ? activeOut.get_id() : null,
            input: activeIn ? activeIn.get_id() : null,
        };
        this._syncVolume();
    }

    _syncVolume() {
        const m = this._mixer;
        const sink = this._sink;
        const max = m.get_vol_max_norm();
        const name = sink?.get_name?.() ?? '';
        const isBluetooth = name.startsWith('bluez_output') || sink?.get_icon_name?.()?.includes('bluetooth');
        const description = sink ? (m.lookup_device_from_stream(sink)?.get_description() ?? sink.get_description()) : '';
        this.volume = {
            scalar: sink ? Math.min(1, sink.volume / max) : null,
            isMuted: !!sink?.is_muted,
            isBluetooth: !!isBluetooth,
            deviceIcon: isBluetooth ? bluetoothSymbolFor(sink?.get_description?.() ?? '', sink?.get_form_factor?.()) : null,
            deviceName: description,
        };
        this._changed('volume');
    }

    get sinkStream() {
        return this._sink ?? null;
    }

    get sourceStream() {
        return this._source ?? null;
    }

    setVolume(stream, value) {
        if (!stream)
            return;
        const max = this._mixer.get_vol_max_norm();
        const v = Math.min(1, Math.max(0, value));
        // Like GNOME's own slider: 0 also mutes, anything above unmutes.
        stream.volume = v * max;
        stream.push_volume();
        if (stream.is_muted !== (v === 0))
            stream.change_is_muted(v === 0);
    }

    toggleMute(stream) {
        stream?.change_is_muted(!stream.is_muted);
    }

    activateOutput(entry) {
        this._mixer.change_output(entry.device);
    }

    activateInput(entry) {
        this._mixer.change_input(entry.device);
    }

    // --- Bluetooth --------------------------------------------------------------

    _initBluetooth() {
        try {
            this._bt = new GnomeBluetooth.Client();
        } catch (e) {
            console.debug(`[status-trio] bluetooth: ${e}`);
            return;
        }
        const sync = () => this._syncBluetooth();
        this._bt.connectObject('notify::default-adapter-powered', sync, 'notify::default-adapter-state', sync,
            'notify::default-adapter', sync, 'device-added', () => this._watchBtDevices(),
            'device-removed', () => this._watchBtDevices(), this);
        this._watchBtDevices();
    }

    _watchBtDevices() {
        for (const d of this._btDevices ?? [])
            d.disconnectObject(this);
        const store = this._bt.get_devices();
        this._btDevices = [];
        for (let i = 0; i < store.get_n_items(); i++) {
            const d = store.get_item(i);
            this._btDevices.push(d);
            d.connectObject('notify', () => this._syncBluetooth(), this);
        }
        this._syncBluetooth();
    }

    _syncBluetooth() {
        const bt = this._bt;
        const devices = (this._btDevices ?? []).filter(d => d.paired || d.trusted).map(d => ({
            device: d,
            name: d.alias || d.name || d.address,
            connected: d.connected,
            icon: d.icon,
            battery: d.battery_type !== 0 /* NONE */ && d.battery_percentage >= 0 ? Math.round(d.battery_percentage) : null,
            symbol: bluetoothSymbolFor(d.alias || d.name || '', d.icon?.includes('speaker') ? 'speaker' : ''),
            path: d.get_object_path(),
        })).sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name));
        this.bluetooth = {
            available: !!bt.default_adapter,
            powered: !!bt.default_adapter_powered,
            devices,
        };
        this._changed('bluetooth');
    }

    setBluetoothPowered(on) {
        if (this._bt)
            this._bt.default_adapter_powered = on;
    }

    async toggleBluetoothDevice(entry) {
        try {
            await this._bt.connect_service(entry.path, !entry.connected, null);
        } catch (e) {
            console.warn(`[status-trio] bluetooth ${entry.name}: ${e}`);
        }
    }

    // --- Input source -----------------------------------------------------------

    _initInputSources() {
        this._ism = getInputSourceManager();
        this._ism.connectObject('current-source-changed', () => this._syncInputSource(),
            'sources-changed', () => this._syncInputSource(), this);
        this._syncInputSource();
    }

    _syncInputSource() {
        const src = this._ism.currentSource;
        this.inputSource = src ? {label: src.shortName, name: src.displayName, id: src.id} : null;
        this._changed('input');
    }

    get inputSources() {
        return Object.values(this._ism.inputSources ?? {}).sort((a, b) => a.index - b.index);
    }

    // ---------------------------------------------------------------------------

    destroy() {
        this._destroyed = true;
        this._cancellable.cancel();
        if (this._emitId)
            GLib.source_remove(this._emitId);
        for (const o of [this._upower, this._display, this._battery, this._adapter, this._profiles, this._nm,
            this._ap, this._mixer, this._sink, this._source, this._bt, this._ism,
            ...(this._watchedDevices ?? []), ...(this._btDevices ?? [])])
            o?.disconnectObject?.(this);
        this._bt = null;
        this._nm = null;
    }
}

function channelFor(freq) {
    if (freq >= 5955)
        return Math.round((freq - 5950) / 5);
    if (freq >= 5000)
        return Math.round((freq - 5000) / 5);
    if (freq === 2484)
        return 14;
    if (freq >= 2412)
        return Math.round((freq - 2407) / 5);
    return null;
}

function securityName(ap) {
    const rsn = ap.rsn_flags, wpa = ap.wpa_flags;
    if (rsn & NM['80211ApSecurityFlags'].KEY_MGMT_SAE)
        return 'WPA3';
    if (rsn & NM['80211ApSecurityFlags'].KEY_MGMT_802_1X || wpa & NM['80211ApSecurityFlags'].KEY_MGMT_802_1X)
        return 'WPA Enterprise';
    if (rsn)
        return 'WPA2';
    if (wpa)
        return 'WPA';
    if (ap.flags & NM['80211ApFlags'].PRIVACY)
        return 'WEP';
    return null;
}
