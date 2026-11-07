import AppKit
import SwiftUI
import XCTest
@testable import StatusTrioCore

/// Renders every page of the real Settings window to PNG so the GNOME port's
/// preferences can be compared against it. Runs only with
/// STATUS_TRIO_LINUX_SETTINGS_REF set to an output directory.
@MainActor
final class LinuxSettingsReferenceTests: XCTestCase {
    private struct Page {
        let name: String
        let section: SettingsView.Section
        let subtopic: SettingsSubtopic?
    }

    func testRenderSettingsReference() throws {
        guard let out = ProcessInfo.processInfo.environment["STATUS_TRIO_LINUX_SETTINGS_REF"] else {
            throw XCTSkip("set STATUS_TRIO_LINUX_SETTINGS_REF")
        }
        try FileManager.default.createDirectory(atPath: out, withIntermediateDirectories: true)
        var pages = SettingsView.Section.allCases.filter { $0 != .appIcon }
            .map { Page(name: $0.rawValue, section: $0, subtopic: nil) }
        pages.insert(contentsOf: SettingsSubtopic.allCases.map {
            Page(name: "appIcon-\(String(describing: $0))", section: .appIcon, subtopic: $0)
        }, at: 0)
        let languages = (ProcessInfo.processInfo.environment["STATUS_TRIO_LINUX_SETTINGS_LANGS"] ?? "en,zh-Hans")
            .split(separator: ",").map(String.init)
        for language in languages {
            for dark in [false, true] {
                for page in pages {
                    for tall in [false, true] {
                        let image = try render(page: page, language: language, dark: dark,
                                               height: tall ? 1800 : SettingsView.height)
                        let name = "settings-\(page.name)-\(language)-\(dark ? "dark" : "light")\(tall ? "-tall" : "").png"
                        try image.write(to: URL(fileURLWithPath: out).appendingPathComponent(name))
                    }
                }
            }
        }
    }

    private func render(page: Page, language: String, dark: Bool, height: CGFloat) throws -> Data {
        let suite = "LinuxSettingsReference.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removeTestSuite(named: suite) }
        let l10n = Localization(defaults: defaults, preferredLanguages: [language])
        let store = SettingsStore(defaults: defaults)
        let statusStore = SystemStatusStore(
            batteryMonitor: RefBatteryMonitor(),
            wifiMonitor: RefWiFiMonitor(),
            volumeMonitor: RefVolumeMonitor()
        )
        var section: SettingsView.Section? = page.section
        var subtopic: SettingsSubtopic? = page.subtopic
        let view = SettingsView(
            store: store, statusStore: statusStore, localization: l10n, onShowIconGuide: {},
            consumePendingSection: { defer { section = nil }; return section },
            consumePendingSubtopic: { defer { subtopic = nil }; return subtopic }
        )
        .environmentObject(ChargingEffectClock())
        .environmentObject(l10n)
        .environment(\.colorScheme, dark ? .dark : .light)

        let size = NSSize(width: SettingsView.width, height: height)
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: size),
                              styleMask: [.titled, .closable, .fullSizeContentView],
                              backing: .buffered, defer: false)
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        let hosting = NSHostingView(rootView: view)
        hosting.frame = NSRect(origin: .zero, size: size)
        window.contentView = hosting
        window.setContentSize(size)
        window.orderFrontRegardless()
        defer { window.orderOut(nil) }
        // Let onAppear route to the page and the selection animation settle.
        RunLoop.main.run(until: Date().addingTimeInterval(0.8))
        hosting.layoutSubtreeIfNeeded()

        let rep = try XCTUnwrap(NSBitmapImageRep(
            bitmapDataPlanes: nil, pixelsWide: Int(size.width * 2), pixelsHigh: Int(size.height * 2),
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0))
        rep.size = size
        window.appearance?.performAsCurrentDrawingAppearance {
            hosting.cacheDisplay(in: hosting.bounds, to: rep)
        }
        return try XCTUnwrap(rep.representation(using: .png, properties: [:]))
    }
}

@MainActor
private final class RefBatteryMonitor: BatteryMonitoring {
    let updates: AsyncStream<BatteryStatus>
    init() { (updates, _) = AsyncStream.makeStream() }
    func start() {}
    func stop() {}
    func refresh() {}
    func recover() {}
}

@MainActor
private final class RefWiFiMonitor: WiFiMonitoring {
    let updates: AsyncStream<WiFiStatus>
    init() { (updates, _) = AsyncStream.makeStream() }
    func start() {}
    func stop() {}
    func refresh() {}
    func recover() {}
    func requestNameAccess() -> WiFiNameAccessRequestResult { .notNeeded }
}

@MainActor
private final class RefVolumeMonitor: VolumeMonitoring {
    let updates: AsyncStream<VolumeStatus>
    init() { (updates, _) = AsyncStream.makeStream() }
    func start() {}
    func stop() {}
    func refresh() {}
    func recover() {}
}
