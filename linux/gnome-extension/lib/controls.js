// SPDX-License-Identifier: Apache-2.0
// AppKit's switch and checkbox, painted with Cairo so the panel (St) and the
// preferences (GTK) share one drawing. Geometry and colours were measured on
// AppKit renders at 6x (macOS 26): NSSwitch at .small and the regular
// NSButton checkbox. Coordinates are points; the caller scales the context.

import Cairo from 'cairo';

export const ACCENT = {light: [0, 122 / 255, 1], dark: [10 / 255, 132 / 255, 1]};

/** NSSwitch .small: a 44 x 19 track and a 26 x 16 knob inset 2.1 pt. */
export const SWITCH_SIZE = [44, 19];
const KNOB_W = 25.95, KNOB_H = 15.94, KNOB_INSET = 2.1;
// Light mode rings the knob with a soft shade, a little heavier above it:
// [growth, alpha] layers fitted to the render, shifted up by RING_DY.
const KNOB_RING = [[3.1, 0.018], [2.35, 0.023], [0.7, 0.010], [0.15, 0.026]];
const RING_DY = -0.31;

/** Regular NSButton checkbox: a 16 pt rounded square. */
export const CHECKBOX_SIZE = 16;
const CHECKBOX_RADIUS = 5.5;
// The checkmark mask is 6 px per point, the size it was rendered at.
const CHECK_PX = 6;

/** Fill of an "off" track or an unchecked box: about 10 % black, or white in dark. */
function offColor(dark, track = false) {
    return dark ? [1, 1, 1, 0.098] : [0, 0, 0, track ? 0.094 : 0.098];
}

function mix(a, b, t) {
    return a.map((v, i) => v + (b[i] - v) * t);
}

function pill(cr, x, y, w, h) {
    const r = h / 2;
    cr.newSubPath();
    cr.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
    cr.arc(x + r, y + r, r, Math.PI / 2, Math.PI * 1.5);
    cr.closePath();
}

function roundedSquare(cr, x, y, s, r) {
    cr.newSubPath();
    cr.arc(x + s - r, y + r, r, -Math.PI / 2, 0);
    cr.arc(x + s - r, y + s - r, r, 0, Math.PI / 2);
    cr.arc(x + r, y + s - r, r, Math.PI / 2, Math.PI);
    cr.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
    cr.closePath();
}

/** `t` runs from 0 (off) to 1 (on) so the caller can animate the knob. */
export function paintSwitch(cr, t, dark) {
    const [w, h] = SWITCH_SIZE;
    pill(cr, 0, 0, w, h);
    cr.setSourceRGBA(...mix(offColor(dark, true), [...ACCENT[dark ? 'dark' : 'light'], 1], t));
    cr.fill();

    const x = KNOB_INSET + (w - 2 * KNOB_INSET - KNOB_W) * t;
    const y = (h - KNOB_H) / 2;
    if (!dark) {
        for (const [grow, a] of KNOB_RING) {
            pill(cr, x - grow, y - grow + RING_DY, KNOB_W + 2 * grow, KNOB_H + 2 * grow);
            cr.setSourceRGBA(0, 0, 0, a);
            cr.fill();
        }
    }
    pill(cr, x, y, KNOB_W, KNOB_H);
    cr.setSourceRGBA(1, 1, 1, 1);
    cr.fill();
}

let _check = null;

/** Loads the checkmark mask; call once with the extension directory. */
export function loadControls(dir) {
    _check = Cairo.ImageSurface.createFromPNG(`${dir}/assets/controls/checkbox-check.png`);
}

export function paintCheckbox(cr, checked, dark) {
    const s = CHECKBOX_SIZE;
    roundedSquare(cr, 0, 0, s, CHECKBOX_RADIUS);
    cr.setSourceRGBA(...(checked ? [...ACCENT[dark ? 'dark' : 'light'], 1] : offColor(dark)));
    cr.fill();
    if (!checked || !_check)
        return;
    cr.save();
    cr.scale(1 / CHECK_PX, 1 / CHECK_PX);
    cr.setSourceRGBA(1, 1, 1, 1);
    const pattern = new Cairo.SurfacePattern(_check);
    pattern.setFilter(Cairo.Filter.GOOD);
    cr.mask(pattern);
    cr.restore();
}
