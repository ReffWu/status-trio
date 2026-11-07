#!/usr/bin/env python3
"""Converts the macOS app's Localizable.strings into JSON for the GNOME port."""
import json, pathlib, subprocess

root = pathlib.Path(__file__).resolve().parents[2]
src = root / 'Sources/StatusTrioCore/Resources'
out = root / 'linux/gnome-extension/locale'
out.mkdir(parents=True, exist_ok=True)
for lproj in sorted(src.glob('*.lproj')):
    # .strings files are old-style plists; plutil turns them into JSON.
    raw = subprocess.run(['plutil', '-convert', 'json', '-o', '-', '--', str(lproj / 'Localizable.strings')],
                         capture_output=True, check=True).stdout
    strings = json.loads(raw)
    (out / f'{lproj.stem}.json').write_text(json.dumps(strings, ensure_ascii=False, sort_keys=True, indent=0))
    print(lproj.stem, len(strings))
