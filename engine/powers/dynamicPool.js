// dynamicPool.js — Schrödinger's Wall (Spec §1.1, §2).
// The live wall is never a pre-shuffled static array. The engine keeps a
// finite inventory of unrevealed tiles (remainingPool) and samples draws
// on demand: P(t) = pool[t]*W(t) / sum(pool[k]*W(k)).
// Conservation: pool[t] == 0 => P(t) == 0 unconditionally.
const { KINDS, fullCounts, norm } = require('../tiles');
const { createRNG } = require('../rng');

class DynamicPool {
  constructor(counts, rng) {
    this.counts = { ...counts };
    this.rng = rng || createRNG();
    // slot reservations: name -> tile (tile already decremented from counts)
    this.slots = {};
  }

  static full(rng) { return new DynamicPool(fullCounts(), rng || createRNG()); }

  // Legacy interop: build pool from an existing wall array (136 - dealt).
  static fromWallArray(wallArray, rng) {
    const counts = {};
    for (const t of wallArray) { const k = t; counts[k] = (counts[k] || 0) + 1; }
    return new DynamicPool(counts, rng || createRNG());
  }

  total() { return Object.values(this.counts).reduce((a, b) => a + b, 0); }
  get(tile) { return this.counts[tile] || 0; }

  decrement(tile) {
    if (!this.counts[tile]) throw new Error(`DynamicPool: tile ${tile} exhausted (conservation violation)`);
    this.counts[tile]--;
    if (this.counts[tile] === 0) delete this.counts[tile];
  }

  // Remove one copy for visibility elsewhere (dealt hand, meld, discard, wanpai).
  // Same as decrement but named for lifecycle clarity.
  reveal(tile) { this.decrement(tile); }

  // Primitive: Slot Reserver — bind a tile to a named slot (rinshan, haitei...).
  // Returns true on success, false if tile unavailable (caller must fallback).
  reserveSlot(tile, slotName) {
    if (!this.get(tile)) return false;
    this.decrement(tile);
    this.slots[slotName] = tile;
    return true;
  }

  takeSlot(slotName) {
    const t = this.slots[slotName];
    if (t === undefined) return null;
    delete this.slots[slotName];
    return t;
  }

  // Weighted sample. weights: {kind: multiplier} or (tile)=>multiplier.
  // Only tiles with pool count > 0 can be drawn. Deterministic given rng.
  sample(weights) {
    const wfn = typeof weights === 'function' ? weights : (t => (weights && weights[t] !== undefined ? weights[t] : 1.0));
    let total = 0;
    const entries = [];
    for (const k of Object.keys(this.counts)) {
      const n = this.counts[k];
      if (n <= 0) continue;
      let w = wfn(k);
      if (!(w > 0)) continue; // W == 0 => excluded (e.g. Nodoka filter)
      const mass = n * w;
      total += mass;
      entries.push([k, mass]);
    }
    if (!entries.length || total <= 0) return null;
    let r = this.rng.next() * total;
    for (const [k, mass] of entries) {
      r -= mass;
      if (r <= 0) { this.decrement(k); return k; }
    }
    // float fallback: last entry
    const last = entries[entries.length - 1][0];
    this.decrement(last);
    return last;
  }

  // Conservation audit: dealt + melds + discards + dead + live must equal full counts.
  audit(partitions) {
    const full = fullCounts();
    const seen = {};
    const add = t => { seen[t] = (seen[t] || 0) + 1; };
    for (const arr of partitions) for (const t of arr) add(t);
    for (const [k, n] of Object.entries(this.counts)) seen[k] = (seen[k] || 0) + n;
    for (const t of Object.values(this.slots)) add(t);
    const problems = [];
    for (const k of Object.keys(full)) {
      if ((seen[k] || 0) !== full[k]) problems.push(`${k}: seen ${seen[k] || 0} != full ${full[k]}`);
    }
    for (const k of Object.keys(seen)) {
      if (full[k] === undefined) problems.push(`${k}: unknown tile (seen ${seen[k]})`);
    }
    return problems;
  }
}

module.exports = { DynamicPool };
