// SPDX-License-Identifier: Apache-2.0
// Port of Presentation/Icon/IconPresentationMapper.swift and Models/StatusMappings.swift.
//
// Pure functions: a status snapshot + options in, a renderable scene out. No
// GNOME imports, so the same module drives the panel icon, the preferences
// previews and the headless state-sheet renderer in tools/.

/** @typedef {'connected'|'notAssociated'|'off'|'unavailable'|'noInternet'|'hotspot'|'temporary'|'shared'} WiFiState */

export const DEFAULT_OPTIONS = Object.freeze({
    battery: {
        showsPercentage: true,
        showsChargingIndicator: true,
        showsChargingEffect: true,
        showsChargingBoltHeartbeat: true,
        splitGapProgress: false,
        usesStatusColors: true,
        criticalThreshold: 20,
        connectedIndicator: 'plug', // 'plug' | 'bolt' | 'percentage'
        fullThreshold: 100,
        textScale: 1.8,
        ringStrokeScale: 1.25, // light 1.0 · regular 1.25 · bold 1.5
    },
    connection: {
        // 'network' | 'bluetoothDevice' | 'inputSource' | 'batteryPercentage' | 'chargingStatus' | 'power'
        centerSource: 'network',
        prioritizesNetworkErrors: true,
        showsWiFiIconForEthernet: false,
        showsWiFiIconForHotspot: false,
        showsWiFiIconForTemporaryConnection: false,
        showsWiFiIconForInternetSharing: false,
        wifiScale: 1.6,
    },
    volume: {
        displayStyle: 'dots', // 'dots' | 'arc'
        ringStrokeScale: 1.25,
    },
    bluetooth: {
        usesVolumeColor: true,
        iconColor: 'primary', // 'primary' | 'blue'
        symbolScale: 1.6,
    },
});

export const EMPTY_SNAPSHOT = Object.freeze({
    battery: {isPresent: false, percentage: 100, isCharging: false, isCharged: false,
        isConnectedToPower: false, isLowPowerMode: false, isHighPowerMode: false},
    connection: 'unknown', // 'wifi' | 'ethernet' | 'other' | 'offline' | 'unknown'
    wifi: {state: 'unavailable', strength: null},
    // deviceIcon: an exported SF Symbol mask key such as 'bt-airpods.pro'.
    volume: {scalar: null, isMuted: false, isBluetooth: false, deviceIcon: null},
    inputSource: null, // {label, iconName}
    systemPowerWatts: null,
});

// --- StatusMappings ----------------------------------------------------------

/**
 * Wi-Fi bars. macOS maps RSSI (≥ -70 → 3, ≥ -78 → 2, ≥ -88 → 1). NetworkManager
 * exposes the same reading as a 0–100 quality (2 × (dBm + 100), clamped), so the
 * identical thresholds are -70 → 60, -78 → 44, -88 → 24.
 */
export function wifiBars(strength) {
    if (strength === null || strength === undefined || !Number.isFinite(strength))
        return 0;
    if (strength >= 60)
        return 3;
    if (strength >= 44)
        return 2;
    if (strength >= 24)
        return 1;
    return 0;
}

export function volumeSteps(scalar, isMuted) {
    if (scalar === null || scalar === undefined || !Number.isFinite(scalar))
        return null;
    const v = Math.min(1, Math.max(0, scalar));
    if (isMuted || v === 0)
        return 0;
    if (v <= 0.25)
        return 1;
    if (v <= 0.5)
        return 2;
    if (v <= 0.75)
        return 3;
    return 4;
}

export function batteryColorRole(battery, criticalThreshold = 20) {
    const threshold = Math.min(100, Math.max(0, criticalThreshold));
    if (battery.percentage < threshold)
        return 'critical';
    if (battery.isLowPowerMode)
        return 'lowPower';
    if (battery.isHighPowerMode)
        return 'highPower';
    if (battery.isCharging || battery.isConnectedToPower)
        return 'powered';
    return 'primary';
}

export function batteryGapContent(battery, options) {
    if (!battery.isPresent)
        return 'empty';
    if (options.showsChargingIndicator) {
        if (battery.isCharging)
            return 'bolt';
        if (battery.isConnectedToPower) {
            switch (options.connectedIndicator) {
            case 'bolt': return 'bolt';
            case 'percentage': return options.showsPercentage ? 'percentage' : 'plug';
            default: return 'plug';
            }
        }
    }
    return options.showsPercentage ? 'percentage' : 'empty';
}

export function batteryProgress(battery, fullThreshold = 100) {
    const t = Math.min(100, Math.max(1, fullThreshold));
    return Math.min(1, Math.max(0, battery.percentage / t));
}

const NETWORK_ERRORS = new Set(['notAssociated', 'noInternet', 'off', 'unavailable']);

export function isNetworkOffline(wifi, connection) {
    switch (connection) {
    case 'ethernet': case 'other': return false;
    case 'offline': return true;
    default: return NETWORK_ERRORS.has(wifi.state);
    }
}

// --- IconPresentationMapper --------------------------------------------------

export function buildScene(snapshot, options = DEFAULT_OPTIONS) {
    const battery = snapshot.battery;
    const chargingStatusCenter = options.connection.centerSource === 'chargingStatus' && battery.isPresent;
    const closesRing = chargingStatusCenter && !battery.isCharging && !battery.isConnectedToPower;
    return {
        ring: ringState(battery, options.battery, closesRing, chargingStatusCenter),
        center: centerState(snapshot, options),
        footer: footerState(snapshot.volume, options.volume, options.bluetooth),
    };
}

function ringState(battery, o, closesRing, chargingStatusCenter) {
    if (!battery.isPresent) {
        return {progress: 0, color: 'primary', gap: 'closed', accessory: null, effect: null,
            strokeScale: o.ringStrokeScale, splitProgress: false};
    }
    const color = o.usesStatusColors ? batteryColorRole(battery, o.criticalThreshold) : 'primary';
    const natural = batteryGapContent(battery, o);
    let gapContent = natural;
    if (!closesRing && chargingStatusCenter)
        gapContent = o.showsPercentage ? 'percentage' : 'empty';
    const gapStyle = {empty: 'closed', percentage: 'value', bolt: 'indicator', plug: 'indicator'}[gapContent];
    const gap = closesRing ? 'closed' : gapStyle;
    let accessory = null;
    if (!closesRing) {
        if (gapContent === 'percentage')
            accessory = {kind: 'text', text: `${battery.percentage}`, color: 'primary', scale: o.textScale};
        else if (gapContent === 'bolt' || gapContent === 'plug')
            accessory = {kind: gapContent, color: 'primary', scale: o.textScale};
    }
    const effect = o.showsChargingEffect && battery.isCharging && !battery.isCharged
        ? {
            pulsesAccessory: gapContent === 'bolt' && o.showsChargingBoltHeartbeat,
            tintsAccessory: gapContent === 'bolt' && o.showsChargingBoltHeartbeat &&
                o.usesStatusColors && color !== 'primary',
        }
        : null;
    return {
        progress: batteryProgress(battery, o.fullThreshold),
        color, gap, accessory, effect,
        strokeScale: o.ringStrokeScale,
        splitProgress: !closesRing && o.splitGapProgress,
    };
}

function centerState(snapshot, options) {
    const {battery} = snapshot;
    const c = options.connection;
    const b = options.bluetooth;

    if (c.prioritizesNetworkErrors && isNetworkOffline(snapshot.wifi, snapshot.connection))
        return networkState(snapshot, c);

    if (c.centerSource === 'power') {
        if (Number.isFinite(snapshot.systemPowerWatts))
            return text(`${Math.round(Math.min(999, Math.max(0, snapshot.systemPowerWatts)))}`, c.wifiScale);
        return text(battery.isPresent ? `${battery.percentage}` : '--', c.wifiScale);
    }

    if (c.centerSource === 'chargingStatus' && battery.isPresent) {
        if (battery.isCharging && !battery.isCharged)
            return {kind: 'bolt', color: 'primary', scale: c.wifiScale};
        if (battery.isConnectedToPower)
            return {kind: 'plug', color: 'primary', scale: c.wifiScale};
        return text(`${battery.percentage}`, c.wifiScale);
    }

    if (c.centerSource === 'batteryPercentage' && battery.isPresent)
        return text(`${battery.percentage}`, c.wifiScale);

    if (c.centerSource === 'inputSource' && snapshot.inputSource) {
        const src = snapshot.inputSource;
        if (src.label)
            return text(src.label, c.wifiScale);
        return {kind: 'icon', iconName: 'keyboard', color: 'primary', scale: c.wifiScale};
    }

    if (c.centerSource === 'bluetoothDevice' && snapshot.volume.isBluetooth) {
        return {
            kind: 'icon',
            iconName: snapshot.volume.deviceIcon || 'bt-headphones',
            color: b.iconColor === 'blue' ? 'bluetooth' : 'primary',
            scale: b.symbolScale,
        };
    }

    return networkState(snapshot, c);
}

function text(value, scale) {
    return {kind: 'text', text: value, color: 'primary', scale};
}

function networkState(snapshot, c) {
    if (snapshot.connection === 'ethernet') {
        return c.showsWiFiIconForEthernet
            ? wifi(3, 'primary', c.wifiScale)
            : {kind: 'ethernet', color: 'primary', scale: 1};
    }
    const w = snapshot.wifi;
    switch (w.state) {
    case 'connected':
        return connectedWiFi(w.strength, c.wifiScale);
    case 'notAssociated':
        return wifi(0, 'primary', c.wifiScale);
    case 'off': case 'unavailable':
        return {kind: 'wifiSlash', color: 'primary', scale: c.wifiScale};
    case 'noInternet':
        return {kind: 'wifiExclamation', color: 'primary', scale: c.wifiScale};
    case 'hotspot':
        return c.showsWiFiIconForHotspot
            ? connectedWiFi(w.strength, c.wifiScale)
            : {kind: 'hotspot', color: 'primary', scale: c.wifiScale};
    case 'temporary':
        return c.showsWiFiIconForTemporaryConnection
            ? connectedWiFi(w.strength, c.wifiScale)
            : {kind: 'screenWedge', color: 'primary', scale: c.wifiScale};
    case 'shared':
        return c.showsWiFiIconForInternetSharing
            ? connectedWiFi(w.strength, c.wifiScale)
            : {kind: 'arrowWedge', color: 'primary', scale: c.wifiScale};
    }
    return wifi(0, 'primary', c.wifiScale);
}

function connectedWiFi(strength, scale) {
    const bars = wifiBars(strength);
    // An associated interface never renders as a faded glyph when the reading
    // is unknown (#110); only a known-weak reading uses the muted track.
    const unknown = strength === null || strength === undefined;
    return wifi(unknown ? 3 : bars, unknown ? 'primary' : (bars === 0 ? 'inactive' : 'primary'), scale);
}

function wifi(bars, color, scale) {
    return {kind: 'wifi', bars, color, scale};
}

function footerState(volume, o, bt) {
    const scalar = Number.isFinite(volume.scalar) ? volume.scalar : null;
    const mayBlue = bt.usesVolumeColor && volume.isBluetooth;
    if (o.displayStyle === 'arc') {
        const progress = volume.isMuted ? 0 : (scalar ?? 0);
        return {kind: 'arc', progress, color: mayBlue && progress > 0 ? 'bluetooth' : 'primary',
            strokeScale: o.ringStrokeScale};
    }
    const steps = volumeSteps(scalar, volume.isMuted) ?? 0;
    return {kind: 'dots', count: 4, active: steps, color: mayBlue && steps > 0 ? 'bluetooth' : 'primary',
        strokeScale: o.ringStrokeScale};
}
