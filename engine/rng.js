// Deterministic seeded RNG (mulberry32 + xoshiro256**-style API).
// Spec §1.5: given seed + inputs, every draw is reproducible.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class RNG {
  constructor(seed = 0x5A41) {
    this.seed = seed >>> 0;
    this.fn = mulberry32(this.seed);
    this.calls = 0;
  }
  next() { this.calls++; return this.fn(); }
  int(n) { return Math.floor(this.next() * n); }
  fork(salt = 0) { return new RNG((this.seed ^ (salt * 0x9E3779B1)) >>> 0); }
}

function createRNG(seed) {
  if (seed === undefined || seed === null) return { next: Math.random, int: n => Math.floor(Math.random() * n), fork: () => createRNG() };
  const r = new RNG(typeof seed === 'number' ? seed : Number(seed) || 0);
  return r;
}

module.exports = { RNG, createRNG };
