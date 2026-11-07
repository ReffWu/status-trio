# Status Trio for GNOME

macOS 版 Status Trio 的 GNOME Shell 移植：顶栏一个图标同时显示电池、网络和音量，点击打开与 macOS 版逐项对齐的状态面板。

- 适配：GNOME Shell 51（Fedora 45 上验证）
- 扩展 UUID：`status-trio@reffwu`

## 安装

```bash
./install.sh
```

装完注销再登录一次。右键顶栏图标可以打开设置。

## 和 macOS 版的对应关系

| macOS | GNOME |
| --- | --- |
| 菜单栏图标（Core Graphics 绘制） | `lib/renderer.js` + `lib/scene.js`：同一套场景逻辑，用 Cairo 绘制 |
| SF Symbols | `assets/panel/*.png`：由 AppKit 按面板实际字号、字重导出的单色蒙版，运行时按 CSS 颜色着色 |
| StatusPopoverView（SwiftUI） | `lib/panel.js`：逐个视图移植，尺寸取自 SwiftUI 源码，并与 macOS 渲染图对照校准 |
| IOKit / CoreWLAN / CoreAudio / IOBluetooth | UPower、power-profiles-daemon（tuned-ppd）、NetworkManager（libnm）、PulseAudio/PipeWire（Gvc）、BlueZ（GnomeBluetooth）、GNOME 输入法管理器 |
| Settings 窗口 | `prefs.js`（libadwaita），分页与 macOS 设置页一一对应 |
| 12 种语言 | `locale/<lang>.json` 由 `tools/export-strings.py` 从原版 `.strings` 导出；Linux 专有文案在 `locale/linux.json` |

GNOME 自带的网络、音量、电源三个顶栏图标会被隐藏（设置里可关），快捷设置入口换成 `switch.2` 图标。

## 开发

| 文件 | 用途 |
| --- | --- |
| `tools/build-css.py` | 从一份模板生成 `stylesheet-light.css` / `stylesheet-dark.css`，颜色取自 macOS 参照渲染 |
| `tools/deploy.sh` | 同步到测试机并通过 dev loader 热重载（不用重新登录） |
| `tools/devloader/` | 开发用的辅助扩展，提供 D-Bus `Reload(path)`；GJS 按 URI 缓存 ES 模块，所以每次从新的目录加载 |
| `tools/panel-ref/` | macOS 面板参照图，由 `Tests/StatusTrioCoreTests/LinuxPanelReferenceTests.swift` 生成 |
| `Tests/StatusTrioCoreTests/LinuxAssetExportTests.swift` | 在 macOS 上导出 SF Symbols 蒙版和图标素材 |

### 已知的坑

- **不要用 `NM.Device.filter_connections()`**：它的 introspection 注解在绑定语言下是错的，GJS 会多释放一次连接对象，之后 GC 回收 NMClient 时整个 GNOME Shell 会崩溃。用 `client.get_connections().filter(c => dev.connection_valid(c))`。
- **中文行高**：Pango 会按所有回退字体取最大行高，Noto Sans CJK 约 1.45 em，会让每行中文比 macOS 高约 3pt。`panel.js` 的 `Text` 按主字体度量行盒，基线对齐主字体 ascent，与 SwiftUI `Text` 的行为一致。
- GType 名称在进程内全局唯一，热重载时靠 `lib/gtype.js` 给类名加上与模块 URI 相关的后缀。
