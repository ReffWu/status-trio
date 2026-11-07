// SPDX-License-Identifier: Apache-2.0
// The 33 states of Tests/StatusTrioCoreTests/TestSupport/IconStateSheet.swift,
// in the same order, so tools/compare-reference.py can diff each one against
// the PNG the macOS renderer wrote for it.

import {DEFAULT_OPTIONS, EMPTY_SNAPSHOT} from '../gnome-extension/lib/scene.js';

// The sheet renders with the macOS `.standard` option sets, which differ from
// the app's user defaults (Wi-Fi/Bluetooth size 1.0, no blue volume).
const SHEET_OPTIONS = {
    battery: {...DEFAULT_OPTIONS.battery},
    connection: {...DEFAULT_OPTIONS.connection, wifiScale: 1.0},
    volume: {...DEFAULT_OPTIONS.volume},
    bluetooth: {...DEFAULT_OPTIONS.bluetooth, usesVolumeColor: false, iconColor: 'blue'},
};

const battery = (percentage, {charging = false, charged = false, connected = false, lowPower = false} = {}) => ({
    isPresent: true, percentage, isCharging: charging, isCharged: charged,
    isConnectedToPower: connected, isLowPowerMode: lowPower, isHighPowerMode: false,
});

// macOS RSSI fixtures converted to NetworkManager quality: 2 × (dBm + 100).
const rssi = dbm => Math.max(0, Math.min(100, 2 * (dbm + 100)));

const AIRPODS = {isBluetooth: true, deviceIcon: 'bt-airpods.pro'};

function entry(en, {bat, wifi, connection = 'wifi', battery: bo, connectionOptions, volume: vo, bluetooth: bto,
    volumeStatus, bluetoothDevice, volumeScalar = 0.6} = {}) {
    let vol = volumeStatus ?? {scalar: 0.6, isMuted: false, isBluetooth: false, deviceIcon: null};
    if (!volumeStatus && bluetoothDevice)
        vol = {scalar: volumeScalar, isMuted: false, ...bluetoothDevice};
    return {
        en,
        snapshot: {
            ...EMPTY_SNAPSHOT,
            battery: bat ?? battery(76),
            wifi: wifi ?? {state: 'connected', strength: rssi(-52)},
            connection,
            volume: vol,
        },
        options: {
            battery: {...SHEET_OPTIONS.battery, ...bo},
            connection: {...SHEET_OPTIONS.connection, ...connectionOptions},
            volume: {...SHEET_OPTIONS.volume, ...vo},
            bluetooth: {...SHEET_OPTIONS.bluetooth, ...bto},
        },
    };
}

const dots = (scalar, isMuted = false) => ({scalar, isMuted, isBluetooth: false, deviceIcon: null});

export const FIXTURES = [
    entry('Charging', {bat: battery(76, {charging: true, connected: true})}),
    entry('Plugged in, not charging', {bat: battery(76, {connected: true})}),
    entry('Fully charged', {bat: battery(100, {charged: true, connected: true})}),
    entry('On battery (percentage)', {bat: battery(76)}),
    entry('Low battery', {bat: battery(15)}),
    entry('Low Power Mode', {bat: battery(55, {lowPower: true})}),
    entry('Ring only', {bat: battery(76), battery: {showsPercentage: false, showsChargingIndicator: false}}),
    entry('Percentage while plugged in', {bat: battery(76, {connected: true}), battery: {connectedIndicator: 'percentage'}}),
    entry('Connected (3 bars)', {wifi: {state: 'connected', strength: rssi(-52)}}),
    entry('Connected (2 bars)', {wifi: {state: 'connected', strength: rssi(-75)}}),
    entry('Connected (1 bar)', {wifi: {state: 'connected', strength: rssi(-85)}}),
    entry('Wi-Fi on, not associated', {wifi: {state: 'notAssociated', strength: null}}),
    entry('Wi-Fi off or unavailable', {wifi: {state: 'off', strength: null}}),
    entry('No internet', {wifi: {state: 'noInternet', strength: rssi(-58)}}),
    entry('Personal Hotspot', {wifi: {state: 'hotspot', strength: rssi(-58)}}),
    entry('Temporary connection', {wifi: {state: 'temporary', strength: rssi(-58)}}),
    entry('Internet Sharing', {wifi: {state: 'shared', strength: rssi(-58)}}),
    entry('Wired (Ethernet)', {connection: 'ethernet'}),
    entry('Ethernet as Wi-Fi icon', {connection: 'ethernet', connectionOptions: {showsWiFiIconForEthernet: true}}),
    entry('Hotspot as Wi-Fi icon', {wifi: {state: 'hotspot', strength: rssi(-58)}, connectionOptions: {showsWiFiIconForHotspot: true}}),
    entry('Bluetooth device as the middle icon', {connectionOptions: {centerSource: 'bluetoothDevice'}, bluetoothDevice: AIRPODS}),
    entry('Network error takes priority', {wifi: {state: 'noInternet', strength: rssi(-58)},
        connectionOptions: {centerSource: 'bluetoothDevice'}, bluetoothDevice: AIRPODS}),
    entry('Wi-Fi while the middle icon is Network', {bluetoothDevice: AIRPODS}),
    entry('Blue volume dots', {bluetooth: {usesVolumeColor: true}, bluetoothDevice: AIRPODS, volumeScalar: 0.75}),
    entry('Blue volume arc', {volume: {displayStyle: 'arc'}, bluetooth: {usesVolumeColor: true}, bluetoothDevice: AIRPODS}),
    entry('Monochrome volume while the color is off', {bluetoothDevice: AIRPODS, volumeScalar: 0.75}),
    entry('Volume 100% (dots)', {volumeStatus: dots(1.0)}),
    entry('Volume 60% (dots)', {volumeStatus: dots(0.6)}),
    entry('Volume 25% (dots)', {volumeStatus: dots(0.25)}),
    entry('Muted (dots)', {volumeStatus: dots(0.6, true)}),
    entry('Volume 75% (arc)', {volume: {displayStyle: 'arc'}, volumeStatus: dots(0.75)}),
    entry('Volume 30% (arc)', {volume: {displayStyle: 'arc'}, volumeStatus: dots(0.3)}),
    entry('Muted (arc)', {volume: {displayStyle: 'arc'}, volumeStatus: dots(0.6, true)}),
];
