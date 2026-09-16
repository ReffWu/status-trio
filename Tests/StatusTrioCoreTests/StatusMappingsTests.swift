import XCTest
@testable import StatusTrioCore

final class StatusMappingsTests: XCTestCase {
    func testWiFiSignalBoundaries() {
        XCTAssertEqual(StatusMappings.wifiBars(rssi: -71), 3)
        XCTAssertEqual(StatusMappings.wifiBars(rssi: -72), 3)
        XCTAssertEqual(StatusMappings.wifiBars(rssi: -73), 2)
        XCTAssertEqual(StatusMappings.wifiBars(rssi: -82), 2)
        XCTAssertEqual(StatusMappings.wifiBars(rssi: -83), 1)
        XCTAssertEqual(StatusMappings.wifiBars(rssi: -90), 1)
        XCTAssertEqual(StatusMappings.wifiBars(rssi: -91), 0)
        XCTAssertEqual(StatusMappings.wifiBars(rssi: nil), 0)
    }

    func testWiFiSummaryRequiresLocationPermissionBeforeOpeningAssociatedNetworkDetails() {
        let notDetermined = WiFiStatus(
            state: .connected,
            rssi: -50,
            nameAccess: .notDetermined
        )
        XCTAssertEqual(
            StatusMappings.wifiSummaryAction(for: notDetermined),
            .requestNameAccess
        )

        let authorized = WiFiStatus(
            state: .connected,
            rssi: -50,
            nameAccess: .authorized
        )
        XCTAssertEqual(
            StatusMappings.wifiSummaryAction(for: authorized),
            .openDetails
        )

        let denied = WiFiStatus(
            state: .connected,
            rssi: -50,
            nameAccess: .denied
        )
        XCTAssertEqual(
            StatusMappings.wifiSummaryAction(for: denied),
            .openLocationSettings
        )

        let unavailable = WiFiStatus(
            state: .unavailable,
            rssi: nil,
            nameAccess: .notDetermined
        )
        XCTAssertEqual(
            StatusMappings.wifiSummaryAction(for: unavailable),
            .openDetails
        )
    }

    func testVolumeBoundaries() {
        XCTAssertEqual(StatusMappings.volumeSteps(scalar: 0, isMuted: false), 0)
        XCTAssertEqual(StatusMappings.volumeSteps(scalar: -0.1, isMuted: false), 0)
        XCTAssertEqual(StatusMappings.volumeSteps(scalar: 0.01, isMuted: false), 1)
        XCTAssertEqual(StatusMappings.volumeSteps(scalar: 0.25, isMuted: false), 1)
        XCTAssertEqual(StatusMappings.volumeSteps(scalar: 0.26, isMuted: false), 2)
        XCTAssertEqual(StatusMappings.volumeSteps(scalar: 0.50, isMuted: false), 2)
        XCTAssertEqual(StatusMappings.volumeSteps(scalar: 0.51, isMuted: false), 3)
        XCTAssertEqual(StatusMappings.volumeSteps(scalar: 0.75, isMuted: false), 3)
        XCTAssertEqual(StatusMappings.volumeSteps(scalar: 0.76, isMuted: false), 4)
        XCTAssertEqual(StatusMappings.volumeSteps(scalar: 1.0, isMuted: false), 4)
        XCTAssertEqual(StatusMappings.volumeSteps(scalar: 1.1, isMuted: false), 4)
        XCTAssertEqual(StatusMappings.volumeSteps(scalar: 0.8, isMuted: true), 0)
        XCTAssertNil(StatusMappings.volumeSteps(scalar: nil, isMuted: false))
    }

    func testBatteryProgress() {
        XCTAssertEqual(StatusMappings.batteryProgress(makeBattery(rawPercentage: 0)), 0.0)
        XCTAssertEqual(StatusMappings.batteryProgress(makeBattery(rawPercentage: 100)), 1.0)
        XCTAssertEqual(StatusMappings.batteryProgress(makeBattery(rawPercentage: -1)), 0.0)
        XCTAssertEqual(StatusMappings.batteryProgress(makeBattery(rawPercentage: 101)), 1.0)
    }

    func testBatteryColorPriority() {
        let normal = BatteryStatus(
            rawPercentage: 100,
            isPresent: true,
            isCharging: false,
            isLowPowerMode: false,
            isConnectedToPower: false
        )
        XCTAssertEqual(StatusMappings.batteryColorRole(normal), .foreground)

        let lowPower = BatteryStatus(
            rawPercentage: 100,
            isPresent: true,
            isCharging: false,
            isLowPowerMode: true,
            isConnectedToPower: false
        )
        XCTAssertEqual(StatusMappings.batteryColorRole(lowPower), .lowPower)

        let chargingOnly = BatteryStatus(
            rawPercentage: 100,
            isPresent: true,
            isCharging: true,
            isLowPowerMode: false,
            isConnectedToPower: true
        )
        XCTAssertEqual(StatusMappings.batteryColorRole(chargingOnly), .charging)

        let charging = BatteryStatus(
            rawPercentage: 100,
            isPresent: true,
            isCharging: true,
            isLowPowerMode: true,
            isConnectedToPower: true
        )
        XCTAssertEqual(StatusMappings.batteryColorRole(charging), .lowPower)

        let connectedOnly = BatteryStatus(
            rawPercentage: 80,
            isPresent: true,
            isCharging: false,
            isLowPowerMode: false,
            isConnectedToPower: true
        )
        XCTAssertEqual(StatusMappings.batteryColorRole(connectedOnly), .charging)
    }

    func testBatteryCriticalThreshold() {
        let battery = makeBattery(rawPercentage: 20)

        XCTAssertEqual(StatusMappings.batteryColorRole(battery), .foreground)
        XCTAssertEqual(
            StatusMappings.batteryColorRole(battery, criticalThreshold: 20),
            .foreground
        )
        XCTAssertEqual(
            StatusMappings.batteryColorRole(
                makeBattery(rawPercentage: 19),
                criticalThreshold: 20
            ),
            .critical
        )
    }

    func testCriticalPrecedesLowPowerAndCharging() {
        let battery = BatteryStatus(
            rawPercentage: 19,
            isPresent: true,
            isCharging: true,
            isLowPowerMode: true,
            isConnectedToPower: true
        )

        XCTAssertEqual(
            StatusMappings.batteryColorRole(battery, criticalThreshold: 20),
            .critical
        )
    }

    private func makeBattery(rawPercentage: Int?) -> BatteryStatus {
        BatteryStatus(
            rawPercentage: rawPercentage,
            isPresent: true,
            isCharging: false,
            isLowPowerMode: false,
            isConnectedToPower: false
        )
    }
}
