import AppKit
import SwiftUI
import XCTest
@testable import StatusTrioCore

/// Exports the Settings window's tinted icon tiles and small SF Symbol masks
/// for the GNOME port's preferences window. Runs only with
/// STATUS_TRIO_LINUX_PREFS_ASSETS set to an output directory.
@MainActor
final class LinuxPrefsAssetExportTests: XCTestCase {
    private static let tints: [String: Color] = [
        "blue": .blue, "cyan": .cyan, "gray": .gray, "green": .green, "indigo": .indigo,
        "orange": .orange, "pink": .pink, "purple": .purple, "red": .red, "teal": .teal,
        "yellow": .yellow,
    ]

    /// (symbol, tint, tile side in pt). "rune" is the sidebar's Bluetooth rune.
    private static let tiles: [(String, String, CGFloat)] = [
        ("macwindow.on.rectangle", "indigo", 22), ("battery.100percent", "green", 22),
        ("wifi", "blue", 22), ("rune", "blue", 22), ("speaker.wave.3.fill", "cyan", 22),
        ("list.bullet.rectangle", "purple", 22), ("gearshape.fill", "gray", 22),
        ("info.circle.fill", "orange", 22),

        ("menubar.rectangle", "indigo", 26), ("circle.circle", "indigo", 26),
        ("percent", "green", 26), ("bolt.fill", "yellow", 26), ("powerplug.portrait.fill", "teal", 26),
        ("textformat.size", "blue", 26), ("circle.lefthalf.filled", "blue", 26),
        ("battery100.bolt", "green", 26), ("paintpalette.fill", "orange", 26),
        ("exclamationmark.triangle.fill", "red", 26), ("menubar.rectangle", "green", 26),
        ("circle.inset.filled", "indigo", 26), ("cable.connector", "teal", 26),
        ("personalhotspot", "blue", 26), ("network", "purple", 26),
        ("antenna.radiowaves.left.and.right", "indigo", 26), ("wifi.exclamationmark", "orange", 26),
        ("paintpalette.fill", "blue", 26), ("waveform", "indigo", 26),
        ("speaker.wave.2.fill", "cyan", 26), ("battery.100percent", "green", 26),
        ("wifi", "blue", 26), ("power.circle", "blue", 26), ("lock.shield", "indigo", 26),
        ("list.bullet.rectangle", "purple", 26), ("number", "teal", 26),
        ("speaker.wave.2", "cyan", 26), ("arrow.up.arrow.down.circle.fill", "cyan", 26),
        ("arrow.up.arrow.down", "indigo", 26), ("arrow.uturn.backward", "purple", 26),
        ("eye.slash", "indigo", 26), ("switch.2", "blue", 26), ("keyboard", "indigo", 26),
    ]

    /// (symbol, point size, weight) for monochrome masks tinted at runtime.
    private static let masks: [(String, CGFloat, Font.Weight)] = [
        ("info.circle", 11, .regular), ("exclamationmark.circle", 11, .regular),
        ("chevron.down", 10, .semibold), ("chevron.down", 11, .medium),
        ("chevron.up.chevron.down", 9, .bold), ("chevron.up", 8, .bold), ("chevron.down", 8, .bold),
        ("line.3.horizontal", 11, .regular), ("checkmark", 9, .bold),
        ("apple.logo", 12, .medium), ("switch.2", 10, .regular),
        ("moon.fill", 10, .regular), ("sun.max.fill", 10, .regular),
        ("battery.100percent", 13, .regular), ("wifi", 13, .regular), ("lock.shield", 13, .regular),
        ("antenna.radiowaves.left.and.right", 13, .regular), ("speaker.wave.2", 13, .regular),
        ("keyboard", 13, .regular), ("star.fill", 11, .regular), ("globe", 11, .regular),
        ("link", 11, .regular), ("person.circle", 11, .regular), ("at", 11, .regular),
    ]

    func testExportPrefsAssets() throws {
        guard let out = ProcessInfo.processInfo.environment["STATUS_TRIO_LINUX_PREFS_ASSETS"] else {
            throw XCTSkip("set STATUS_TRIO_LINUX_PREFS_ASSETS")
        }
        let dir = URL(fileURLWithPath: out)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var manifest: [String: [String: Double]] = [:]

        for (symbol, tint, size) in Self.tiles {
            let glyph: SettingsGlyph = symbol == "rune" ? .bluetoothRune : .symbol(symbol)
            let view = SettingsIcon(glyph: glyph, tint: try XCTUnwrap(Self.tints[tint]), size: size)
                .environment(\.colorScheme, .light)
            try write(view, size: CGSize(width: size, height: size),
                      to: dir.appendingPathComponent("tile-\(symbol)-\(tint)-\(Int(size)).png"))
        }

        for (symbol, point, weight) in Self.masks {
            let name = "mask-\(symbol)-\(Int(point))-\(weightName(weight))"
            let image = Image(systemName: symbol).font(.system(size: point, weight: weight))
                .foregroundStyle(.white)
            let measured = NSHostingView(rootView: image).fittingSize
            try write(image.frame(width: measured.width, height: measured.height),
                      size: measured, to: dir.appendingPathComponent("\(name).png"))
            manifest[name] = ["width": measured.width, "height": measured.height]
        }

        let data = try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: dir.appendingPathComponent("masks.json"))
    }

    private func weightName(_ weight: Font.Weight) -> String {
        switch weight {
        case .medium: "medium"
        case .semibold: "semibold"
        case .bold: "bold"
        default: "regular"
        }
    }

    private func write(_ view: some View, size: CGSize, to url: URL) throws {
        let renderer = ImageRenderer(content: view.frame(width: size.width, height: size.height))
        renderer.scale = 3
        let cg = try XCTUnwrap(renderer.cgImage)
        let rep = NSBitmapImageRep(cgImage: cg)
        try XCTUnwrap(rep.representation(using: .png, properties: [:])).write(to: url)
    }
}
