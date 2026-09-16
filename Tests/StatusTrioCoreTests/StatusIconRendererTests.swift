import AppKit
import CoreGraphics
import XCTest
@testable import StatusTrioCore

final class StatusIconRendererTests: XCTestCase {
    func testRendererProducesExpectedPixelSize() throws {
        let image = try XCTUnwrap(StatusIconRenderer.render(
            snapshot: .placeholder,
            size: 20,
            scale: 2,
            foreground: CGColor(gray: 1, alpha: 1)
        ))

        XCTAssertEqual(image.width, 40)
        XCTAssertEqual(image.height, 40)
    }

    func testRendererRejectsNonPositiveSizeOrScale() {
        let snapshot = StatusSnapshot.placeholder
        let foreground = CGColor(gray: 1, alpha: 1)

        XCTAssertNil(StatusIconRenderer.render(
            snapshot: snapshot,
            size: 0,
            scale: 2,
            foreground: foreground
        ))
        XCTAssertNil(StatusIconRenderer.render(
            snapshot: snapshot,
            size: -1,
            scale: 2,
            foreground: foreground
        ))
        XCTAssertNil(StatusIconRenderer.render(
            snapshot: snapshot,
            size: 20,
            scale: 0,
            foreground: foreground
        ))
        XCTAssertNil(StatusIconRenderer.render(
            snapshot: snapshot,
            size: 20,
            scale: -1,
            foreground: foreground
        ))
    }

    func testForegroundStateDrawsRedPixels() throws {
        let red = try XCTUnwrap(CGColor(
            colorSpace: CGColorSpaceCreateDeviceRGB(),
            components: [1, 0, 0, 1]
        ))
        let pixels = try PixelBuffer(
            image: try XCTUnwrap(StatusIconRenderer.render(
                snapshot: .placeholder,
                size: 20,
                scale: 2,
                foreground: red
            ))
        )

        XCTAssertTrue(pixels.containsColor(
            red: 1,
            green: 0,
            blue: 0,
            tolerance: 0.02,
            minimumAlpha: 0.9
        ))
    }

    func testChargingStateDrawsGreenPixels() throws {
        let snapshot = StatusSnapshot(
            battery: BatteryStatus(
                rawPercentage: 50,
                isPresent: true,
                isCharging: true,
                isLowPowerMode: false,
                isConnectedToPower: true
            ),
            wifi: .placeholder,
            volume: .placeholder
        )

        let pixels = try PixelBuffer(
            image: try XCTUnwrap(StatusIconRenderer.render(
                snapshot: snapshot,
                size: 20,
                scale: 2,
                foreground: CGColor(gray: 1, alpha: 1)
            ))
        )

        XCTAssertTrue(pixels.containsColor(
            red: 0.20,
            green: 0.78,
            blue: 0.35,
            tolerance: 0.08,
            minimumAlpha: 0.9
        ))
    }

    func testChargingStateUsesDarkerGreenForLightMenuBar() throws {
        let snapshot = StatusSnapshot(
            battery: makeBattery(rawPercentage: 50, isCharging: true),
            wifi: .placeholder,
            volume: .placeholder
        )
        let pixels = try PixelBuffer(
            image: try XCTUnwrap(StatusIconRenderer.render(
                snapshot: snapshot,
                size: 20,
                scale: 8,
                foreground: CGColor(gray: 0, alpha: 1)
            ))
        )

        XCTAssertTrue(pixels.containsColor(
            red: 31.0 / 255.0,
            green: 143.0 / 255.0,
            blue: 61.0 / 255.0,
            tolerance: 0.08,
            minimumAlpha: 0.9
        ))
    }

    func testOffAndUnavailableStatesDrawSlashOutsideWiFiArcs() throws {
        let offSnapshot = StatusSnapshot(
            battery: .placeholder,
            wifi: WiFiStatus(state: .off, rssi: nil),
            volume: .placeholder
        )
        let unavailableSnapshot = StatusSnapshot(
            battery: .placeholder,
            wifi: WiFiStatus(state: .unavailable, rssi: nil),
            volume: .placeholder
        )
        let notAssociatedSnapshot = StatusSnapshot(
            battery: .placeholder,
            wifi: WiFiStatus(state: .notAssociated, rssi: nil),
            volume: .placeholder
        )
        let offPixels = try PixelBuffer(
            image: try XCTUnwrap(StatusIconRenderer.render(
                snapshot: offSnapshot,
                size: 20,
                scale: 8,
                foreground: CGColor(gray: 1, alpha: 1)
            ))
        )
        let unavailablePixels = try PixelBuffer(
            image: try XCTUnwrap(StatusIconRenderer.render(
                snapshot: unavailableSnapshot,
                size: 20,
                scale: 8,
                foreground: CGColor(gray: 1, alpha: 1)
            ))
        )
        let notAssociatedPixels = try PixelBuffer(
            image: try XCTUnwrap(StatusIconRenderer.render(
                snapshot: notAssociatedSnapshot,
                size: 20,
                scale: 8,
                foreground: CGColor(gray: 1, alpha: 1)
            ))
        )
        let slashPoint = CGPoint(x: 75, y: 73)

        XCTAssertGreaterThan(
            offPixels.alpha(atSVGPoint: slashPoint, size: 20, scale: 8),
            0
        )
        XCTAssertGreaterThan(
            unavailablePixels.alpha(atSVGPoint: slashPoint, size: 20, scale: 8),
            0
        )
        XCTAssertEqual(
            notAssociatedPixels.alpha(atSVGPoint: slashPoint, size: 20, scale: 8),
            0
        )
    }

    func testNoInternetOmitsNormalWiFiDotWhileKeepingOverlay() throws {
        let snapshot = StatusSnapshot(
            battery: .placeholder,
            wifi: WiFiStatus(state: .noInternet, rssi: nil),
            volume: .placeholder
        )
        let pixels = try PixelBuffer(
            image: try XCTUnwrap(StatusIconRenderer.render(
                snapshot: snapshot,
                size: 20,
                scale: 8,
                foreground: CGColor(gray: 1, alpha: 1)
            ))
        )

        // The exclamation dot overlaps the full normal-dot centroid, so sample
        // the centroid of the normal dot's uncovered lower region.
        let uncoveredNormalDotCentroid = CGPoint(x: 59.5, y: 79.17)
        let overlayStem = CGPoint(x: 59.5, y: 60)

        XCTAssertEqual(
            pixels.alpha(atSVGPoint: uncoveredNormalDotCentroid, size: 20, scale: 8),
            0
        )
        XCTAssertGreaterThan(
            pixels.alpha(atSVGPoint: overlayStem, size: 20, scale: 8),
            0
        )
    }

    func testLowPowerStateDrawsYellowPixels() throws {
        let snapshot = StatusSnapshot(
            battery: BatteryStatus(
                rawPercentage: 50,
                isPresent: true,
                isCharging: false,
                isLowPowerMode: true,
                isConnectedToPower: false
            ),
            wifi: .placeholder,
            volume: .placeholder
        )

        let pixels = try PixelBuffer(
            image: try XCTUnwrap(StatusIconRenderer.render(
                snapshot: snapshot,
                size: 20,
                scale: 2,
                foreground: CGColor(gray: 1, alpha: 1)
            ))
        )

        XCTAssertTrue(pixels.containsColor(
            red: 0.95,
            green: 0.73,
            blue: 0.0,
            tolerance: 0.08,
            minimumAlpha: 0.9
        ))
    }

    func testLowPowerStateUsesDarkerYellowForLightMenuBar() throws {
        let snapshot = StatusSnapshot(
            battery: makeBattery(rawPercentage: 50, isLowPowerMode: true),
            wifi: .placeholder,
            volume: .placeholder
        )
        let pixels = try PixelBuffer(
            image: try XCTUnwrap(StatusIconRenderer.render(
                snapshot: snapshot,
                size: 20,
                scale: 8,
                foreground: CGColor(gray: 0, alpha: 1)
            ))
        )

        XCTAssertTrue(pixels.containsColor(
            red: 201.0 / 255.0,
            green: 151.0 / 255.0,
            blue: 0,
            tolerance: 0.08,
            minimumAlpha: 0.9
        ))
    }


    func testBatteryPercentageCanBeHidden() throws {
        let snapshot = StatusSnapshot(
            battery: makeBattery(rawPercentage: 50),
            wifi: .placeholder,
            volume: .placeholder
        )
        let visible = try PixelBuffer(
            image: try XCTUnwrap(StatusIconRenderer.render(
                snapshot: snapshot,
                size: 20,
                scale: 8,
                foreground: CGColor(gray: 1, alpha: 1),
                options: BatteryIconOptions(
                    showsPercentage: true,
                    showsChargingIndicator: true,
                    usesStatusColors: true,
                    criticalThreshold: 20
                )
            ))
        )
        let hidden = try PixelBuffer(
            image: try XCTUnwrap(StatusIconRenderer.render(
                snapshot: snapshot,
                size: 20,
                scale: 8,
                foreground: CGColor(gray: 1, alpha: 1),
                options: BatteryIconOptions(
                    showsPercentage: false,
                    showsChargingIndicator: true,
                    usesStatusColors: true,
                    criticalThreshold: 20
                )
            ))
        )
        let valueRegion = CGRect(x: 45, y: 0, width: 30, height: 34)

        XCTAssertGreaterThan(
            visible.alphaSum(inSVGRect: valueRegion, size: 20, scale: 8),
            hidden.alphaSum(inSVGRect: valueRegion, size: 20, scale: 8)
        )
    }

    func testBatteryPercentageFollowsForegroundColor() throws {
        let batteries = [
            makeBattery(rawPercentage: 50),
            makeBattery(rawPercentage: 50, isLowPowerMode: true),
            makeBattery(rawPercentage: 19)
        ]

        for battery in batteries {
            let pixels = try PixelBuffer(
                image: try XCTUnwrap(StatusIconRenderer.render(
                    snapshot: StatusSnapshot(
                        battery: battery,
                        wifi: .placeholder,
                        volume: .placeholder
                    ),
                    size: 20,
                    scale: 8,
                    foreground: CGColor(gray: 0, alpha: 1)
                ))
            )

            XCTAssertTrue(pixels.containsColor(
                red: 0,
                green: 0,
                blue: 0,
                tolerance: 0.08,
                minimumAlpha: 0.9
            ))
            XCTAssertFalse(pixels.containsColor(
                red: 1,
                green: 1,
                blue: 1,
                tolerance: 0.08,
                minimumAlpha: 0.9
            ))
        }
    }

    func testChargingIndicatorCanBeHidden() throws {
        let snapshot = StatusSnapshot(
            battery: makeBattery(rawPercentage: 50, isCharging: true),
            wifi: .placeholder,
            volume: .placeholder
        )
        let visible = try PixelBuffer(
            image: try XCTUnwrap(StatusIconRenderer.render(
                snapshot: snapshot,
                size: 20,
                scale: 8,
                foreground: CGColor(gray: 1, alpha: 1),
                options: BatteryIconOptions(
                    showsPercentage: false,
                    showsChargingIndicator: true,
                    usesStatusColors: true,
                    criticalThreshold: 20
                )
            ))
        )
        let hidden = try PixelBuffer(
            image: try XCTUnwrap(StatusIconRenderer.render(
                snapshot: snapshot,
                size: 20,
                scale: 8,
                foreground: CGColor(gray: 1, alpha: 1),
                options: BatteryIconOptions(
                    showsPercentage: false,
                    showsChargingIndicator: false,
                    usesStatusColors: true,
                    criticalThreshold: 20
                )
            ))
        )
        let boltRegion = CGRect(x: 50, y: 0, width: 20, height: 23)

        XCTAssertGreaterThan(
            visible.alphaSum(inSVGRect: boltRegion, size: 20, scale: 8),
            hidden.alphaSum(inSVGRect: boltRegion, size: 20, scale: 8)
        )
    }

    func testBatteryPercentageScaleChangesRenderedSize() throws {
        let snapshot = StatusSnapshot(
            battery: makeBattery(rawPercentage: 50),
            wifi: .placeholder,
            volume: .placeholder
        )
        let small = try PixelBuffer(
            image: try XCTUnwrap(StatusIconRenderer.render(
                snapshot: snapshot,
                size: 20,
                scale: 8,
                foreground: CGColor(gray: 1, alpha: 1),
                options: BatteryIconOptions(
                    showsPercentage: true,
                    showsChargingIndicator: true,
                    usesStatusColors: true,
                    criticalThreshold: 20,
                    textScale: 1
                )
            ))
        )
        let large = try PixelBuffer(
            image: try XCTUnwrap(StatusIconRenderer.render(
                snapshot: snapshot,
                size: 20,
                scale: 8,
                foreground: CGColor(gray: 1, alpha: 1),
                options: BatteryIconOptions(
                    showsPercentage: true,
                    showsChargingIndicator: true,
                    usesStatusColors: true,
                    criticalThreshold: 20,
                    textScale: 2
                )
            ))
        )
        let valueRegion = CGRect(x: 35, y: 0, width: 50, height: 45)

        XCTAssertGreaterThan(
            large.alphaSum(inSVGRect: valueRegion, size: 20, scale: 8),
            small.alphaSum(inSVGRect: valueRegion, size: 20, scale: 8)
        )
    }

    func testConnectedToPowerWithoutActiveChargingShowsBolt() throws {
        let snapshot = StatusSnapshot(
            battery: makeBattery(
                rawPercentage: 80,
                isCharging: false,
                isConnectedToPower: true
            ),
            wifi: .placeholder,
            volume: .placeholder
        )
        let withBolt = try PixelBuffer(
            image: try XCTUnwrap(StatusIconRenderer.render(
                snapshot: snapshot,
                size: 20,
                scale: 8,
                foreground: CGColor(gray: 1, alpha: 1),
                options: BatteryIconOptions(
                    showsPercentage: false,
                    showsChargingIndicator: true,
                    usesStatusColors: true,
                    criticalThreshold: 20
                )
            ))
        )
        let withoutBolt = try PixelBuffer(
            image: try XCTUnwrap(StatusIconRenderer.render(
                snapshot: snapshot,
                size: 20,
                scale: 8,
                foreground: CGColor(gray: 1, alpha: 1),
                options: BatteryIconOptions(
                    showsPercentage: false,
                    showsChargingIndicator: false,
                    usesStatusColors: true,
                    criticalThreshold: 20
                )
            ))
        )
        let markerRegion = CGRect(x: 45, y: 0, width: 30, height: 34)
        XCTAssertGreaterThan(
            withBolt.alphaSum(inSVGRect: markerRegion, size: 20, scale: 8),
            withoutBolt.alphaSum(inSVGRect: markerRegion, size: 20, scale: 8)
        )
    }

    func testBoltScaleTracksBatterySymbolScale() throws {
        let snapshot = StatusSnapshot(
            battery: makeBattery(
                rawPercentage: 80,
                isCharging: true,
                isConnectedToPower: true
            ),
            wifi: .placeholder,
            volume: .placeholder
        )
        let small = try PixelBuffer(
            image: try XCTUnwrap(StatusIconRenderer.render(
                snapshot: snapshot,
                size: 20,
                scale: 8,
                foreground: CGColor(gray: 1, alpha: 1),
                options: BatteryIconOptions(
                    showsPercentage: false,
                    showsChargingIndicator: true,
                    usesStatusColors: true,
                    criticalThreshold: 20,
                    textScale: 1
                )
            ))
        )
        let large = try PixelBuffer(
            image: try XCTUnwrap(StatusIconRenderer.render(
                snapshot: snapshot,
                size: 20,
                scale: 8,
                foreground: CGColor(gray: 1, alpha: 1),
                options: BatteryIconOptions(
                    showsPercentage: false,
                    showsChargingIndicator: true,
                    usesStatusColors: true,
                    criticalThreshold: 20,
                    textScale: 2
                )
            ))
        )
        let boltRegion = CGRect(x: 40, y: 0, width: 40, height: 40)

        XCTAssertGreaterThan(
            large.alphaSum(inSVGRect: boltRegion, size: 20, scale: 8),
            small.alphaSum(inSVGRect: boltRegion, size: 20, scale: 8)
        )
    }

    func testChargingBoltFollowsForegroundColor() throws {
        let snapshot = StatusSnapshot(
            battery: makeBattery(rawPercentage: 50, isCharging: true),
            wifi: .placeholder,
            volume: .placeholder
        )
        let pixels = try PixelBuffer(
            image: try XCTUnwrap(StatusIconRenderer.render(
                snapshot: snapshot,
                size: 20,
                scale: 8,
                foreground: CGColor(gray: 0, alpha: 1),
                options: BatteryIconOptions(
                    showsPercentage: false,
                    showsChargingIndicator: true,
                    usesStatusColors: false,
                    criticalThreshold: 20
                )
            ))
        )

        XCTAssertTrue(pixels.containsColor(
            red: 0,
            green: 0,
            blue: 0,
            tolerance: 0.08,
            minimumAlpha: 0.9
        ))
        XCTAssertFalse(pixels.containsColor(
            red: 1,
            green: 1,
            blue: 1,
            tolerance: 0.08,
            minimumAlpha: 0.9
        ))
    }

    func testBatteryStatusColorsCanBeDisabled() throws {
        let snapshot = StatusSnapshot(
            battery: makeBattery(rawPercentage: 19),
            wifi: .placeholder,
            volume: .placeholder
        )
        let colored = try PixelBuffer(
            image: try XCTUnwrap(StatusIconRenderer.render(
                snapshot: snapshot,
                size: 20,
                scale: 4,
                foreground: CGColor(gray: 1, alpha: 1),
                options: BatteryIconOptions(
                    showsPercentage: true,
                    showsChargingIndicator: true,
                    usesStatusColors: true,
                    criticalThreshold: 20
                )
            ))
        )
        let monochrome = try PixelBuffer(
            image: try XCTUnwrap(StatusIconRenderer.render(
                snapshot: snapshot,
                size: 20,
                scale: 4,
                foreground: CGColor(gray: 1, alpha: 1),
                options: BatteryIconOptions(
                    showsPercentage: true,
                    showsChargingIndicator: true,
                    usesStatusColors: false,
                    criticalThreshold: 20
                )
            ))
        )

        XCTAssertTrue(colored.containsColor(
            red: 1,
            green: 0.23,
            blue: 0.19,
            tolerance: 0.14,
            minimumAlpha: 0.9
        ))
        XCTAssertFalse(monochrome.containsColor(
            red: 1,
            green: 0.23,
            blue: 0.19,
            tolerance: 0.08,
            minimumAlpha: 0.9
        ))
    }

    func testAppKitWrapperProducesBitmapRepresentation() throws {
        let image = StatusIconRenderer.image(
            snapshot: .placeholder,
            size: 28
        )

        XCTAssertEqual(image.size.width, 28, accuracy: 0.01)
        XCTAssertEqual(image.size.height, 28, accuracy: 0.01)

        let tiff = try XCTUnwrap(image.tiffRepresentation)
        let bitmap = try XCTUnwrap(NSBitmapImageRep(data: tiff))
        XCTAssertGreaterThan(bitmap.pixelsWide, 0)
        XCTAssertGreaterThan(bitmap.pixelsHigh, 0)
    }

    func testWiFiStatusImageUsesRequestedSizeAndTemplateRendering() {
        let image = StatusIconRenderer.wifiImage(
            wifi: WiFiStatus(state: .connected, rssi: -55),
            size: 22
        )

        XCTAssertEqual(image.size.width, 22, accuracy: 0.01)
        XCTAssertEqual(image.size.height, 22, accuracy: 0.01)
        XCTAssertTrue(image.isTemplate)
        XCTAssertNotNil(image.tiffRepresentation)
    }

    func testWiFiStatusImageKeepsTransparentBorderAroundStrokes() throws {
        let image = StatusIconRenderer.wifiImage(
            wifi: WiFiStatus(state: .connected, rssi: -55),
            size: 16
        )
        let pixels = try renderPixels(image: image)

        XCTAssertEqual(pixels.maximumAlphaOnEdges, 0)
    }

    func testConnectedZeroBarsMatchesFullMutedSignalAndDiffersFromHigherBars() throws {
        let zeroBars = StatusSnapshot(
            battery: .placeholder,
            wifi: WiFiStatus(state: .connected, rssi: nil),
            volume: .placeholder
        )
        let notAssociated = StatusSnapshot(
            battery: .placeholder,
            wifi: WiFiStatus(state: .notAssociated, rssi: nil),
            volume: .placeholder
        )
        let oneBar = StatusSnapshot(
            battery: .placeholder,
            wifi: WiFiStatus(state: .connected, rssi: -85),
            volume: .placeholder
        )
        let twoBars = StatusSnapshot(
            battery: .placeholder,
            wifi: WiFiStatus(state: .connected, rssi: -75),
            volume: .placeholder
        )
        let threeBars = StatusSnapshot(
            battery: .placeholder,
            wifi: WiFiStatus(state: .connected, rssi: -55),
            volume: .placeholder
        )

        let zeroPixels = try renderPixels(zeroBars)
        XCTAssertEqual(zeroPixels.bytes, try renderPixels(notAssociated).bytes)
        XCTAssertNotEqual(zeroPixels.bytes, try renderPixels(oneBar).bytes)
        XCTAssertNotEqual(zeroPixels.bytes, try renderPixels(twoBars).bytes)
        XCTAssertNotEqual(zeroPixels.bytes, try renderPixels(threeBars).bytes)
    }

    func testConnectedNonzeroSignalAlphaSumIncreasesWithBars() throws {
        let rssiValues: [Int?] = [-85, -75, -55]
        let signalRegion = CGRect(x: 35, y: 43, width: 50, height: 43)
        var alphaSums: [Int] = []

        for rssi in rssiValues {
            let snapshot = StatusSnapshot(
                battery: .placeholder,
                wifi: WiFiStatus(state: .connected, rssi: rssi),
                volume: .placeholder
            )
            let pixels = try renderPixels(snapshot)
            alphaSums.append(pixels.alphaSum(
                inSVGRect: signalRegion,
                size: 20,
                scale: 8
            ))
        }

        for index in 0..<(alphaSums.count - 1) {
            XCTAssertLessThan(alphaSums[index], alphaSums[index + 1])
        }
    }

    func testConnectedLowSignalRendersInactiveTrackWithMutedAlpha() throws {
        let oneBar = StatusSnapshot(
            battery: .placeholder,
            wifi: WiFiStatus(state: .connected, rssi: -85),
            volume: .placeholder
        )
        let outerArcRegion = CGRect(x: 35, y: 43, width: 50, height: 18)
        let pixels = try renderPixels(oneBar)
        let outerAlpha = pixels.alphaSum(
            inSVGRect: outerArcRegion,
            size: 20,
            scale: 8
        )
        // Outer arc is not active at 1 bar, but must be rendered in muted track color (> 0 alpha)
        XCTAssertGreaterThan(outerAlpha, 0)
    }

    func testRendererResolvesForegroundForEachDrawingAppearance() throws {
        let snapshot = StatusSnapshot(
            battery: .placeholder,
            wifi: WiFiStatus(state: .connected, rssi: -55),
            volume: .placeholder
        )
        let aqua = try XCTUnwrap(NSAppearance(named: .aqua))
        let darkAqua = try XCTUnwrap(NSAppearance(named: .darkAqua))
        let image = StatusIconRenderer.image(
            snapshot: snapshot,
            size: 20
        )
        let aquaPixels = try renderPixels(image: image, appearance: aqua)
        let darkAquaPixels = try renderPixels(image: image, appearance: darkAqua)
        let aquaLuminance = try XCTUnwrap(aquaPixels.averageOpaqueLuminance())
        let darkAquaLuminance = try XCTUnwrap(darkAquaPixels.averageOpaqueLuminance())

        XCTAssertLessThan(aquaLuminance, 0.4)
        XCTAssertGreaterThan(darkAquaLuminance, 0.55)
        XCTAssertGreaterThan(darkAquaLuminance - aquaLuminance, 0.25)
    }

    func testHotspotOverlayPointIsUnique() throws {
        let hotspotSnapshot = StatusSnapshot(
            battery: .placeholder,
            wifi: WiFiStatus(state: .hotspot, rssi: nil),
            volume: .placeholder
        )
        let connectedSnapshot = StatusSnapshot(
            battery: .placeholder,
            wifi: WiFiStatus(state: .connected, rssi: -55),
            volume: .placeholder
        )
        let hotspotPixels = try PixelBuffer(
            image: try XCTUnwrap(StatusIconRenderer.render(
                snapshot: hotspotSnapshot,
                size: 20,
                scale: 8,
                foreground: CGColor(gray: 1, alpha: 1)
            ))
        )
        let connectedPixels = try PixelBuffer(
            image: try XCTUnwrap(StatusIconRenderer.render(
                snapshot: connectedSnapshot,
                size: 20,
                scale: 8,
                foreground: CGColor(gray: 1, alpha: 1)
            ))
        )
        let hotspotOnlyPoint = CGPoint(x: 41.5, y: 58)

        XCTAssertGreaterThan(
            hotspotPixels.alpha(atSVGPoint: hotspotOnlyPoint, size: 20, scale: 8),
            0
        )
        XCTAssertEqual(
            connectedPixels.alpha(atSVGPoint: hotspotOnlyPoint, size: 20, scale: 8),
            0
        )
    }

    func testEthernetConnectionDrawsThreeDotMark() throws {
        let snapshot = StatusSnapshot(
            battery: .placeholder,
            wifi: WiFiStatus(state: .connected, rssi: -50),
            connection: .ethernet,
            volume: .placeholder
        )
        let pixels = try PixelBuffer(
            image: try XCTUnwrap(StatusIconRenderer.render(
                snapshot: snapshot,
                size: 20,
                scale: 16,
                foreground: CGColor(gray: 1, alpha: 1)
            ))
        )

        for dot in StatusIconGeometry.ethernetDots() {
            XCTAssertGreaterThan(
                pixels.alpha(atSVGPoint: dot, size: 20, scale: 16),
                230
            )
        }
    }

    func testEthernetConnectionUsesStandardWiFiSignalWhenEnabled() throws {
        let ethernetSnapshot = StatusSnapshot(
            battery: .placeholder,
            wifi: WiFiStatus(state: .hotspot, rssi: -55),
            connection: .ethernet,
            volume: .placeholder
        )
        let standardWiFiSnapshot = StatusSnapshot(
            battery: .placeholder,
            wifi: WiFiStatus(state: .connected, rssi: -55),
            volume: .placeholder
        )
        let ethernetPixels = try renderPixels(
            ethernetSnapshot,
            connectionOptions: ConnectionIconOptions(
                showsWiFiIconForEthernet: true
            )
        )
        let standardWiFiPixels = try renderPixels(standardWiFiSnapshot)

        XCTAssertEqual(ethernetPixels.bytes, standardWiFiPixels.bytes)
    }

    func testWiFiIconOptionsReplaceEachSpecialConnectionMark() throws {
        let cases: [(WiFiState, ConnectionIconOptions)] = [
            (
                .hotspot,
                ConnectionIconOptions(showsWiFiIconForHotspot: true)
            ),
            (
                .temporary,
                ConnectionIconOptions(showsWiFiIconForTemporaryConnection: true)
            ),
            (
                .shared,
                ConnectionIconOptions(showsWiFiIconForInternetSharing: true)
            )
        ]
        let standardWiFiPixels = try renderPixels(
            StatusSnapshot(
                battery: .placeholder,
                wifi: WiFiStatus(state: .connected, rssi: -55),
                volume: .placeholder
            )
        )

        for (state, connectionOptions) in cases {
            let pixels = try renderPixels(
                StatusSnapshot(
                    battery: .placeholder,
                    wifi: WiFiStatus(state: state, rssi: -55),
                    volume: .placeholder
                ),
                connectionOptions: connectionOptions
            )

            XCTAssertEqual(pixels.bytes, standardWiFiPixels.bytes, "\(state)")
        }
    }

    func testWiFiIconOptionUsesMutedFullSignalWhenRSSIIsMissing() throws {
        let specialPixels = try renderPixels(
            StatusSnapshot(
                battery: .placeholder,
                wifi: WiFiStatus(state: .hotspot, rssi: nil),
                volume: .placeholder
            ),
            connectionOptions: ConnectionIconOptions(showsWiFiIconForHotspot: true)
        )
        let standardPixels = try renderPixels(
            StatusSnapshot(
                battery: .placeholder,
                wifi: WiFiStatus(state: .connected, rssi: nil),
                volume: .placeholder
            )
        )

        XCTAssertEqual(specialPixels.bytes, standardPixels.bytes)
    }

    func testTemporaryAndSharedStatesRenderExpectedSizeAndMasks() throws {
        let temporarySnapshot = StatusSnapshot(
            battery: .placeholder,
            wifi: WiFiStatus(state: .temporary, rssi: -50),
            volume: .placeholder
        )
        let sharedSnapshot = StatusSnapshot(
            battery: .placeholder,
            wifi: WiFiStatus(state: .shared, rssi: -50),
            volume: .placeholder
        )
        let connectedSnapshot = StatusSnapshot(
            battery: .placeholder,
            wifi: WiFiStatus(state: .connected, rssi: -50),
            volume: .placeholder
        )

        let temporaryImage = try XCTUnwrap(StatusIconRenderer.render(
            snapshot: temporarySnapshot,
            size: 20,
            scale: 2,
            foreground: CGColor(gray: 1, alpha: 1)
        ))
        let sharedImage = try XCTUnwrap(StatusIconRenderer.render(
            snapshot: sharedSnapshot,
            size: 20,
            scale: 2,
            foreground: CGColor(gray: 1, alpha: 1)
        ))

        XCTAssertEqual(temporaryImage.width, 40)
        XCTAssertEqual(temporaryImage.height, 40)
        XCTAssertEqual(sharedImage.width, 40)
        XCTAssertEqual(sharedImage.height, 40)

        let pixelScale: CGFloat = 16
        let temporaryPixels = try PixelBuffer(
            image: try XCTUnwrap(StatusIconRenderer.render(
                snapshot: temporarySnapshot,
                size: 20,
                scale: pixelScale,
                foreground: CGColor(gray: 1, alpha: 1)
            ))
        )
        let sharedPixels = try PixelBuffer(
            image: try XCTUnwrap(StatusIconRenderer.render(
                snapshot: sharedSnapshot,
                size: 20,
                scale: pixelScale,
                foreground: CGColor(gray: 1, alpha: 1)
            ))
        )
        let connectedPixels = try PixelBuffer(
            image: try XCTUnwrap(StatusIconRenderer.render(
                snapshot: connectedSnapshot,
                size: 20,
                scale: pixelScale,
                foreground: CGColor(gray: 1, alpha: 1)
            ))
        )
        let outerEdgePoint = CGPoint(x: 59.5, y: 50.5)

        XCTAssertGreaterThan(
            temporaryPixels.alpha(atSVGPoint: outerEdgePoint, size: 20, scale: pixelScale),
            0
        )
        XCTAssertGreaterThan(
            sharedPixels.alpha(atSVGPoint: outerEdgePoint, size: 20, scale: pixelScale),
            0
        )
        XCTAssertGreaterThan(
            temporaryPixels.alpha(
                atSVGPoint: CGPoint(x: 59.5, y: 59.5),
                size: 20,
                scale: pixelScale
            ),
            0
        )
        XCTAssertEqual(
            temporaryPixels.alpha(
                atSVGPoint: CGPoint(x: 59.5, y: 53.5),
                size: 20,
                scale: pixelScale
            ),
            0
        )
        XCTAssertEqual(
            temporaryPixels.alpha(
                atSVGPoint: CGPoint(x: 59.5, y: 68.5),
                size: 20,
                scale: pixelScale
            ),
            0
        )
        XCTAssertEqual(
            sharedPixels.alpha(
                atSVGPoint: CGPoint(x: 59.5, y: 72),
                size: 20,
                scale: pixelScale
            ),
            0
        )

        let volumeRegion = CGRect(x: 25, y: 92, width: 75, height: 28)
        let connectedVolumeAlpha = connectedPixels.alphaSum(
            inSVGRect: volumeRegion,
            size: 20,
            scale: pixelScale
        )
        XCTAssertEqual(
            temporaryPixels.alphaSum(
                inSVGRect: volumeRegion,
                size: 20,
                scale: pixelScale
            ),
            connectedVolumeAlpha
        )
        XCTAssertEqual(
            sharedPixels.alphaSum(
                inSVGRect: volumeRegion,
                size: 20,
                scale: pixelScale
            ),
            connectedVolumeAlpha
        )
        XCTAssertNotEqual(temporaryPixels.bytes, sharedPixels.bytes)
    }

    func testVolumeAlphaSumIncreasesWithVisibleDots() throws {
        let scalars = [0.0, 0.25, 0.50, 0.75, 1.0]
        let volumeRegion = CGRect(x: 25, y: 92, width: 75, height: 28)
        var alphaSums: [Int] = []

        for scalar in scalars {
            let snapshot = StatusSnapshot(
                battery: .placeholder,
                wifi: .placeholder,
                volume: VolumeStatus(
                    scalar: scalar,
                    isMuted: false,
                    deviceName: nil
                )
            )
            let pixels = try PixelBuffer(
                image: try XCTUnwrap(StatusIconRenderer.render(
                    snapshot: snapshot,
                    size: 20,
                    scale: 8,
                    foreground: CGColor(gray: 1, alpha: 1)
                ))
            )
            alphaSums.append(pixels.alphaSum(
                inSVGRect: volumeRegion,
                size: 20,
                scale: 8
            ))
        }

        for index in 0..<(alphaSums.count - 1) {
            XCTAssertLessThan(alphaSums[index], alphaSums[index + 1])
        }
    }

    func testMutedVolumeMatchesZeroVolume() throws {
        let zeroSnapshot = StatusSnapshot(
            battery: .placeholder,
            wifi: .placeholder,
            volume: VolumeStatus(scalar: 0, isMuted: false, deviceName: nil)
        )
        let mutedSnapshot = StatusSnapshot(
            battery: .placeholder,
            wifi: .placeholder,
            volume: VolumeStatus(scalar: 0.8, isMuted: true, deviceName: nil)
        )
        let zeroPixels = try PixelBuffer(
            image: try XCTUnwrap(StatusIconRenderer.render(
                snapshot: zeroSnapshot,
                size: 20,
                scale: 8,
                foreground: CGColor(gray: 1, alpha: 1)
            ))
        )
        let mutedPixels = try PixelBuffer(
            image: try XCTUnwrap(StatusIconRenderer.render(
                snapshot: mutedSnapshot,
                size: 20,
                scale: 8,
                foreground: CGColor(gray: 1, alpha: 1)
            ))
        )

        XCTAssertEqual(mutedPixels.bytes, zeroPixels.bytes)
    }

    func testZeroVolumeDrawsFourHiddenDots() throws {
        let snapshot = StatusSnapshot(
            battery: .placeholder,
            wifi: .placeholder,
            volume: VolumeStatus(scalar: 0, isMuted: false, deviceName: nil)
        )
        let pixels = try PixelBuffer(
            image: try XCTUnwrap(StatusIconRenderer.render(
                snapshot: snapshot,
                size: 20,
                scale: 8,
                foreground: CGColor(gray: 1, alpha: 1)
            ))
        )
        let expectedAlpha = 0.22 * 255.0

        for point in StatusIconGeometry.volumeDots() {
            let alpha = Double(pixels.alpha(atSVGPoint: point, size: 20, scale: 8))
            XCTAssertEqual(alpha, expectedAlpha, accuracy: 2)
        }
    }

    private func makeBattery(
        rawPercentage: Int,
        isCharging: Bool = false,
        isLowPowerMode: Bool = false,
        isConnectedToPower: Bool? = nil
    ) -> BatteryStatus {
        BatteryStatus(
            rawPercentage: rawPercentage,
            isPresent: true,
            isCharging: isCharging,
            isLowPowerMode: isLowPowerMode,
            isConnectedToPower: isConnectedToPower ?? isCharging
        )
    }

    private func renderPixels(_ snapshot: StatusSnapshot) throws -> PixelBuffer {
        try renderPixels(snapshot, connectionOptions: .standard)
    }

    private func renderPixels(
        _ snapshot: StatusSnapshot,
        connectionOptions: ConnectionIconOptions
    ) throws -> PixelBuffer {
        try PixelBuffer(
            image: try XCTUnwrap(StatusIconRenderer.render(
                snapshot: snapshot,
                size: 20,
                scale: 8,
                foreground: CGColor(gray: 1, alpha: 1),
                connectionOptions: connectionOptions
            ))
        )
    }

    private func renderPixels(image: NSImage) throws -> PixelBuffer {
        let bitmap = try XCTUnwrap(NSBitmapImageRep(
            data: try XCTUnwrap(image.tiffRepresentation)
        ))
        return try PixelBuffer(
            image: try XCTUnwrap(bitmap.cgImage)
        )
    }

    private func renderPixels(
        image: NSImage,
        appearance: NSAppearance
    ) throws -> PixelBuffer {
        let width = Int(image.size.width.rounded(.up))
        let height = Int(image.size.height.rounded(.up))
        let bitmap = try XCTUnwrap(NSBitmapImageRep(
            bitmapDataPlanes: nil,
            pixelsWide: width,
            pixelsHigh: height,
            bitsPerSample: 8,
            samplesPerPixel: 4,
            hasAlpha: true,
            isPlanar: false,
            colorSpaceName: .deviceRGB,
            bytesPerRow: 0,
            bitsPerPixel: 0
        ))
        bitmap.size = image.size
        let context = try XCTUnwrap(NSGraphicsContext(bitmapImageRep: bitmap))

        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = context
        appearance.performAsCurrentDrawingAppearance {
            image.draw(in: NSRect(origin: .zero, size: image.size))
        }
        NSGraphicsContext.restoreGraphicsState()

        return try PixelBuffer(image: try XCTUnwrap(bitmap.cgImage))
    }
}
