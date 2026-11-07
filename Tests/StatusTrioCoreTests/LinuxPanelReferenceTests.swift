import AppKit
import SwiftUI
import XCTest
@testable import StatusTrioCore

/// Renders the real summary panel sections to PNG so the GNOME port can be
/// compared against them. Runs only with STATUS_TRIO_LINUX_PANEL_REF set.
@MainActor
final class LinuxPanelReferenceTests: XCTestCase {
    func testRenderPanelReference() throws {
        guard let out = ProcessInfo.processInfo.environment["STATUS_TRIO_LINUX_PANEL_REF"] else {
            throw XCTSkip("set STATUS_TRIO_LINUX_PANEL_REF")
        }
        try FileManager.default.createDirectory(atPath: out, withIntermediateDirectories: true)
        for language in ["en", "zh-Hans"] {
            for dark in [false, true] {
                let suite = "LinuxPanelReference.\(UUID().uuidString)"
                let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
                defer { defaults.removeTestSuite(named: suite) }
                let l10n = Localization(defaults: defaults, preferredLanguages: [language])
                let view = panel(l10n)
                    .frame(width: 330)
                    .background(Color(nsColor: .windowBackgroundColor))
                    .environmentObject(l10n)
                    .environment(\.colorScheme, dark ? .dark : .light)
                let hosting = NSHostingView(rootView: view)
                hosting.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
                hosting.frame = NSRect(origin: .zero, size: hosting.fittingSize)
                hosting.layoutSubtreeIfNeeded()
                hosting.frame = NSRect(origin: .zero, size: hosting.fittingSize)
                hosting.layoutSubtreeIfNeeded()
                let size = hosting.bounds.size
                let rep = try XCTUnwrap(NSBitmapImageRep(
                    bitmapDataPlanes: nil, pixelsWide: Int(size.width * 2), pixelsHigh: Int(size.height * 2),
                    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0))
                rep.size = size
                hosting.appearance?.performAsCurrentDrawingAppearance {
                    hosting.cacheDisplay(in: hosting.bounds, to: rep)
                }
                let name = "panel-\(language)-\(dark ? "dark" : "light").png"
                try XCTUnwrap(rep.representation(using: .png, properties: [:]))
                    .write(to: URL(fileURLWithPath: out).appendingPathComponent(name))
            }
        }
    }

    private func panel(_ l10n: Localization) -> some View {
        let battery = PanelPresentationMapper.battery(
            BatteryStatus(rawPercentage: 76, isPresent: true, isCharging: false,
                          isLowPowerMode: false, isConnectedToPower: false),
            localization: l10n)
        let network = PanelPresentationMapper.network(
            wifi: WiFiStatus(state: .connected, rssi: -52, ssid: "Office-5G",
                             nameAccess: .authorized, band: .fiveGHz),
            connection: .wifi, wired: nil, isConstrained: false, isResolvingName: false,
            localIPAddress: "192.168.1.20", localization: l10n)
        let volume = AudioPanelMapper.volume(
            VolumeStatus(scalar: 0.4, isMuted: false, deviceName: "MacBook Air Speakers",
                         outputDevices: [
                            AudioOutputDevice(id: 1, name: "MacBook Air Speakers", isCurrent: true),
                            AudioOutputDevice(id: 2, name: "AirPods Pro", isCurrent: false, transport: .bluetooth),
                         ]),
            controllerAvailable: true,
            deviceList: AudioOutputListPreferences(visibleLimit: nil),
            localization: l10n)
        return VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 12) {
                BatteryStatusView(state: battery, onOpenBatteryDetails: {}, onOpenBatterySettings: {})
                Divider()
                NetworkStatusView(state: network, onOpenWiFiDetails: { _ in }, onOpenWiredDetails: {},
                                  onRequestNameAccess: {}, onOpenWiFiSettings: {},
                                  onOpenNetworkSettings: {}, onOpenLocationSettings: {})
                Divider()
                VolumeControlsView(state: volume, actions: StatusPanelActions(),
                                   scrollTargets: PopoverScrollTargets(), onOpenSoundSettings: {})
            }
            .padding(.top, 14)
            .padding(.horizontal, 14)
            .padding(.bottom, 12)
            VStack(spacing: 12) {
                Divider().opacity(0.6).padding(.vertical, 2)
                PopoverFooterView(openSettings: {}, quit: {})
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 14)
        }
    }
}
