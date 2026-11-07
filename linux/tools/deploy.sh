#!/usr/bin/env bash
# Copies the extension to the Fedora test machine: the standard install path
# (used at next login) plus a fresh build directory that the dev loader
# reloads from, so the running shell picks up new code immediately.
set -euo pipefail
HOST=${HOST:-reffwu@10.223.114.61}
KEY=${KEY:-$HOME/.ssh/fedora_macbook}
HERE=$(cd "$(dirname "$0")/.." && pwd)
SSH=(ssh -i "$KEY" "$HOST")
N=$(date +%s)
python3 "$HERE/tools/build-css.py" >/dev/null
rsync -az --delete -e "ssh -i $KEY" "$HERE/gnome-extension/" "$HOST:.local/share/gnome-shell/extensions/status-trio@reffwu/"
"${SSH[@]}" "set -e; D=~/.local/share/gnome-shell/extensions/status-trio@reffwu
  glib-compile-schemas \$D/schemas
  rm -rf ~/src/status-trio-builds; mkdir -p ~/src/status-trio-builds/$N; cp -a \$D ~/src/status-trio-builds/$N/
  export XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus
  gdbus call --session --dest org.gnome.Shell --object-path /org/reffwu/StatusTrioDev \
    --method org.reffwu.StatusTrioDev.Reload ~/src/status-trio-builds/$N/status-trio@reffwu"
