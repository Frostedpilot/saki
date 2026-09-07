// flowManager.js — Flow Gauge Economy (Spec §6).
// Tiers: 25% Tactical / 50% Steerer / 100% Signature / 150% Overdrive.
// All players start at 0%. Caps: [0, 150].
const MIN = 0, MAX = 150;
const BASE_PER_DISCARD = 1.5;

class FlowManager {
  constructor(nSeats = 4) {
    this.gauges = Array(nSeats).fill(0);
  }
  // Out-of-range seats (e.g. a 4-player hook draining opponents on a 2-seat
  // table) are no-ops — never write NaN into an undefined gauge.
  inRange(seat) { return Number.isInteger(seat) && seat >= 0 && seat < this.gauges.length; }
  get(seat) { return this.inRange(seat) ? this.gauges[seat] : 0; }
  set(seat, v) {
    if (!this.inRange(seat)) return;
    this.gauges[seat] = Math.min(MAX, Math.max(MIN, v));
  }
  addFlow(seat, amt) { this.set(seat, this.get(seat) + amt); }
  drainFlow(seat, amt) { this.set(seat, this.get(seat) - amt); }
  consume(seat, amt) { this.drainFlow(seat, amt); }
  consumeAll(seat) { this.set(seat, 0); }
  // base income for a legal discard
  onLegalDiscard(seat) { this.addFlow(seat, BASE_PER_DISCARD); }
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

module.exports = { FlowManager, FLOW_MIN: MIN, FLOW_MAX: MAX, BASE_PER_DISCARD };
