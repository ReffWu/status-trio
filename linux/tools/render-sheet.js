#!/usr/bin/env -S gjs -m
// SPDX-License-Identifier: Apache-2.0
// Headless render of every fixture state, for pixel comparison with the
// macOS renderer:  gjs -m linux/tools/render-sheet.js OUT_DIR [SIZE]

import Cairo from 'cairo';
import GLib from 'gi://GLib';
import System from 'system';

import {buildScene} from '../gnome-extension/lib/scene.js';
import {drawScene, loadIconAssets, PALETTES} from '../gnome-extension/lib/renderer.js';
import {FIXTURES} from './fixtures.js';

const [outDir, sizeArg] = ARGV;
if (!outDir) {
    printerr('usage: render-sheet.js OUT_DIR [SIZE]');
    System.exit(2);
}
const size = Number(sizeArg ?? 240);
GLib.mkdir_with_parents(outDir, 0o755);

const here = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
const readText = path => new TextDecoder().decode(GLib.file_get_contents(path)[1]);
const assets = {icon: loadIconAssets(`${here}/../gnome-extension/assets/icon`, readText)};

FIXTURES.forEach((fixture, i) => {
    for (const mode of ['light', 'dark']) {
        const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, size, size);
        const cr = new Cairo.Context(surface);
        drawScene(cr, buildScene(fixture.snapshot, fixture.options), size, PALETTES[mode], assets);
        cr.$dispose();
        surface.writeToPNG(`${outDir}/${String(i).padStart(2, '0')}-${mode}.png`);
    }
});
// Charging effect frames (steady 36-step cycle) of the "Charging" state.
for (const step of [4, 12, 20, 28, 31, 33]) {
    const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, size, size);
    const cr = new Cairo.Context(surface);
    const fixture = FIXTURES[0];
    drawScene(cr, buildScene(fixture.snapshot, fixture.options), size, PALETTES.light, assets,
        {step, steps: 36, multiplier: 1});
    cr.$dispose();
    surface.writeToPNG(`${outDir}/fx${step}-light.png`);
}
print(`rendered ${FIXTURES.length} states to ${outDir}`);
