// flowManager.js — Flow Gauge Economy (Spec §6).
// Tiers: 25% Tactical / 50% Steerer / 100% Signature / 150% Overdrive.
// All players start at 0%. Caps: [0, 150].
//
// Power types (Spec §6.1): every seat is in FLOW mode by default, or NORMAL
// mode. Normal-type powers live outside the Flow economy entirely: their gauge
// is pinned at 0, all flow ops (income/spend/consume/tier) are no-ops, and
// clients render them as passive pills instead of a meter.
const MIN = 0, MAX = 150;
const BASE_PER_DISCARD = 1.5;
const MODE_FLOW = 'flow';
const MODE_NORMAL = 'normal';

class FlowManager {
  constructor(nSeats = 4) {
    this.gauges = Array(nSeats).fill(0);
    this.modes = Array(nSeats).fill(MODE_FLOW);
  }
  // Out-of-range seats (e.g. a 4-player hook draining opponents on a 2-seat
  // table) are no-ops — never write NaN into an undefined gauge.
  inRange(seat) { return Number.isInteger(seat) && seat >= 0 && seat < this.gauges.length; }
  setMode(seat, mode) {
    if (!this.inRange(seat)) return;
    this.modes[seat] = mode === MODE_NORMAL ? MODE_NORMAL : MODE_FLOW;
    if (this.modes[seat] === MODE_NORMAL) this.gauges[seat] = 0;
  }
  isNormal(seat) { return this.inRange(seat) && this.modes[seat] === MODE_NORMAL; }
  get(seat) { return this.inRange(seat) ? this.gauges[seat] : 0; }
  set(seat, v) {
    if (!this.inRange(seat) || this.isNormal(seat)) return;
    this.gauges[seat] = Math.min(MAX, Math.max(MIN, v));
  }
  addFlow(seat, amt) { if (!this.isNormal(seat)) this.set(seat, this.get(seat) + amt); }
  drainFlow(seat, amt) { if (!this.isNormal(seat)) this.set(seat, this.get(seat) - amt); }
  consume(seat, amt) { this.drainFlow(seat, amt); }
  consumeAll(seat) { if (!this.isNormal(seat)) this.set(seat, 0); }
  // base income for a legal discard
  onLegalDiscard(seat) { if (!this.isNormal(seat)) this.addFlow(seat, BASE_PER_DISCARD); }
  tier(seat) {
    const v = this.gauges[seat];
    if (v >= 150) return 4;
    if (v >= 100) return 3;
    if (v >= 50) return 2;
    if (v >= 25) return 1;
    return 0;
  }
  canAfford(seat, cost) { return this.gauges[seat] >= cost; }
}

module.exports = { FlowManager, FLOW_MIN: MIN, FLOW_MAX: MAX, BASE_PER_DISCARD, MODE_FLOW, MODE_NORMAL };
