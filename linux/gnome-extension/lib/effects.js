// SPDX-License-Identifier: Apache-2.0
// Port of ChargingEffectPolicy / ChargingEffectTimeline / ChargingEffectClock /
// ChargingEffectPalette and StatusIconRenderer.drawChargingEffect.

import Cairo from 'cairo';

import * as G from './geometry.js';

export const FRAMES_PER_SECOND = 20;
const STEADY_CYCLE = 1.8;
const BURST = 0.6;
const HEARTBEAT = 0.25;
const TAIL_RATIO = 0.32;
const MAX_TAIL_TO_FILL = 0.78;
const MIN_VISIBLE_FILL = 0.25;
const BOOST = 1.35;
const EPS = 1e-5 / FRAMES_PER_SECOND;

function phaseAt(elapsed, duration, multiplier = 1) {
    const steps = Math.round(duration * FRAMES_PER_SECOND);
    const cycleElapsed = elapsed % duration;
    const step = Math.floor(cycleElapsed * FRAMES_PER_SECOND + 1e-6) % steps;
    return {step, steps, multiplier};
}

/** Timeline state machine: plug-in burst, steady 1.8 s cycles, level-advance heartbeat boost. */
export class ChargingClock {
    constructor(now = () => Date.now() / 1000) {
        this._now = now;
        this._previous = null;
        this._burstStart = null;
        this._steadyStart = null;
        this._boostCycle = null;
    }

    get running() {
        return this._steadyStart !== null;
    }

    /** Feed every battery update. Returns true when the effect should animate. */
    update(battery, enabled) {
        const prior = this._previous;
        this._previous = {...battery};
        const animate = enabled && battery.isPresent && battery.isCharging && !battery.isCharged;
        if (!animate) {
            this.stop();
            return false;
        }
        const now = this._now();
        let event = null;
        if (prior) {
            if (!prior.isCharging)
                event = 'pluggedIn';
            else if (!prior.isCharged && battery.percentage > prior.percentage)
                event = 'levelAdvanced';
        }
        if (!this.running || event === 'pluggedIn')
            this._begin(event, now);
        if (event === 'levelAdvanced')
            this._scheduleBoost(now);
        return true;
    }

    stop() {
        this._burstStart = null;
        this._steadyStart = null;
        this._boostCycle = null;
    }

    _begin(event, now) {
        this._boostCycle = null;
        if (event === 'pluggedIn') {
            this._burstStart = now;
            this._steadyStart = now + BURST;
        } else {
            this._burstStart = null;
            this._steadyStart = now;
        }
    }

    _scheduleBoost(now) {
        if (this._steadyStart === null)
            return;
        const elapsed = Math.max(0, now - this._steadyStart) + EPS;
        const index = Math.floor(elapsed / STEADY_CYCLE);
        const inCycle = elapsed % STEADY_CYCLE;
        this._boostCycle = index + (inCycle >= STEADY_CYCLE - HEARTBEAT ? 1 : 0);
    }

    phase() {
        if (this._steadyStart === null)
            return null;
        const now = this._now();
        if (this._burstStart !== null) {
            const elapsed = Math.max(0, now - this._burstStart) + EPS;
            if (elapsed * FRAMES_PER_SECOND + 1e-5 < Math.round(BURST * FRAMES_PER_SECOND))
                return phaseAt(elapsed, BURST);
            this._burstStart = null;
        }
        const elapsed = Math.max(0, now - this._steadyStart) + EPS;
        const index = Math.floor(elapsed / STEADY_CYCLE);
        return phaseAt(elapsed, STEADY_CYCLE, index === this._boostCycle ? BOOST : 1);
    }
}

/** ChargingEffectPolicy.frame */
export function effectFrame(progress, phase, hasGap, gapWidth) {
    if (!phase || !Number.isFinite(progress))
        return null;
    const p = Math.min(1, Math.max(0, progress));
    const visibleArc = G.visibleFraction(1, hasGap, gapWidth);
    const visibleFill = G.visibleFraction(p, hasGap, gapWidth);
    const endpoint = G.lastVisibleProgress(p, hasGap, gapWidth);

    const heartbeatSteps = Math.min(phase.steps, Math.max(1, Math.round(HEARTBEAT * FRAMES_PER_SECOND)));
    const travelSteps = Math.max(1, phase.steps - heartbeatSteps);
    const head = endpoint * Math.min(1, phase.step / travelSteps);
    const isHeartbeat = phase.step >= travelSteps;
    let hb = 0;
    if (isHeartbeat)
        hb = heartbeatSteps <= 1 ? 0 : (phase.step - travelSteps) / (heartbeatSteps - 1);
    hb = Math.min(1, Math.max(0, hb));
    const pulse = hb === 0 || hb === 1 ? 0 : Math.sin(Math.PI * hb);
    const multiplier = Math.min(BOOST, phase.multiplier);
    const headVisible = Math.abs(G.lastVisibleProgress(head, hasGap, gapWidth) - head) < 1e-9;

    const gapStart = hasGap ? G.lastVisibleProgress(0.5, true, gapWidth) : 0;
    const gapEnd = hasGap ? 1 - gapStart : 0;
    let boltScale = 1, boltArcColorAmount = 0;
    if (hasGap && endpoint >= gapEnd && head > gapStart && head < gapEnd) {
        const bp = Math.sin(Math.PI * Math.min(1, Math.max(0, (head - gapStart) / (gapEnd - gapStart))));
        boltScale = 1 + 0.2 * bp;
        boltArcColorAmount = bp;
    }

    const tailLength = Math.min(TAIL_RATIO * visibleArc, MAX_TAIL_TO_FILL * visibleFill);
    let tail = null;
    if (visibleFill >= MIN_VISIBLE_FILL * visibleArc && head > 0 && tailLength > 0 &&
        (!hasGap || head <= gapStart || head >= gapEnd)) {
        const visibleHead = G.visibleFraction(head, hasGap, gapWidth);
        const tailStart = G.progressForVisibleFraction(Math.max(0, visibleHead - tailLength), hasGap, gapWidth);
        const tailEnd = G.progressForVisibleFraction(visibleHead, hasGap, gapWidth);
        const sideStart = hasGap && head >= gapEnd ? Math.max(tailStart, gapEnd) : tailStart;
        if (tailEnd > sideStart)
            tail = [sideStart, tailEnd];
    }
    return {
        tail,
        head,
        headVisible,
        tailAlpha: tail ? 1 : 0,
        beadAlpha: headVisible ? (isHeartbeat ? Math.max(0, 1 - hb) : 1) : 0,
        heartbeatAlpha: pulse * multiplier,
        heartbeatScale: isHeartbeat ? (1 + 0.55 * (1 - pulse)) * multiplier : 1,
        boltScale,
        boltArcColorAmount,
    };
}

// --- Palette (ChargingEffectPalette) ----------------------------------------

const lin = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a, b) => {
    const [la, lb] = [luminance(a), luminance(b)];
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function contrastingMix(base, dest) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 32; i++) {
        const mid = (lo + hi) / 2;
        if (contrast(base, mix(base, dest, mid)) >= 1.8)
            hi = mid;
        else
            lo = mid;
    }
    return mix(base, dest, hi);
}

/** rgb arrays are 0…1. */
export function automaticHighlight(fill) {
    const white = [1, 1, 1], black = [0, 0, 0];
    if (contrast(fill, white) >= 1.8)
        return contrastingMix(fill, white);
    if (contrast(fill, black) >= 1.8)
        return contrastingMix(fill, black);
    return contrastingMix(fill, contrast(fill, white) >= contrast(fill, black) ? white : black);
}

export function boltHighlight(fill, highlight) {
    return luminance(highlight) > luminance(fill) ? highlight : mix(fill, [1, 1, 1], 0.35);
}

export {mix as blendRGB};

// --- Drawing ----------------------------------------------------------------

export function drawEffect(cr, frame, highlight, lineWidth, hasGap, gapWidth) {
    const [r, g, b] = highlight;
    if (frame.tail) {
        const [t0, t1] = frame.tail;
        const [x0, y0] = G.batteryPoint(t0);
        const [x1, y1] = G.batteryPoint(t1);
        const gradient = new Cairo.LinearGradient(x0, y0, x1, y1);
        gradient.addColorStopRGBA(0, r, g, b, 0);
        gradient.addColorStopRGBA(0.82, r, g, b, Math.min(1, frame.tailAlpha));
        gradient.addColorStopRGBA(1, r, g, b, 0);
        cr.save();
        cr.setLineWidth(lineWidth);
        cr.setLineCap(Cairo.LineCap.ROUND);
        for (const [a0, a1] of G.batteryArcSegments(t0, t1, hasGap, gapWidth)) {
            cr.newSubPath();
            cr.arc(G.ARTWORK_CENTER_X, G.BATTERY_CENTER_Y, G.BATTERY_RADIUS, a0, a1);
        }
        cr.setSource(gradient);
        cr.stroke();
        cr.restore();
    }
    const [hx, hy] = G.batteryPoint(frame.head);
    if (frame.headVisible && frame.beadAlpha > 0) {
        cr.setSourceRGBA(r, g, b, Math.min(1, frame.beadAlpha));
        cr.newSubPath();
        cr.arc(hx, hy, lineWidth * 0.5 * 1.18, 0, 2 * Math.PI);
        cr.fill();
    }
    if (frame.headVisible && frame.heartbeatAlpha > 0) {
        cr.setSourceRGBA(r, g, b, Math.min(1, frame.heartbeatAlpha));
        cr.newSubPath();
        cr.arc(hx, hy, lineWidth * 0.95 * frame.heartbeatScale, 0, 2 * Math.PI);
        cr.fill();
    }
}
