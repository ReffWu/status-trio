import AppKit
import XCTest
import ImageIO
import UniformTypeIdentifiers
@testable import StatusTrioCore

/// Exports the glyphs the GNOME port composites, rendered by the macOS
/// renderer itself so shape, weight and hierarchical layer opacity are the
/// original. Skipped unless STATUS_TRIO_LINUX_ASSETS names an output folder.
///
///   STATUS_TRIO_LINUX_ASSETS=/path swift test --filter LinuxAssetExportTests
@MainActor
final class LinuxAssetExportTests: XCTestCase {
    private let canvasScale: CGFloat = 8 // 120-unit canvas -> 960 px
    private var manifest: [String: [String: Double]] = [:]

    func testExportAssets() throws {
        guard let dir = ProcessInfo.processInfo.environment["STATUS_TRIO_LINUX_ASSETS"] else {
            throw XCTSkip("Set STATUS_TRIO_LINUX_ASSETS")
        }
        let iconDir = "\(dir)/icon"
        let panelDir = "\(dir)/panel"
        try FileManager.default.createDirectory(atPath: iconDir, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(atPath: panelDir, withIntermediateDirectories: true)

        let wifiScale = 1.6
        func center(_ source: IconSymbolSource, scale: Double = wifiScale) -> IconSceneState {
            IconSceneState(center: .symbol(IconSymbolState(source: source, color: .primary, scale: scale)))
        }
        func sym(_ name: String, _ value: Double? = nil) -> IconSymbolSource {
            .symbol(name: name, variableValue: value, fallback: nil)
        }

        // Centre slot, drawn at the default Wi-Fi/Bluetooth scale (1.6).
        var centers: [(String, IconSceneState)] = [
            ("wifi-3", center(sym("wifi", 1))),
            ("wifi-2", center(sym("wifi", 0.66))),
            ("wifi-1", center(sym("wifi", 0.33))),
            ("wifi-0", center(sym("wifi", 0))),
            ("wifi-slash", center(sym("wifi.slash", 1))),
            ("wifi-exclamation", center(sym("wifi.exclamationmark", 1))),
            ("hotspot", center(sym("personalhotspot", 1))),
            ("ethernet", center(.primitive(.wiredPort), scale: 1)),
            ("screen-wedge", center(.primitive(.screenWedge))),
            ("arrow-wedge", center(.primitive(.arrowWedge))),
            ("center-bolt", center(.primitive(.bolt))),
            ("center-plug", center(.primitive(.plug))),
            ("keyboard", center(sym("keyboard"))),
        ]
        for name in ["airpods.pro", "airpods.gen4", "airpods.gen3", "airpods.max", "headphones",
                     "beats.headphones", "beats.studiobuds", "earbuds", "hifispeaker.fill",
                     "homepod.mini.fill", "speaker.fill", "dot.radiowaves.left.and.right"] {
            centers.append(("bt-\(name)", center(sym(name))))
        }
        for (name, scene) in centers {
            try exportScene(scene, regions: .all, name: name, dir: iconDir)
        }

        // Top-gap accessory: the plug drawn at the bolt's optical size.
        let plugRing = OuterRingState(
            segments: [RingSegmentState(progress: 1, color: .primary)],
            gap: .indicator,
            accessory: .symbol(IconSymbolState(source: .primitive(.plug), color: .primary,
                                               scale: BatteryIconOptions.defaultTextScale)),
            effect: nil,
            strokeScale: BatteryIconOptions.defaultRingStrokeScale,
            gapProgressMode: .absorbed
        )
        try exportScene(IconSceneState(outerRing: plugRing), regions: [.ringAccessory], name: "gap-plug", dir: iconDir)

        try write(manifest: manifest, to: "\(iconDir)/manifest.json")
        manifest = [:]

        // Popup panel glyphs, one raster per (symbol, size, weight) the SwiftUI
        // panel actually uses, so weights and optical sizes match exactly.
        let styles: [(String, CGFloat, NSFont.Weight)] = [
            ("row", 15, .medium),       // PanelSymbolView default (summary row glyphs, mute glyph)
            ("action", 13, .regular),   // PanelActionGlyph with .body (gear, power, ellipsis, back)
            ("chev", 10, .semibold),    // .caption.weight(.semibold) chevrons
            ("device", 13, .semibold),  // AudioOutputDeviceIconView / Bluetooth rows
            ("footer", 12, .regular),   // .callout label glyphs
            ("caption", 10, .regular),  // .caption glyphs (lock, segmented power modes)
            ("signal", 14, .regular),   // Wi-Fi list signal glyphs
        ]
        let panelSymbols: [(String, Double?)] = [
            ("battery.100", nil), ("battery.75", nil), ("battery.50", nil), ("battery.25", nil),
            ("battery.0", nil), ("battery.100.bolt", nil), ("battery.slash", nil),
            ("powerplug.fill", nil), ("bolt.fill", nil), ("bolt.batteryblock.fill", nil),
            ("leaf", nil), ("leaf.fill", nil),
            ("wifi", 1), ("wifi", 0.667), ("wifi", 0.333), ("wifi", 0.25), ("wifi", nil), ("wifi.slash", nil),
            ("wifi.exclamationmark", nil), ("personalhotspot", nil), ("lock.fill", nil),
            ("lock.shield", nil), ("lock.shield.fill", nil), ("network", nil), ("cable.connector", nil),
            ("gearshape", nil), ("chevron.right", nil), ("chevron.backward", nil),
            ("chevron.down", nil), ("chevron.up", nil), ("checkmark", nil), ("ellipsis.circle", nil),
            ("info.circle", nil), ("power", nil), ("arrow.clockwise", nil), ("xmark", nil), ("switch.2", nil),
            ("speaker.fill", nil), ("speaker.wave.1.fill", nil), ("speaker.wave.2.fill", nil),
            ("speaker.wave.3.fill", nil), ("speaker.slash.fill", nil), ("mic.fill", nil), ("mic.slash.fill", nil),
            ("airpods", nil), ("airpods.gen3", nil), ("airpods.gen4", nil), ("airpods.pro", nil),
            ("airpods.max", nil), ("headphones", nil), ("beats.headphones", nil), ("earbuds", nil),
            ("hifispeaker.fill", nil), ("homepod.mini.fill", nil), ("laptopcomputer", nil), ("display", nil),
            ("keyboard", nil), ("computermouse.fill", nil), ("magicmouse.fill", nil), ("gamecontroller.fill", nil),
            ("iphone", nil), ("applewatch", nil), ("dot.radiowaves.left.and.right", nil), ("tv", nil),
            ("sun.max.fill", nil), ("globe", nil), ("thermometer.medium", nil), ("waveform", nil),
            ("exclamationmark.triangle.fill", nil), ("exclamationmark.circle", nil), ("star.fill", nil),
            ("checkmark.circle.fill", nil), ("arrow.triangle.2.circlepath", nil), ("gauge", nil),
        ]
        for (name, value) in panelSymbols {
            for (style, size, weight) in styles {
                let base = value.map { "\(name)-\(Int(($0 * 100).rounded()))" } ?? name
                try exportPanelSymbol(name, variableValue: value, size: size, weight: weight,
                                      file: "\(base)~\(style)", dir: panelDir)
            }
        }
        // The Bluetooth section draws AppKit's template image in a 24 pt frame.
        if let bt = NSImage(named: NSImage.bluetoothTemplateName) {
            try exportImage(bt, file: "bluetooth~template", dir: panelDir)
        }
        try write(manifest: manifest, to: "\(panelDir)/manifest.json")
    }

    // MARK: - Helpers

    private func exportScene(_ scene: IconSceneState, regions: IconSceneRegion, name: String, dir: String) throws {
        let px = Int(120 * canvasScale)
        let context = try XCTUnwrap(bitmap(width: px, height: px))
        XCTAssertTrue(StatusIconRenderer.draw(
            scene: scene, in: context, size: CGFloat(px),
            foreground: CGColor(gray: 0, alpha: 1),
            criticalColor: StatusIconRenderer.defaultCriticalColor,
            regions: regions
        ), name)
        try crop(context, name: name, dir: dir, unitsPerPixel: 1 / canvasScale)
    }

    private func exportPanelSymbol(_ name: String, variableValue: Double?, size: CGFloat,
                                   weight: NSFont.Weight, file: String, dir: String) throws {
        // SwiftUI's Image(systemName:) default: monochrome, inactive variable layers dimmed.
        let config = NSImage.SymbolConfiguration(pointSize: size, weight: weight)
            .applying(.preferringMonochrome())
        let base = variableValue.map {
            NSImage(systemSymbolName: name, variableValue: $0, accessibilityDescription: nil)
        } ?? NSImage(systemSymbolName: name, accessibilityDescription: nil)
        guard let image = base?.withSymbolConfiguration(config) else {
            print("missing symbol \(name)")
            return
        }
        let scale: CGFloat = 3
        let w = Int((image.size.width * scale).rounded(.up))
        let h = Int((image.size.height * scale).rounded(.up))
        let context = try XCTUnwrap(bitmap(width: w, height: h))
        context.scaleBy(x: scale, y: scale)
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
        image.draw(in: CGRect(origin: .zero, size: image.size))
        NSGraphicsContext.restoreGraphicsState()
        // Full layout box in points (SwiftUI centres a symbol on this box), plus
        // the ink box: SF Symbols' layout boxes are not symmetric about the
        // glyph, so a glyph inside a circle is centred on its ink instead.
        let cg = try XCTUnwrap(context.makeImage())
        try png(cg, to: "\(dir)/\(file).png")
        var entry = ["w": Double(image.size.width), "h": Double(image.size.height), "px": Double(scale)]
        if let ink = inkBox(context) {
            entry["ix"] = Double(ink.minX / scale); entry["iy"] = Double(ink.minY / scale)
            entry["iw"] = Double(ink.width / scale); entry["ih"] = Double(ink.height / scale)
        }
        manifest[file] = entry
    }

    /// Pixels with any coverage, top-left origin (bitmap row 0 is the top).
    private func inkBox(_ context: CGContext) -> CGRect? {
        guard let data = context.data else { return nil }
        let bytes = data.assumingMemoryBound(to: UInt8.self)
        var minX = context.width, minY = context.height, maxX = -1, maxY = -1
        for y in 0..<context.height {
            for x in 0..<context.width where bytes[y * context.bytesPerRow + x * 4 + 3] > 0 {
                minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y)
            }
        }
        guard minX <= maxX else { return nil }
        return CGRect(x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1)
    }

    private func exportImage(_ image: NSImage, file: String, dir: String) throws {
        let scale: CGFloat = 3
        let w = Int((image.size.width * scale).rounded(.up))
        let h = Int((image.size.height * scale).rounded(.up))
        let context = try XCTUnwrap(bitmap(width: w, height: h))
        context.scaleBy(x: scale, y: scale)
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
        image.draw(in: CGRect(origin: .zero, size: image.size))
        NSGraphicsContext.restoreGraphicsState()
        try png(try XCTUnwrap(context.makeImage()), to: "\(dir)/\(file).png")
        manifest[file] = ["w": Double(image.size.width), "h": Double(image.size.height), "px": Double(scale)]
    }

    private func bitmap(width: Int, height: Int) -> CGContext? {
        CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                  space: CGColorSpaceCreateDeviceRGB(),
                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    }

    /// Crops to the ink and records the crop rectangle in canvas units.
    private func crop(_ context: CGContext, name: String, dir: String, unitsPerPixel: CGFloat) throws {
        let image = try XCTUnwrap(context.makeImage())
        let w = context.width, h = context.height
        let bytes = try XCTUnwrap(context.data).assumingMemoryBound(to: UInt8.self)
        var minX = w, minY = h, maxX = -1, maxY = -1
        for y in 0..<h {
            for x in 0..<w where bytes[y * context.bytesPerRow + x * 4 + 3] > 0 {
                minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y)
            }
        }
        XCTAssertLessThanOrEqual(minX, maxX, "\(name) drew nothing")
        guard minX <= maxX else { return }
        // Bitmap row 0 is the top of the canvas because the renderer flips to y-down.
        minX = max(0, minX - 2); minY = max(0, minY - 2); maxX = min(w - 1, maxX + 2); maxY = min(h - 1, maxY + 2)
        let rect = CGRect(x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1)
        let cropped = try XCTUnwrap(image.cropping(to: rect))
        try png(cropped, to: "\(dir)/\(name).png")
        manifest[name] = [
            "x": Double(CGFloat(minX) * unitsPerPixel), "y": Double(CGFloat(minY) * unitsPerPixel),
            "w": Double(rect.width * unitsPerPixel), "h": Double(rect.height * unitsPerPixel),
            "px": Double(canvasScale),
        ]
    }

    private func png(_ image: CGImage, to path: String) throws {
        let url = URL(fileURLWithPath: path)
        let dest = try XCTUnwrap(CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil))
        CGImageDestinationAddImage(dest, image, nil)
        XCTAssertTrue(CGImageDestinationFinalize(dest))
    }

    private func write(manifest: [String: [String: Double]], to path: String) throws {
        let data = try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: URL(fileURLWithPath: path))
    }
}
