import Foundation

enum BatteryColorRole: Equatable, Sendable {
    case foreground
    case critical
    case lowPower
    case charging
}

enum WiFiSummaryAction: Equatable, Sendable {
    case openDetails
    case requestNameAccess
    case openLocationSettings
}

enum StatusMappings {
    static func wifiBars(rssi: Int?) -> Int {
        guard let rssi else { return 0 }
        switch rssi {
        // Parentheses are required for this negative partial range in Swift 6.
        case (-72)...:
            return 3
        case -82 ... -73:
            return 2
        case -90 ... -83:
            return 1
        default:
            return 0
        }
    }

    static func wifiSummaryAction(for wifi: WiFiStatus) -> WiFiSummaryAction {
        guard wifi.state.isNetworkAssociated else { return .openDetails }

        switch wifi.nameAccess {
        case .authorized:
            return .openDetails
        case .notDetermined:
            return .requestNameAccess
        case .denied, .restricted:
            return .openLocationSettings
        }
    }

    static func volumeSteps(scalar: Double?, isMuted: Bool) -> Int? {
        guard let scalar else { return nil }
        let clamped = min(1, max(0, scalar))
        if isMuted || clamped == 0 { return 0 }
        if clamped <= 0.25 { return 1 }
        if clamped <= 0.50 { return 2 }
        if clamped <= 0.75 { return 3 }
        return 4
    }

    static func batteryColorRole(
        _ battery: BatteryStatus,
        criticalThreshold: Int = 20
    ) -> BatteryColorRole {
        let threshold = min(100, max(0, criticalThreshold))
        if battery.percentage < threshold { return .critical }
        if battery.isLowPowerMode { return .lowPower }
        if battery.isCharging || battery.isConnectedToPower { return .charging }
        return .foreground
    }

    static func batteryProgress(_ battery: BatteryStatus) -> Double {
        Double(battery.percentage) / 100.0
    }
}
