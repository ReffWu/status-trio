#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Diff the GNOME renders against the macOS reference renders.

    compare-reference.py REF_DIR OURS_DIR OUT.png [--mode light|dark] [--only 00,03]

Prints a per-state score (mean premultiplied RGBA difference, 0-255) and
writes a contact sheet: reference | GNOME | amplified difference.
"""
import argparse
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw


def premultiplied(img):
    img = img.convert("RGBA")
    r, g, b, a = img.split()
    mul = lambda ch: ImageChops.multiply(ch, a)
    return Image.merge("RGBA", (mul(r), mul(g), mul(b), a))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("ref")
    p.add_argument("ours")
    p.add_argument("out")
    p.add_argument("--mode", default="light")
    p.add_argument("--only", default="")
    args = p.parse_args()

    ref_dir, ours_dir = Path(args.ref), Path(args.ours)
    names = [l.split("\t") for l in (ref_dir / "manifest.tsv").read_text().splitlines() if l]
    if args.only:
        keep = set(args.only.split(","))
        names = [n for n in names if n[0] in keep]

    bg = (236, 236, 240, 255) if args.mode == "light" else (40, 40, 44, 255)
    cell = 240
    sheet = Image.new("RGBA", (cell * 3 + 40, (cell + 24) * len(names) + 10), bg)
    draw = ImageDraw.Draw(sheet)
    total = 0.0
    for row, (idx, label) in enumerate(names):
        ref = Image.open(ref_dir / f"{idx}-{args.mode}.png").convert("RGBA")
        ours = Image.open(ours_dir / f"{idx}-{args.mode}.png").convert("RGBA").resize(ref.size)
        diff = ImageChops.difference(premultiplied(ref), premultiplied(ours))
        hist = diff.convert("L").histogram()
        score = sum(i * c for i, c in enumerate(hist)) / (ref.width * ref.height)
        total += score
        print(f"{idx}  {score:6.2f}  {label}")
        y = row * (cell + 24) + 22
        for col, im in enumerate([ref, ours]):
            tile = Image.new("RGBA", ref.size, bg)
            tile.alpha_composite(im)
            sheet.alpha_composite(tile, (10 + col * (cell + 10), y))
        amp = diff.convert("L").point(lambda v: min(255, v * 4))
        sheet.paste(Image.merge("RGBA", (amp, amp, amp, Image.new("L", amp.size, 255))), (10 + 2 * (cell + 10), y))
        draw.text((10, y - 16), f"{idx} {label}  diff={score:.2f}", fill=(128, 128, 128, 255))
    print(f"mean {total / max(1, len(names)):.2f}")
    sheet.save(args.out)


if __name__ == "__main__":
    main()
