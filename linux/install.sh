#!/usr/bin/env bash
# 在 GNOME 机器上安装 Status Trio 扩展（在本仓库的 linux/ 目录里运行）。
set -euo pipefail
UUID=status-trio@reffwu
HERE=$(cd "$(dirname "$0")" && pwd)
DEST=${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID

python3 "$HERE/tools/build-css.py" >/dev/null
mkdir -p "$DEST"
rsync -a --delete "$HERE/gnome-extension/" "$DEST/"
glib-compile-schemas "$DEST/schemas"
gnome-extensions enable "$UUID" 2>/dev/null || true

echo "已安装到 $DEST"
echo "Wayland 下需要注销并重新登录一次，GNOME Shell 才会加载新代码。"
