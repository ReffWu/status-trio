import XCTest
import ImageIO
import UniformTypeIdentifiers
@testable import StatusTrioCore

/// Temporary: writes every icon-sheet state as a standalone PNG so the GNOME
/// port can be compared pixel for pixel. Skipped unless the env var is set.
@MainActor
final class LinuxReferenceRenderTests: XCTestCase {
    func testWritesReferenceIcons() throws {
        guard let dir = ProcessInfo.processInfo.environment["STATUS_TRIO_LINUX_REF"] else {
            throw XCTSkip("Set STATUS_TRIO_LINUX_REF")
        }
        var index = 0
        var manifest = ""
        for section in IconStateSheet.sections {
            for entry in section.entries {
                for (suffix, gray) in [("light", 0.0), ("dark", 1.0)] {
                    guard let icon = renderMenuBarFixture(
                        menuBarStatus: entry.status, size: 60, scale: 4,
                        foreground: CGColor(gray: gray, alpha: 1),
                        options: entry.batteryOptions,
                        connectionOptions: entry.connectionOptions,
                        volumeOptions: entry.volumeOptions,
                        bluetoothAudioOptions: entry.bluetoothAudioOptions
                    ) else { continue }
                    let url = URL(fileURLWithPath: "\(dir)/\(String(format: "%02d", index))-\(suffix).png")
                    let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
                    CGImageDestinationAddImage(dest, icon, nil)
                    CGImageDestinationFinalize(dest)
                }
                manifest += "\(String(format: "%02d", index))\t\(entry.en)\n"
                index += 1
            }
        }
        // Charging-effect frames of the first ("Charging") state, steady 36-step cycle.
        let charging = IconStateSheet.sections[0].entries[0]
        for step in [4, 12, 20, 28, 31, 33] {
            let phase = ChargingEffectPhase(step: step, stepsPerCycle: 36, kind: .steady)
            guard let icon = renderMenuBarFixture(
                menuBarStatus: charging.status, size: 60, scale: 4,
                foreground: CGColor(gray: 0, alpha: 1), options: charging.batteryOptions,
                connectionOptions: charging.connectionOptions, volumeOptions: charging.volumeOptions,
                bluetoothAudioOptions: charging.bluetoothAudioOptions, phase: phase
            ) else { continue }
            let url = URL(fileURLWithPath: "\(dir)/fx\(step)-light.png")
            let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
            CGImageDestinationAddImage(dest, icon, nil)
            CGImageDestinationFinalize(dest)
            manifest += "fx\(step)\tcharging effect step \(step)\n"
        }
        try manifest.write(toFile: "\(dir)/manifest.tsv", atomically: true, encoding: .utf8)
    }
}
