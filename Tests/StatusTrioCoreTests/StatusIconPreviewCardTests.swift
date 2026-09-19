import AppKit
import SwiftUI
import XCTest
@testable import StatusTrioCore

@MainActor
final class StatusIconPreviewCardTests: XCTestCase {
    func testMenuBarPreviewBarRendersWithoutTrailingAccessory() {
        let bar = MenuBarPreviewBar(
            status: IconGuideView.example,
            iconSize: 24,
            isDarkBackground: true
        )

        let hostingView = NSHostingView(rootView: bar)
        hostingView.frame = NSRect(x: 0, y: 0, width: 500, height: 40)
        hostingView.layoutSubtreeIfNeeded()

        XCTAssertEqual(hostingView.fittingSize.height, 40, accuracy: 0.5)
        XCTAssertGreaterThan(hostingView.fittingSize.width, 0)
    }

    func testMenuBarPreviewBarRendersWithTrailingAccessory() {
        let bar = MenuBarPreviewBar(
            status: IconGuideView.example,
            iconSize: 24,
            isDarkBackground: true
        ) {
            Text("Dark")
                .frame(width: 50, height: 20)
        }

        let hostingView = NSHostingView(rootView: bar)
        hostingView.frame = NSRect(x: 0, y: 0, width: 500, height: 40)
        hostingView.layoutSubtreeIfNeeded()

        XCTAssertEqual(hostingView.fittingSize.height, 40, accuracy: 0.5)
        XCTAssertGreaterThan(hostingView.fittingSize.width, 0)
    }

    func testStatusIconPreviewCardRendersWithToggle() throws {
        let suiteName = "StatusTrioCoreTests.StatusIconPreviewCard.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defaults.removeTestSuite(named: suiteName)
        addTeardownBlock { TestUserDefaults.removeSuite(named: suiteName) }

        let store = SettingsStore(defaults: defaults)
        let statusStore = SystemStatusStore(
            batteryMonitor: EmptyBatteryMonitor(),
            wifiMonitor: EmptyWiFiMonitor(),
            volumeMonitor: EmptyVolumeMonitor()
        )
        let localization = Localization(
            defaults: defaults,
            preferredLanguages: [AppLanguage.simplifiedChinese.rawValue]
        )

        let card = StatusIconPreviewCard(
            store: store,
            statusStore: statusStore,
            isDarkBackground: .constant(true)
        )
        .environmentObject(localization)

        let hostingView = NSHostingView(rootView: card)
        hostingView.frame = NSRect(x: 0, y: 0, width: 500, height: 80)
        hostingView.layoutSubtreeIfNeeded()

        XCTAssertGreaterThan(hostingView.fittingSize.height, 40)
        XCTAssertGreaterThan(hostingView.fittingSize.width, 0)
    }
}

@MainActor
private final class EmptyBatteryMonitor: BatteryMonitoring {
    let updates = AsyncStream<BatteryStatus> { continuation in
        continuation.finish()
    }
    func start() {}
    func stop() {}
    func refresh() {}
    func recover() {}
}

@MainActor
private final class EmptyWiFiMonitor: WiFiMonitoring {
    let updates = AsyncStream<WiFiStatus> { continuation in
        continuation.finish()
    }
    func start() {}
    func stop() {}
    func refresh() {}
    func recover() {}
    func requestNameAccess() {}
}

@MainActor
private final class EmptyVolumeMonitor: VolumeMonitoring {
    let updates = AsyncStream<VolumeStatus> { continuation in
        continuation.finish()
    }
    func start() {}
    func stop() {}
    func refresh() {}
    func recover() {}
}
