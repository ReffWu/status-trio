import SwiftUI

struct WiFiStatusIcon: View {
    @EnvironmentObject private var localization: Localization
    let wifi: WiFiStatus

    var body: some View {
        Group {
            switch wifi.state {
            case .connected:
                let bars = StatusMappings.wifiBars(rssi: wifi.rssi)
                Image(systemName: "wifi", variableValue: max(0.25, Double(bars) / 3.0))
            case .off, .unavailable:
                Image(systemName: "wifi.slash")
            case .noInternet:
                Image(systemName: "wifi.exclamationmark")
            case .hotspot:
                Image(systemName: "personalhotspot")
            case .notAssociated:
                Image(systemName: "wifi.exclamationmark")
            case .temporary, .shared:
                Image(systemName: "wifi")
            }
        }
        .font(.system(size: 14, weight: .medium))
        .foregroundStyle(.secondary)
        .frame(width: 24, height: 24)
        .accessibilityLabel(localization.format(.commonLabelValue, localization.string(.networkTitle), StatusPresentation.wifiValue(wifi, localization: localization)))
    }
}
