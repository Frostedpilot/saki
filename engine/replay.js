// replay.js — deterministic action journal + verifier (Fix plan Phase 5).
// Records { initialSeed, kyokuSeeds, actions } per match; replays the
// deal/draw/discard sequence through core.js to verify every logged draw
// was live and conservation holds at every step.
//
// NOTE: experimental, tests-only — no production writer calls
// createJournal/record yet, and 'call'/meld actions are skipped by the
// verifier (tile flow only, not hidden bot intent).
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

// Replays one kyoku: rebuilds the pool from the kyoku seed, then checks
// each logged draw was still live and each discard came from the hand.
// Throws on the first mismatch; returns { draws, discards } on success.
function verifyKyoku(kyokuSeed, actions) {
  const state = core.createMatchState({ seed: kyokuSeed });
  core.setupDeadWall(state);
  assertDeadWall(state.deadWall);
  core.dealHands(state);
  const hands = state.players.map((p) => [...p.hand]);
  const rivers = state.players.map(() => []);
  let draws = 0,
    discards = 0;
  for (const [type, seat, payload] of actions) {
    if (type === 'kyoku') continue;
    if (type === 'call') continue; // meld/kan bookkeeping: no tile-flow assertion yet
    if (type === 'draw') {
      if (!state.pool.get(payload)) throw new Error(`replay: draw ${payload} not live (seat ${seat})`);
      state.pool.decrement(payload);
      hands[seat].push(payload);
      draws++;
    } else if (type === 'discard') {
      const i = hands[seat].indexOf(payload);
      if (i < 0) throw new Error(`replay: discard ${payload} not in hand (seat ${seat})`);
      hands[seat].splice(i, 1);
      rivers[seat].push(payload);
      discards++;
    }
    const parts = [...hands.map((h) => [...h]), ...rivers.map((r) => [...r]), state.deadWall];
    const problems = state.pool.audit(parts);
    if (problems.length) throw new Error(`replay: conservation broke after ${type} ${payload}: ${problems.join('; ')}`);
  }
  return { draws, discards };
}

function verifyJournal(journal) {
  if (!journal || !Array.isArray(journal.kyokuSeeds) || !Array.isArray(journal.actions)) {
    throw new Error('replay.verifyJournal: invalid journal (missing kyokuSeeds/actions)');
  }
  let kyoku = -1;
  let total = { draws: 0, discards: 0 };
  let current = [];
  const flush = () => {
    if (current.length || kyoku >= 0) {
      const r = verifyKyoku(journal.kyokuSeeds[kyoku], current);
      total.draws += r.draws;
      total.discards += r.discards;
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
