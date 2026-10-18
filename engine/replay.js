// replay.js — deterministic action journal + verifier (Fix plan Phase 5).
// Records { initialSeed, kyokuSeeds, actions } per match; replays the
// deal/draw/discard/call sequence through core.js to verify every logged draw
// was live, every meld could have been built from the tiles it claims, and
// conservation holds at every step.
//
// NOTE: experimental, tests-only — no production writer calls
// createJournal/record yet. Journal action grammar (see `record`):
//   ['kyoku',   index, kyokuSeed]
//   ['draw',    seat, tile]            — a live-wall draw
//   ['rinshan', seat, tile]            — a replacement draw, taken from the wanpai
//   ['discard', seat, tile]
//   ['call',    seat, { kind, tiles, from, called }]
// `kind` is chi|pon|daiminkan (open: `from` owns the river, `called` is their
// last discard, `tiles` includes it) or ankan|kakan (from own hand; `tiles` is
// the 4-tile meld, and a kakan upgrades an existing pon of `tiles[0]`).
// Tiles are exact strings, so a journal that spells an aka as '5m' verifies
// against a '5m', not the red '0m'.
const core = require('./core');
const { assertDeadWall } = require('./invariants');

function createJournal(initialSeed) {
  return { initialSeed, kyokuSeeds: [], actions: [] };
}

function startKyoku(journal, kyokuSeed) {
  journal.kyokuSeeds.push(kyokuSeed);
  journal.actions.push(['kyoku', journal.kyokuSeeds.length - 1, kyokuSeed]);
}

function record(journal, seat, type, payload) {
  journal.actions.push([type, seat, payload === undefined ? null : payload]);
}

function toJSON(journal) {
  return JSON.stringify(journal);
}
function fromJSON(str) {
  const j = JSON.parse(str);
  if (typeof j.initialSeed !== 'number' || !Array.isArray(j.actions)) {
    throw new Error('replay.fromJSON: invalid journal');
  }
  // A journal without per-kyoku seeds replays via createRNG(undefined),
  // which is a nondeterministic Math.random wrapper — it "verifies" nothing.
  // Require the seeds array up front instead of failing deep in verifyJournal.
  if (!Array.isArray(j.kyokuSeeds)) {
    throw new Error('replay.fromJSON: missing kyokuSeeds (cannot deterministically verify)');
  }
  return j;
}

// Applies one call to the reconstructed table. Open calls take their tile from
// the discarder's river; ankan takes all four from hand; kakan promotes an
// existing pon. Throws on the first thing that could not have happened.
function applyCall(payload, seat, hands, rivers, melds) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.tiles)) {
    throw new Error(`replay: malformed call for seat ${seat}`);
  }
  const { kind, tiles, from, called } = payload;
  const takeFromHand = (tile) => {
    const i = hands[seat].indexOf(tile);
    if (i < 0) throw new Error(`replay: call tile ${tile} not in hand (seat ${seat})`);
    hands[seat].splice(i, 1);
  };

  if (kind === 'ankan') {
    if (tiles.length !== 4) throw new Error(`replay: ankan needs 4 tiles (seat ${seat})`);
    for (const t of tiles) takeFromHand(t);
    melds[seat].push([...tiles]);
    return;
  }
  if (kind === 'kakan') {
    if (tiles.length !== 4) throw new Error(`replay: kakan needs 4 tiles (seat ${seat})`);
    const pon = melds[seat].find((m) => m.length === 3 && m.every((t) => t === tiles[0]));
    if (!pon) throw new Error(`replay: kakan ${tiles[0]} with no pon meld (seat ${seat})`);
    takeFromHand(tiles[3]);
    pon.push(tiles[3]);
    return;
  }
  if (kind !== 'chi' && kind !== 'pon' && kind !== 'daiminkan') {
    throw new Error(`replay: unknown call kind ${kind} (seat ${seat})`);
  }
  if (from === undefined || from === null) {
    throw new Error(`replay: open ${kind} without a discarder (seat ${seat})`);
  }
  const river = rivers[from];
  if (river.length === 0 || river[river.length - 1] !== called) {
    throw new Error(`replay: called tile ${called} is not seat ${from}'s last discard`);
  }
  river.pop();
  const handTiles = [...tiles];
  const ci = handTiles.indexOf(called);
  if (ci < 0) throw new Error(`replay: called tile ${called} not among the meld tiles (seat ${seat})`);
  handTiles.splice(ci, 1);
  for (const t of handTiles) takeFromHand(t);
  melds[seat].push([...tiles]);
}

// Replays one kyoku: rebuilds the pool from the kyoku seed, then checks each
// logged draw was still live, each discard came from the hand, and each call
// could have been assembled from the river and the hand. Throws on the first
// mismatch; returns { draws, discards, calls } on success.
function verifyKyoku(kyokuSeed, actions) {
  const state = core.createMatchState({ seed: kyokuSeed });
  core.setupDeadWall(state);
  assertDeadWall(state.deadWall);
  core.dealHands(state);
  const hands = state.players.map((p) => [...p.hand]);
  const rivers = state.players.map(() => []);
  const melds = state.players.map(() => []);
  let draws = 0,
    discards = 0,
    calls = 0;
  for (const [type, seat, payload] of actions) {
    if (type === 'kyoku') continue;
    if (type === 'draw') {
      if (!state.pool.get(payload)) throw new Error(`replay: draw ${payload} not live (seat ${seat})`);
      state.pool.decrement(payload);
      hands[seat].push(payload);
      draws++;
    } else if (type === 'rinshan') {
      const i = state.deadWall.indexOf(payload);
      if (i < 0) throw new Error(`replay: rinshan ${payload} not in the dead wall (seat ${seat})`);
      state.deadWall.splice(i, 1);
      hands[seat].push(payload);
      draws++;
    } else if (type === 'discard') {
      const i = hands[seat].indexOf(payload);
      if (i < 0) throw new Error(`replay: discard ${payload} not in hand (seat ${seat})`);
      hands[seat].splice(i, 1);
      rivers[seat].push(payload);
      discards++;
    } else if (type === 'call') {
      applyCall(payload, seat, hands, rivers, melds);
      calls++;
    }
    const parts = [
      ...hands.map((h) => [...h]),
      ...melds.map((m) => m.flat()),
      ...rivers.map((r) => [...r]),
      state.deadWall,
    ];
    const problems = state.pool.audit(parts);
    if (problems.length) {
      throw new Error(`replay: conservation broke after ${type} (seat ${seat}): ${problems.join('; ')}`);
    }
  }
  return { draws, discards, calls };
}

function verifyJournal(journal) {
  if (!journal || !Array.isArray(journal.kyokuSeeds) || !Array.isArray(journal.actions)) {
    throw new Error('replay.verifyJournal: invalid journal (missing kyokuSeeds/actions)');
  }
  let kyoku = -1;
  let total = { draws: 0, discards: 0, calls: 0 };
  let current = [];
  const flush = () => {
    if (current.length || kyoku >= 0) {
      const r = verifyKyoku(journal.kyokuSeeds[kyoku], current);
      total.draws += r.draws;
      total.discards += r.discards;
      total.calls += r.calls;
      current = [];
    }
  };
  for (const a of journal.actions) {
    if (a[0] === 'kyoku') {
      flush();
      kyoku = a[1];
      continue;
    }
    current.push(a);
  }
  flush();
  return total;
}

module.exports = { createJournal, startKyoku, record, toJSON, fromJSON, verifyKyoku, verifyJournal };
