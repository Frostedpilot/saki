// Tile constants + helpers shared by the engine.
// Spec §2.1: T = 34 normalized kinds, 136 tiles total (aka as separate kinds).
const SUITS = ['m', 'p', 's'];
const KINDS = [];
for (const s of SUITS) for (let n = 1; n <= 9; n++) KINDS.push(n + s);
for (let n = 1; n <= 7; n++) KINDS.push(n + 'z');
// Physical pool kinds: 34 normalized + aka variants (0m/0p/0s replace one 5x).
// Counts: 5m:3 + 0m:1, 5p:3 + 0p:1, 5s:3 + 0s:1, everything else 4.
const AKA = ['0m', '0p', '0s'];
const POOL_KINDS = [...KINDS.filter((k) => !['5m', '5p', '5s'].includes(k)), '5m', '5p', '5s', ...AKA];

const akaToFive = (t) => (t[0] === '0' ? '5' + t[1] : t);
const norm = akaToFive;
const same = (a, b) => norm(a) === norm(b);

function fullCounts() {
  const c = {};
  for (const k of KINDS) c[k] = 4;
  // carve out aka: one of each 5m/5p/5s becomes 0m/0p/0s
  c['5m'] = 3;
  c['5p'] = 3;
  c['5s'] = 3;
  c['0m'] = 1;
  c['0p'] = 1;
  c['0s'] = 1;
  return c;
}

function toCounts(hand) {
  const c = [Array(9).fill(0), Array(9).fill(0), Array(9).fill(0), Array(7).fill(0)];
  for (const t of hand) {
    const n = t[0] === '0' ? 5 : parseInt(t[0], 10);
    if (t[1] === 'm') c[0][n - 1]++;
    else if (t[1] === 'p') c[1][n - 1]++;
    else if (t[1] === 's') c[2][n - 1]++;
    else c[3][n - 1]++;
  }
  return c;
}

function toHandStr(hand) {
  const g = { m: [], p: [], s: [], z: [] };
  for (const t of hand) g[t[1]].push(t[0]);
  return ['m', 'p', 's', 'z']
    .filter((s) => g[s].length)
    .map((s) => g[s].sort().join('') + s)
    .join('');
}

const DORA_NEXT = (t) => {
  t = norm(t);
  const n = parseInt(t[0], 10),
    s = t[1];
  // Winds cycle 1z->2z->3z->4z->1z; dragons cycle 5z->6z->7z->5z.
  // (A naive (n+1) would map North 4z to Haku 5z.)
  if (s === 'z') {
    if (n === 4) return '1z';
    if (n === 7) return '5z';
    return n + 1 + 'z';
  }
  return n === 9 ? '1' + s : n + 1 + s;
};

function isSimple(t) {
  const k = norm(t);
  return k[1] !== 'z' && k[0] >= '2' && k[0] <= '8';
}
function isTerminalOrHonor(t) {
  const k = norm(t);
  return k[1] === 'z' || k[0] === '1' || k[0] === '9';
}

module.exports = {
  KINDS,
  POOL_KINDS,
  AKA,
  akaToFive,
  norm,
  same,
  fullCounts,
  toCounts,
  toHandStr,
  DORA_NEXT,
  isSimple,
  isTerminalOrHonor,
};
