import AppKit
import SwiftUI

/// Live status icon preview shown at the top of the icon-related settings panes.
///
/// The card renders the real menu bar artwork through `StatusIconRenderer`, so
/// every option that feeds the icon — battery, connection, volume — updates it
/// immediately.
struct StatusIconPreviewCard: View {
    @ObservedObject var store: SettingsStore
    @ObservedObject var statusStore: SystemStatusStore
    @Binding var isDarkBackground: Bool
    @EnvironmentObject private var localization: Localization

    var body: some View {
        VStack(spacing: 8) {
            MenuBarPreviewBar(
                status: MenuBarStatus(snapshot: statusStore.snapshot),
                iconSize: store.iconSize,
                batteryOptions: store.batteryIconOptions,
                connectionOptions: store.connectionIconOptions,
                volumeOptions: store.volumeIconOptions,
                bluetoothAudioOptions: store.bluetoothAudioIconOptions,
                isDarkBackground: isDarkBackground
            ) {
                appearanceToggle
            }
            .animation(.easeInOut(duration: 0.15), value: store.iconSize)
            .animation(.easeInOut(duration: 0.15), value: store.batteryIconOptions)
            .animation(.easeInOut(duration: 0.15), value: store.connectionIconOptions)
            .animation(.easeInOut(duration: 0.15), value: store.volumeIconOptions)
            .animation(.easeInOut(duration: 0.15), value: store.bluetoothAudioIconOptions)

            Text(localization.string(.settingsPreviewHint))
                .font(.system(size: 11))
                .foregroundStyle(.tertiary)
        }
    }

    private var appearanceToggle: some View {
        Button {
            withAnimation(.easeInOut(duration: 0.2)) {
                isDarkBackground.toggle()
            }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: isDarkBackground ? "moon.fill" : "sun.max.fill")
                    .font(.system(size: 10))
                Text(localization.string(isDarkBackground ? .settingsPreviewDark : .settingsPreviewLight))
                    .font(.system(size: 10.5, weight: .medium))
            }
            .foregroundStyle(isDarkBackground ? Color.white.opacity(0.85) : Color.black.opacity(0.85))
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(
                Capsule()
                    .fill(isDarkBackground ? Color.white.opacity(0.15) : Color.black.opacity(0.08))
            )
        }
        .buttonStyle(.plain)
        .help(localization.string(.settingsPreviewToggleHelp))
    }
}

/// Small Dock tile preview that mirrors the live Dock icon.
struct DockIconPreviewTile: View {
    @ObservedObject var store: SettingsStore
    @ObservedObject var statusStore: SystemStatusStore
    var size: CGFloat = 44
    var overrideStyle: DockIconBackgroundStyle? = nil

    var body: some View {
        DockIconTile(
            status: MenuBarStatus(snapshot: statusStore.snapshot),
            batteryOptions: store.batteryIconOptions,
            connectionOptions: store.connectionIconOptions,
            volumeOptions: store.volumeIconOptions,
            bluetoothAudioOptions: store.bluetoothAudioIconOptions,
            backgroundStyle: resolvedBackgroundStyle,
            size: size
        )
        .animation(.easeInOut(duration: 0.15), value: store.batteryIconOptions)
        .animation(.easeInOut(duration: 0.15), value: store.connectionIconOptions)
        .animation(.easeInOut(duration: 0.15), value: store.volumeIconOptions)
        .animation(.easeInOut(duration: 0.15), value: store.bluetoothAudioIconOptions)
        .accessibilityHidden(true)
    }

    private var resolvedBackgroundStyle: DockIconBackgroundStyle {
        if let overrideStyle {
            return overrideStyle
        }
        return DockIconBackgroundResolver.style(
            for: store.dockIconBackgroundPreference,
            theme: SystemIconAppearanceReader.current(),
            isDarkAppearance: NSApplication.shared.effectiveAppearance
                .bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
        )
    }
}
