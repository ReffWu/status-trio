// SPDX-License-Identifier: Apache-2.0
// GSettings → scene options (scene.js DEFAULT_OPTIONS shape).

const STROKE = {light: 1.0, regular: 1.25, bold: 1.5};

export function readOptions(s) {
    const stroke = STROKE[s.get_string('ring-stroke')] ?? 1.25;
    return {
        battery: {
            showsPercentage: s.get_boolean('show-percentage'),
            showsChargingIndicator: s.get_boolean('show-charging-indicator'),
            showsChargingEffect: s.get_boolean('charging-effect'),
            showsChargingBoltHeartbeat: s.get_boolean('bolt-heartbeat'),
            splitGapProgress: s.get_boolean('split-gap-progress'),
            usesStatusColors: s.get_boolean('status-colors'),
            criticalThreshold: s.get_int('critical-threshold'),
            connectedIndicator: s.get_string('connected-indicator'),
            fullThreshold: s.get_int('full-threshold'),
            textScale: s.get_double('battery-text-scale'),
            ringStrokeScale: stroke,
        },
        connection: {
            centerSource: s.get_string('center-source'),
            prioritizesNetworkErrors: s.get_boolean('prioritize-network-errors'),
            showsWiFiIconForEthernet: s.get_boolean('wifi-icon-for-ethernet'),
            showsWiFiIconForHotspot: s.get_boolean('wifi-icon-for-hotspot'),
            showsWiFiIconForTemporaryConnection: s.get_boolean('wifi-icon-for-temporary'),
            showsWiFiIconForInternetSharing: s.get_boolean('wifi-icon-for-sharing'),
            wifiScale: s.get_double('wifi-scale'),
        },
        volume: {
            displayStyle: s.get_string('volume-style'),
            ringStrokeScale: stroke,
        },
        bluetooth: {
            usesVolumeColor: s.get_boolean('bluetooth-volume-color'),
            iconColor: s.get_string('bluetooth-icon-color'),
            symbolScale: s.get_double('bluetooth-scale'),
        },
    };
}
