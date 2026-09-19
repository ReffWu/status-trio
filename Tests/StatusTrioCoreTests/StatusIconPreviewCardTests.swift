import AppKit
import SwiftUI
import XCTest
@testable import StatusTrioCore

@MainActor
final class StatusIconPreviewCardTests: XCTestCase {
    func testMenuBarPreviewBarRendersWithoutTrailingAccessory() {
        let size = fittingSize(of: previewBar())

        XCTAssertEqual(size.height, 40, accuracy: 0.5)
        XCTAssertGreaterThan(size.width, 0)
    }

    /// Pins the accessory into the bar's own `HStack`: its width has to reach the
    /// bar's ideal size as `accessory width + 14 pt`. An accessory that is
    /// overlaid on the bar instead — the layout this replaced — adds no width at
    /// all, so this fails for it even though the bar still renders.
    ///
    /// The ideal size cannot show a reserved trailing inset, because a bar laid
    /// out at its ideal width has no slack to expose; the spacing the user sees
    /// is pinned by the 14 pt term above.
    func testTrailingAccessoryUsesTheStandardElementSpacing() {
        let accessoryWidth: CGFloat = 50
        let withoutAccessory = fittingSize(of: previewBar())
        let withAccessory = fittingSize(of: previewBar {
            Text("Dark")
                .frame(width: accessoryWidth, height: 20)
        })

        XCTAssertEqual(withAccessory.height, 40, accuracy: 0.5)
        XCTAssertEqual(
            withAccessory.width - withoutAccessory.width,
            accessoryWidth + 14,
            accuracy: 1,
            "The accessory should sit in the HStack's standard 14 pt spacing, not a reserved trailing inset"
        )
    }

    func testEmptyAccessoryInitializerKeepsTheBarLayoutUnchanged() {
        let withoutAccessory = fittingSize(of: previewBar())
        let explicitEmptyView = fittingSize(of: previewBar { EmptyView() })

        XCTAssertEqual(explicitEmptyView.width, withoutAccessory.width, accuracy: 0.5)
        XCTAssertEqual(explicitEmptyView.height, withoutAccessory.height, accuracy: 0.5)
    }

    func testStatusIconPreviewCardRendersWithToggle() throws {
        let suiteName = "StatusTrioCoreTests.StatusIconPreviewCard.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
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

    private func previewBar() -> MenuBarPreviewBar<EmptyView> {
        MenuBarPreviewBar(
            status: IconGuideView.example,
            iconSize: 24,
            isDarkBackground: true
        )
    }

    private func previewBar<Accessory: View>(
        @ViewBuilder accessory: @escaping () -> Accessory
    ) -> MenuBarPreviewBar<Accessory> {
        MenuBarPreviewBar(
            status: IconGuideView.example,
            iconSize: 24,
            isDarkBackground: true,
            trailingAccessory: accessory
        )
    }

    private func fittingSize<V: View>(of view: V) -> NSSize {
        let hostingView = NSHostingView(rootView: view)
        hostingView.frame = NSRect(x: 0, y: 0, width: 500, height: 40)
        hostingView.layoutSubtreeIfNeeded()
        return hostingView.fittingSize
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
