import AppKit
import SwiftUI

struct WiFiNetworkListView: View {
    @ObservedObject var controller: WiFiNetworkController
    @EnvironmentObject private var localization: Localization
    let wifi: WiFiStatus
    let onBack: () -> Void
    let onRequestNameAccess: () -> Void
    let onOpenWiFiSettings: () -> Void
    let onOpenLocationSettings: () -> Void
    let showsDetailsInitially: Bool

    @State private var showsDetails = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            Toggle(
                localization.string(.wifiPower),
                isOn: Binding(
                    get: { controller.state != .poweredOff && wifi.state != .off },
                    set: { controller.setPower($0) }
                )
            )
            .disabled(controller.state == .noInterface)

            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    currentNetworkSection
                    otherNetworksSection
                    stateMessage
                }
            }
            .frame(maxHeight: 330)

            Divider()
            Button(localization.string(.wifiActionOpenSettings), action: onOpenWiFiSettings)
                .buttonStyle(.plain)
                .accessibilityLabel(localization.string(.wifiActionOpenSettings))
        }
        .onAppear {
            controller.activate(nameAccess: wifi.nameAccess)
            showsDetails = showsDetails || showsDetailsInitially
        }
        .sheet(item: Binding(
            get: { controller.passwordPromptNetwork },
            set: { if $0 == nil { controller.cancelPasswordEntry() } }
        )) { network in
            WiFiPasswordSheet(network: network) { password, remember in
                controller.connect(to: network, password: password, rememberPassword: remember)
            }
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            Button(action: onBack) {
                Image(systemName: "chevron.backward")
            }
            .buttonStyle(.plain)
            .accessibilityLabel(localization.string(.commonBack))

            Text(localization.string(.wifiTitle))
                .font(.headline)
            Spacer()
            Button(action: { controller.refresh(nameAccess: wifi.nameAccess) }) {
                Image(systemName: "arrow.clockwise")
            }
            .buttonStyle(.plain)
            .disabled(controller.state.isScanning)
            .accessibilityLabel(localization.string(.wifiRefresh))
        }
    }

    @ViewBuilder
    private var currentNetworkSection: some View {
        if let connected = controller.networks.first(where: \.isConnected) {
            Text(localization.string(.wifiCurrentNetwork))
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            networkRow(connected)

            Button {
                showsDetails.toggle()
            } label: {
                Label(
                    localization.string(showsDetails ? .wifiDetailsHide : .wifiDetailsShow),
                    systemImage: showsDetails ? "chevron.up" : "info.circle"
                )
            }
            .buttonStyle(.plain)
            .accessibilityLabel(localization.string(.wifiDetailsShow))

            if showsDetails {
                WiFiDetailsView(details: controller.details)
            }
        } else if controller.details.ssid != nil {
            Text(localization.string(.wifiCurrentNetwork))
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            WiFiDetailsView(details: controller.details)
        }
    }

    @ViewBuilder
    private var otherNetworksSection: some View {
        let others = controller.networks.filter { !$0.isConnected }
        if !others.isEmpty {
            Text(localization.string(.wifiOtherNetworks))
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            ForEach(others) { network in
                networkRow(network)
            }
        }
    }

    @ViewBuilder
    private var stateMessage: some View {
        switch controller.state {
        case .scanning:
            HStack(spacing: 8) {
                ProgressView()
                    .controlSize(.small)
                Text(localization.string(.wifiScanning))
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        case .ready where controller.credentialIssue == .saveFailed:
            Text(localization.string(.wifiPasswordSaveFailed))
                .font(.caption)
                .foregroundStyle(.orange)
        case .ready where controller.networks.isEmpty:
            Text(localization.string(.wifiNoNetworks))
                .font(.caption)
                .foregroundStyle(.secondary)
        case .poweredOff:
            Text(localization.string(.wifiPanelOff))
                .font(.caption)
                .foregroundStyle(.secondary)
        case .noInterface:
            Text(localization.string(.wifiNoInterface))
                .font(.caption)
                .foregroundStyle(.secondary)
        case .permissionDenied:
            Button(localization.string(.wifiPermissionDenied), action: onOpenLocationSettings)
                .buttonStyle(.plain)
                .font(.caption)
                .foregroundStyle(.secondary)
        case .failed:
            Text(localization.string(.wifiScanFailed))
                .font(.caption)
                .foregroundStyle(.secondary)
        case .connectionFailed:
            Text(localization.string(.wifiConnectionFailed))
                .font(.caption)
                .foregroundStyle(.red)
        case .connectionTimedOut:
            Text(localization.string(.wifiConnectionTimedOut))
                .font(.caption)
                .foregroundStyle(.red)
        case .networkUnavailable:
            Text(localization.string(.wifiNetworkUnavailable))
                .font(.caption)
                .foregroundStyle(.red)
        case .enterpriseNetwork:
            Button(localization.string(.wifiEnterpriseUnsupported), action: onOpenWiFiSettings)
                .buttonStyle(.link)
                .font(.caption)
        case .resolvingCredentials:
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text(localization.string(.wifiCredentialsChecking))
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        case .credentialAccessCancelled:
            credentialAccessMessage(.wifiCredentialAccessCancelled)
        case .credentialAccessDenied:
            credentialAccessMessage(.wifiCredentialAccessDenied)
        case .credentialStoreLocked:
            credentialAccessMessage(.wifiCredentialStoreLocked)
        case .credentialReadFailed:
            credentialAccessMessage(.wifiCredentialReadFailed)
        case .needsPassword:
            EmptyView()
        case .idle, .connecting(_), .ready:
            if wifi.nameAccess == .notDetermined {
                Button(localization.string(.wifiActionRequestNameAccess), action: onRequestNameAccess)
                    .buttonStyle(.plain)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func credentialAccessMessage(_ key: LocalizationKey) -> some View {
        HStack(spacing: 8) {
            Text(localization.string(key))
                .font(.caption)
                .foregroundStyle(.secondary)
            Button(localization.string(.wifiCredentialEnterPassword)) {
                controller.enterPasswordManually()
            }
            .buttonStyle(.link)
            .font(.caption)
        }
    }

    private func networkRow(_ network: WiFiNetwork) -> some View {
        Button {
            guard !network.isConnected else { return }
            controller.beginConnection(to: network)
        } label: {
            HStack(spacing: 10) {
                Image(systemName: network.isConnected ? "checkmark" : "wifi")
                    .frame(width: 16)
                    .foregroundStyle(network.isConnected ? Color.accentColor : Color.secondary)
                Text(displaySSID(network.ssid))
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: 8)
                if network.security.requiresPassword {
                    Image(systemName: "lock.fill")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                }
                networkSignalIcon(for: network.rssi)
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(isConnectingAnotherNetwork)
        .accessibilityLabel(networkAccessibilityLabel(network))
    }

    private var isConnectingAnotherNetwork: Bool {
        controller.state.isConnectionFlow
    }

    private func displaySSID(_ ssid: String) -> String {
        ssid.isEmpty ? localization.string(.wifiHiddenNetwork) : ssid
    }

    @ViewBuilder
    private func networkSignalIcon(for rssi: Int?) -> some View {
        if let rssi {
            let bars = StatusMappings.wifiBars(rssi: rssi)
            if bars == 0 {
                Image(systemName: "wifi.exclamationmark")
            } else {
                Image(systemName: "wifi", variableValue: max(0.25, Double(bars) / 3.0))
            }
        } else {
            Image(systemName: "wifi.exclamationmark")
        }
    }

    private func networkAccessibilityLabel(_ network: WiFiNetwork) -> String {
        let name = displaySSID(network.ssid)
        let connection = network.isConnected
            ? localization.string(.wifiConnected)
            : localization.string(.wifiNotConnected)
        return "\(name), \(connection)"
    }
}

private struct WiFiPasswordSheet: View {
    @EnvironmentObject private var localization: Localization
    let network: WiFiNetwork
    let onConnect: (String?, Bool) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var password = ""
    @State private var rememberPassword = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(localization.string(.wifiJoinNetwork))
                .font(.headline)
            Text(network.ssid.isEmpty ? localization.string(.wifiHiddenNetwork) : network.ssid)
                .lineLimit(1)
            if network.security.isEnterprise {
                Text(localization.string(.wifiEnterpriseUnsupported))
                    .font(.caption)
                Button(localization.string(.wifiActionOpenSettings), action: dismiss.callAsFunction)
            } else {
                SecureField(localization.string(.wifiPassword), text: $password)
                Toggle(localization.string(.wifiRememberPassword), isOn: $rememberPassword)
                Text(localization.string(.wifiPasswordKeychainNote))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                HStack {
                    Button(localization.string(.commonCancel), action: dismiss.callAsFunction)
                    Spacer()
                    Button(localization.string(.wifiJoin)) {
                        onConnect(password, rememberPassword)
                    }
                    .keyboardShortcut(.defaultAction)
                }
            }
        }
        .padding(20)
        .frame(width: 320)
    }
}

private struct WiFiDetailsView: View {
    @EnvironmentObject private var localization: Localization
    let details: WiFiConnectionDetails

    var body: some View {
        VStack(spacing: 5) {
            detail(.wifiDetailSSID, details.ssid)
            detail(.wifiDetailBSSID, details.bssid, copyable: true)
            detail(.wifiDetailBand, details.band)
            detail(.wifiDetailChannel, details.channel.map(String.init))
            detail(.wifiDetailChannelWidth, details.channelWidth)
            detail(.wifiDetailRSSI, details.rssi.map { "\($0) dBm" })
            detail(.wifiDetailPHY, details.phyMode)
            detail(.wifiDetailTxRate, details.transmitRateMbps.map { String(format: "%.1f Mbps", $0) })
            detail(.wifiDetailSecurity, securityName(details.security))
            if showsMore {
                detail(.wifiDetailNoise, details.noise.map { "\($0) dBm" })
                detail(.wifiDetailSNR, details.signalToNoiseRatio.map { "\($0) dB" })
                detail(.wifiDetailCountryCode, details.countryCode)
                detail(.wifiDetailInterface, details.interfaceName)
                detail(.wifiDetailIPv4, details.ipv4Addresses.joined(separator: ", "), copyable: true)
                detail(.wifiDetailIPv6, details.ipv6Addresses.joined(separator: ", "), copyable: true)
                detail(.wifiDetailRouter, details.router, copyable: true)
                detail(.wifiDetailDNS, details.dnsServers.joined(separator: ", "), copyable: true)
            }
            Button(showsMore ? localization.string(.wifiDetailsLess) : localization.string(.wifiDetailsMore)) {
                showsMore.toggle()
            }
            .buttonStyle(.plain)
        }
        .padding(.leading, 26)
        .font(.caption)
    }

    @State private var showsMore = false

    private func detail(_ label: LocalizationKey, _ value: String?, copyable: Bool = false) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(localization.string(label))
                .foregroundStyle(.secondary)
            Spacer()
            if copyable, let value, !value.isEmpty {
                Button(value) {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(value, forType: .string)
                }
                .buttonStyle(.plain)
                .textSelection(.enabled)
                .accessibilityLabel("\(localization.string(label)): \(value)")
            } else {
                Text(value?.isEmpty == false ? value! : localization.string(.wifiUnavailableValue))
                    .multilineTextAlignment(.trailing)
                    .textSelection(.enabled)
            }
        }
    }

    private func securityName(_ security: WiFiSecurityKind) -> String {
        switch security {
        case .open: localization.string(.wifiSecurityOpen)
        case .wep, .dynamicWEP: "WEP"
        case .wpaPersonal, .wpaPersonalMixed: "WPA"
        case .wpa2Personal, .personal: "WPA2"
        case .wpa3Personal, .wpa3Transition: "WPA3"
        case .owe: "OWE"
        case .oweTransition: "OWE Transition"
        case .wpaEnterprise, .wpaEnterpriseMixed, .wpa2Enterprise, .enterprise, .wpa3Enterprise:
            localization.string(.wifiSecurityEnterprise)
        case .unknown: localization.string(.wifiUnavailableValue)
        }
    }
}
