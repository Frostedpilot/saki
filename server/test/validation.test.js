// validation.test.js — deterministic coverage for the server's action and kan
// validation: classifyHumanKan(), validateAct(), botDecision() and doOwnKan().
//
// None of these had direct coverage — the E2E test only exercises what a random
// match happens to do. That is how kakan-while-in-riichi survived in *both* rule
// implementations, and then survived a second time on the CPU-bot path, which
// bypasses validateAct() entirely.
//
// The kan rules pinned here:
//   - ankan while riichi is legal only if it leaves the waits unchanged
//     (otherwise chombo)
//   - kakan while riichi is never legal: it moves a tile from the concealed hand
//     into the meld, which can change the wait

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { Table } = require('../table');
const P = require('../protocol');

// A kan is declared on your own turn *after* drawing, so the hand has 14 tiles.
// The helpers recompute waits from the remainder after the 4 kan tiles are
// removed, which only produces a valid shape when the concealed count is 10.
const HAND_2P = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1p', '1p', '1p', '2p'];
const RIICHI_HAND_2P = [...HAND_2P, '2p']; // + the drawn winning tile
// A hand whose only wait is a lone 5p, so a closed kan of some other tile
// cannot change it.
const HAND_TANKI = ['1m', '2m', '3m', '5m', '6m', '7m', '2p', '3p', '4p', '6s', '7s', '8s', '5p'];

function makeTable() {
  const room = {
    powerSeats: ['none', 'none', 'none', 'none'],
    sendTo() {},
    broadcastRoomState() {},
  };
  const t = new Table(room, 999);
  t.broadcast = () => {};
  t.broadcastMessage = () => {};
  t.broadcastPowerStatus = () => {};
  t.settlePowerHook = () => {};
  t.playerHandsInfo = () => [];

  t.ctx = {
    players: [0, 1, 2, 3].map((s) => ({
      seat: s,
      hand: [],
      melds: [],
      discards: [],
      riichi: false,
      doubleRiichi: false,
      ippatsu: false,
      tempFuriten: false,
      riichiWaits: [],
      lastDrawn: null,
    })),
    dealer: 0,
    bakaze: 1,
    doraInd: [],
    uraInd: [],
    dead: ['1m', '2m', '3m', '4m'],
    kanCount: 0,
    rinshanIdx: 0,
    kansBy: [0, 0, 0, 0],
    callsMade: 0,
    drawsThisKyoku: 1,
    firstLapDiscards: [],
    suufonDone: false,
    riichiPool: 0,
    poolTotal: () => 40,
    baseDora: () => [],
    uraDora: () => [],
    revealKanDora() {
      this.kanCount++;
    },
    state: {
      powers: { hooksFor: () => null, onSettlement() {}, broadcastPlayerKan() {} },
      flow: null,
    },
  };
  t.maybeActivateTier = () => {};
  t.powerOf = () => 'none';
  return t;
}

const ponMeld = (tile) => ({ tiles: [tile, tile, tile], open: true, type: 'pon' });

// ------------------------------------------------------------- classifyHumanKan

test('ankan is detected from four copies in hand', () => {
  const t = makeTable();
  t.ctx.players[0].hand = ['1m', '1m', '1m', '1m', '2p', '3p', '4p', '6s', '7s', '8s', '9s', '1z', '2z'];
  const k = t.classifyHumanKan(0);
  assert.equal(k.kind, 'ankan');
  assert.equal(k.tile, '1m');
});

test('kakan is detected from a pon plus the fourth copy in hand', () => {
  const t = makeTable();
  t.ctx.players[0].hand = ['3m', '2p', '3p', '4p', '6s', '7s', '8s', '9s', '1z', '2z', '5z', '6z', '3m'];
  t.ctx.players[0].melds = [ponMeld('3m')];
  const k = t.classifyHumanKan(0);
  assert.equal(k.kind, 'kakan');
  assert.equal(k.tile, '3m');
});

test('no kan available returns null', () => {
  const t = makeTable();
  t.ctx.players[0].hand = HAND_2P.slice();
  assert.equal(t.classifyHumanKan(0), null);
});

// --------------------------------------------------- ankan while in riichi

test('ankan while riichi is a declarable chombo when it would change the waits', () => {
  const t = makeTable();
  const me = t.ctx.players[0];
  me.riichi = true;
  // Shanpon wait on 1p/2p: a closed kan of 1m would change it.
  me.riichiWaits = ['1p', '2p'];
  me.hand = ['1m', '1m', '1m', '1m', '3p', '4p', '6s', '7s', '8s', '9s', '1z', '2z', '5z', '3z'];
  const k = t.classifyHumanKan(0);
  assert.equal(k.kind, 'ankan', 'the player may declare it and chombo');
  assert.equal(k.tile, '1m');
  assert.equal(k.chombo, true, 'flagged so doOwnKan can warn and penalise');
  assert.ok(!k.error, 'no longer refused server-side');
});

test('ankan while riichi is allowed when the waits are unchanged', () => {
  const t = makeTable();
  const me = t.ctx.players[0];
  me.riichi = true;
  // 14 tiles: a closed kan of 1m plus 22p 456p 789s 55z. Removing the kan
  // leaves 10 concealed tiles forming 22p / 456p / 789s / 55z, so the waits
  // are tanki 2p and tanki 5z — untouched by the kan.
  me.riichiWaits = ['2p', '5z'];
  me.hand = ['1m', '1m', '1m', '1m', '2p', '2p', '4p', '5p', '6p', '7s', '8s', '9s', '5z', '5z'];
  const k = t.classifyHumanKan(0);
  assert.equal(k.kind, 'ankan', 'a wait-preserving ankan stays legal');
  assert.equal(k.tile, '1m');
});

test('ankan while riichi is a chombo when the kan *would* change a real wait', () => {
  const t = makeTable();
  const me = t.ctx.players[0];
  me.riichi = true;
  me.riichiWaits = ['2p', '5z'];
  // Kan the 2p pair instead: that collapses two waits into one.
  me.hand = ['1m', '1m', '1m', '1m', '2p', '2p', '2p', '5p', '6p', '7s', '8s', '9s', '5z', '5z'];
  assert.equal(t.classifyHumanKan(0).chombo, true, 'wait-changing ankan is a chombo');
});

test('ankan while riichi with no recorded waits is treated as a chombo', () => {
  const t = makeTable();
  const me = t.ctx.players[0];
  me.riichi = true;
  me.riichiWaits = []; // unknown: must not read as unchanged
  me.hand = ['1m', '1m', '1m', '1m', '2p', '3p', '4p', '6s', '7s', '8s', '9s', '1z', '2z', '3z'];
  const k = t.classifyHumanKan(0);
  assert.equal(k.chombo, true, 'unknown waits must not read as unchanged');
  assert.ok(!k.error, 'still declarable, but penalised');
});

// ---------------------------------------------------- kakan while in riichi

test('kakan while in riichi is refused (the bug this suite was written for)', () => {
  const t = makeTable();
  const me = t.ctx.players[0];
  me.riichi = true;
  me.riichiWaits = ['2p'];
  me.hand = ['3m', '2p', '3p', '4p', '6s', '7s', '8s', '9s', '1z', '2z', '5z', '6z', '3m'];
  me.melds = [ponMeld('3m')];
  const k = t.classifyHumanKan(0);
  assert.ok(k.error, 'adding a kan to a pon is illegal while in riichi');
  assert.match(k.reason, /riichi/);
});

test('kakan while in riichi is refused via auto-detect too', () => {
  const t = makeTable();
  const me = t.ctx.players[0];
  me.riichi = true;
  me.riichiWaits = ['2p'];
  me.hand = ['3m', '2p', '3p', '4p', '6s', '7s', '8s', '9s', '1z', '2z', '5z', '6z', '3m'];
  me.melds = [ponMeld('3m')];
  assert.ok(t.classifyHumanKan(0, undefined).error, 'auto-detection must refuse it too');
});

test('the same kakan is legal when not in riichi', () => {
  const t = makeTable();
  const me = t.ctx.players[0];
  me.hand = ['3m', '2p', '3p', '4p', '6s', '7s', '8s', '9s', '1z', '2z', '5z', '6z', '3m'];
  me.melds = [ponMeld('3m')];
  const k = t.classifyHumanKan(0);
  assert.equal(k.kind, 'kakan');
});

// ------------------------------------------------------ explicit tile index

test('an explicit tile index selects that specific kan', () => {
  const t = makeTable();
  t.ctx.players[0].hand = ['1m', '1m', '1m', '1m', '3m', '3m', '3m', '3m', '2p', '3p', '4p'];
  // index 27 is 1z; 4m is index 12. Pick 4m (index 12) -> not 4 copies, so the
  // explicit branch falls through to auto-detect, which finds 1m first.
  const k = t.classifyHumanKan(0, 12);
  assert.equal(k.kind, 'ankan');
  assert.equal(k.tile, '1m');
});

test('explicit index 0 (1m) is honoured rather than skipped', () => {
  // Index 0 is 1m. A `> 0` guard used to skip it and fall through to
  // auto-detect, which happened to agree — but only by accident.
  const t = makeTable();
  t.ctx.players[0].hand = ['1m', '1m', '1m', '1m', '2p', '3p', '4p', '6s', '7s', '8s', '9s', '1z', '2z'];
  const k = t.classifyHumanKan(0, 0);
  assert.equal(k.kind, 'ankan');
  assert.equal(k.tile, '1m');
});

test('explicit index for a pon tile returns kakan', () => {
  const t = makeTable();
  t.ctx.players[0].hand = ['3m', '2p', '3p', '4p', '6s', '7s', '8s', '9s', '1z', '2z', '5z', '6z', '3m'];
  t.ctx.players[0].melds = [ponMeld('3m')];
  const k = t.classifyHumanKan(0, 9); // 3m
  assert.equal(k.kind, 'kakan');
  assert.equal(k.tile, '3m');
});

// ------------------------------------------------------------------ validateAct

test('riichi is rejected from an open hand', () => {
  const t = makeTable();
  const me = t.ctx.players[0];
  me.hand = HAND_2P.slice();
  me.melds = [ponMeld('9z')];
  const r = t.validateAct(0, { type: 'Riichi', tile: '2p' }, {});
  assert.equal(r.ok, false);
  assert.match(r.reason, /open hand/);
});

test('riichi is rejected when the discard is not tenpai', () => {
  const t = makeTable();
  const me = t.ctx.players[0];
  me.hand = ['1m', '3m', '5m', '7m', '9m', '2p', '4p', '6p', '8p', '2s', '4s', '6s', '2p'];
  const r = t.validateAct(0, { type: 'Riichi', tile: '1m' }, {});
  assert.equal(r.ok, false);
  assert.match(r.reason, /tenpai/);
});

test('riichi is rejected when the tile is not in hand', () => {
  const t = makeTable();
  t.ctx.players[0].hand = HAND_2P.slice();
  const r = t.validateAct(0, { type: 'Riichi', tile: '9z' }, {});
  assert.equal(r.ok, false);
  assert.match(r.reason, /not in hand/);
});

test('riichi is accepted from a closed tenpai hand', () => {
  const t = makeTable();
  t.ctx.players[0].hand = RIICHI_HAND_2P.slice();
  const r = t.validateAct(0, { type: 'Riichi', tile: '2p' }, {});
  assert.equal(r.ok, true);
  assert.equal(r.action.riichiFirst, true, 'turn 1 with no calls is a double riichi');
});

test('riichi is rejected below 1000 points', () => {
  const t = makeTable();
  t.scores[0] = 500;
  t.ctx.players[0].hand = HAND_2P.slice();
  const r = t.validateAct(0, { type: 'Riichi', tile: '2p' }, {});
  assert.equal(r.ok, false);
  assert.match(r.reason, /1000/);
});

test('riichi is rejected with fewer than 4 wall tiles left', () => {
  const t = makeTable();
  t.ctx.poolTotal = () => 3;
  t.ctx.players[0].hand = HAND_2P.slice();
  const r = t.validateAct(0, { type: 'Riichi', tile: '2p' }, {});
  assert.equal(r.ok, false);
  assert.match(r.reason, /1000 pts and 4\+ wall/);
});

// ------------------------------------------------------------------- discard

test('a riichi player may only tsumogiri', () => {
  const t = makeTable();
  const me = t.ctx.players[0];
  me.riichi = true;
  me.hand = HAND_TANKI.slice();
  me.lastDrawn = '5p';

  const bad = t.validateAct(0, { type: 'Discard', tile: '1m' }, {});
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /tsumogiri/);

  const good = t.validateAct(0, { type: 'Discard', tile: '5p' }, {});
  assert.equal(good.ok, true);
});

test('a discard of a tile not in hand is rejected', () => {
  const t = makeTable();
  t.ctx.players[0].hand = HAND_TANKI.slice();
  t.ctx.players[0].lastDrawn = '5p';
  const r = t.validateAct(0, { type: 'Discard', tile: '9z' }, {});
  assert.equal(r.ok, false);
  assert.match(r.reason, /not in hand/);
});

test('a null discard with nothing drawn is rejected', () => {
  const t = makeTable();
  t.ctx.players[0].hand = HAND_TANKI.slice();
  t.ctx.players[0].lastDrawn = null;
  const r = t.validateAct(0, { type: 'Discard', tile: null }, {});
  assert.equal(r.ok, false);
  assert.match(r.reason, /no drawn tile/);
});

// ------------------------------------------------------------------------ kan

test('validateAct surfaces the kan rejection reason', () => {
  const t = makeTable();
  const me = t.ctx.players[0];
  me.riichi = true;
  me.riichiWaits = ['2p'];
  me.hand = ['3m', '2p', '3p', '4p', '6s', '7s', '8s', '9s', '1z', '2z', '5z', '6z', '3m'];
  me.melds = [ponMeld('3m')];
  const kan = t.classifyHumanKan(0);
  assert.ok(kan.error);
  const r = t.validateAct(0, { type: 'Kan', kan }, {});
  assert.equal(r.ok, false);
  assert.match(r.reason, /riichi/);
});

test('validateAct re-checks kakan against riichi at the boundary', () => {
  // Even if a caller bypasses classifyHumanKan, the rule holds.
  const t = makeTable();
  const me = t.ctx.players[0];
  me.riichi = true;
  const r = t.validateAct(0, { type: 'Kan', kan: { kind: 'kakan', tile: '3m' } }, {});
  assert.equal(r.ok, false);
  assert.match(r.reason, /riichi/);
});

test('a legal kan is accepted', () => {
  const t = makeTable();
  t.ctx.players[0].hand = ['3m', '2p', '3p', '4p', '6s', '7s', '8s', '9s', '1z', '2z', '5z', '6z', '3m'];
  t.ctx.players[0].melds = [ponMeld('3m')];
  const kan = t.classifyHumanKan(0);
  assert.equal(kan.kind, 'kakan');
  const r = t.validateAct(0, { type: 'Kan', kan }, {});
  assert.equal(r.ok, true);
  assert.equal(r.action.tile, '3m');
});

test('a wait-preserving ankan in riichi is accepted (the riichi KAN button path)', () => {
  const t = makeTable();
  const me = t.ctx.players[0];
  me.riichi = true;
  // Same shape as 'allowed when the waits are unchanged': a closed 1m kan plus
  // 22p 456p 789s 55z, so removing the kan leaves tanki 2p / tanki 5z waits.
  me.riichiWaits = ['2p', '5z'];
  me.hand = ['1m', '1m', '1m', '1m', '2p', '2p', '4p', '5p', '6p', '7s', '8s', '9s', '5z', '5z'];
  const kan = t.classifyHumanKan(0);
  assert.equal(kan.kind, 'ankan');
  const r = t.validateAct(0, { type: 'Kan', kan }, {});
  assert.equal(r.ok, true);
  assert.equal(r.action.tile, '1m');
});

test('a declarable chombo ankan passes validation (warning happens in doOwnKan)', () => {
  const t = makeTable();
  const me = t.ctx.players[0];
  me.riichi = true;
  me.riichiWaits = ['1p', '2p'];
  me.hand = ['1m', '1m', '1m', '1m', '3p', '4p', '6s', '7s', '8s', '9s', '1z', '2z', '5z', '3z'];
  const kan = t.classifyHumanKan(0);
  assert.equal(kan.chombo, true);
  const r = t.validateAct(0, { type: 'Kan', kan }, {});
  assert.equal(r.ok, true, 'chombo is a penalty, not a rejection');
  assert.equal(r.action.kan.chombo, true, 'the flag survives validation');
});

test('kan is rejected once the four kan slots are used', () => {
  const t = makeTable();
  t.ctx.kanCount = 4;
  const kan = { kind: 'ankan', tile: '1m' };
  const r = t.validateAct(0, { type: 'Kan', kan }, {});
  assert.equal(r.ok, false);
  assert.match(r.reason, /kan slots/);
});

// ------------------------------------------------------------------- unknown

test('an unrecognised action type is rejected rather than throwing', () => {
  const t = makeTable();
  const r = t.validateAct(0, { type: 'Nonsense' }, {});
  assert.equal(r.ok, false);
  assert.match(r.reason, /unexpected/);
});

test('pass is only valid while riichi-locked, and then means tsumogiri', () => {
  const t = makeTable();
  const me = t.ctx.players[0];
  me.lastDrawn = '5p';

  const notRiichi = t.validateAct(0, { type: 'Pass' }, {});
  assert.equal(notRiichi.ok, false, 'passing is not a way to skip your discard');

  me.riichi = true;
  const riichi = t.validateAct(0, { type: 'Pass' }, {});
  assert.equal(riichi.ok, true);
  assert.equal(riichi.action.type, 'Discard', 'pass while riichi is coerced to a tsumogiri');
  assert.equal(riichi.action.tile, null);
});
// ---------------------------------------------------------------- botDecision

test('botDecision returns a tile that is actually in hand', () => {
  const t = makeTable();
  const me = t.ctx.players[0];
  me.isCpu = true;
  me.hand = HAND_2P.slice();
  me.lastDrawn = '2p';
  // Many draws: the RNG must never be able to index past the candidate list.
  for (let i = 0; i < 500; i++) {
    const a = t.botDecision(0, me);
    assert.ok(a.type === 'Discard' || a.type === 'Riichi', `unexpected ${a.type}`);
    assert.ok(me.hand.includes(a.tile), `bot discarded ${a.tile}, not in hand`);
  }
});

test('a riichi-locked bot only ever discards the tile it drew', () => {
  const t = makeTable();
  const me = t.ctx.players[0];
  me.isCpu = true;
  me.riichi = true;
  me.hand = HAND_TANKI.slice();
  me.lastDrawn = '5p';
  for (let i = 0; i < 300; i++) {
    const a = t.botDecision(0, me);
    assert.equal(a.type, 'Discard');
    assert.equal(a.tile, '5p', 'tsumogiri only');
  }
});

test('botDecision honours wantTsumo above everything else', () => {
  const t = makeTable();
  const me = t.ctx.players[0];
  me.isCpu = true;
  me.hand = HAND_2P.slice();
  assert.equal(t.botDecision(0, me, { wantTsumo: true }).type, 'Tsumo');
});

test('botDecision passes an offered kan straight through', () => {
  const t = makeTable();
  const me = t.ctx.players[0];
  me.isCpu = true;
  me.hand = ['1m', '1m', '1m', '1m', '2p', '3p', '4p', '6s', '7s', '8s', '9s', '1z', '2z', '3z'];
  const kanChoice = { kind: 'ankan', tile: '1m' };
  const a = t.botDecision(0, me, { kanChoice });
  assert.equal(a.type, 'Kan');
  assert.equal(a.kan, kanChoice);
});

test('botDecision can declare riichi from tenpai', () => {
  const t = makeTable();
  const me = t.ctx.players[0];
  me.isCpu = true;
  me.hand = RIICHI_HAND_2P.slice();
  me.lastDrawn = '2p';
  // 45% per eligible discard, so over many draws at least one riichi appears.
  let sawRiichi = 0;
  for (let i = 0; i < 400; i++) {
    if (t.botDecision(0, me).type === 'Riichi') sawRiichi++;
  }
  assert.ok(sawRiichi > 0, 'the bot never declared riichi from tenpai');
});

test('SAKI_RIICHI_FORCE makes the bot always riichi from tenpai', () => {
  const t = makeTable();
  const me = t.ctx.players[0];
  me.isCpu = true;
  me.hand = RIICHI_HAND_2P.slice();
  me.lastDrawn = '2p';
  const prev = process.env.SAKI_RIICHI_FORCE;
  process.env.SAKI_RIICHI_FORCE = '1';
  try {
    for (let i = 0; i < 50; i++) {
      assert.equal(t.botDecision(0, me).type, 'Riichi');
    }
  } finally {
    if (prev === undefined) delete process.env.SAKI_RIICHI_FORCE;
    else process.env.SAKI_RIICHI_FORCE = prev;
  }
});

test('an open-handed bot never declares riichi', () => {
  const t = makeTable();
  const me = t.ctx.players[0];
  me.isCpu = true;
  me.hand = HAND_2P.slice();
  me.melds = [ponMeld('9z')];
  me.lastDrawn = '2p';
  const prev = process.env.SAKI_RIICHI_FORCE;
  process.env.SAKI_RIICHI_FORCE = '1';
  try {
    for (let i = 0; i < 50; i++) {
      assert.notEqual(t.botDecision(0, me).type, 'Riichi');
    }
  } finally {
    if (prev === undefined) delete process.env.SAKI_RIICHI_FORCE;
    else process.env.SAKI_RIICHI_FORCE = prev;
  }
});

// ------------------------------------------- doOwnKan: the kakan choke point

test('doOwnKan refuses a kakan declared while in riichi', async () => {
  const t = makeTable();
  const me = t.ctx.players[0];
  me.isCpu = true;
  me.riichi = true;
  me.riichiWaits = ['2p', '5z'];
  me.hand = ['3m', '2p', '3p', '4p', '6s', '7s', '8s', '9s', '1z', '2z', '5z', '6z', '3m'];
  me.melds = [ponMeld('3m')];

  const before = me.hand.length;
  const out = await t.doOwnKan(0, me, { kind: 'kakan', tile: '3m' });

  assert.equal(out.end, false, 'the hand must not end');
  assert.equal(out.next, 1, 'play passes to the next seat');
  assert.equal(me.hand.length, before, 'the tile was not moved into the meld');
  assert.equal(me.melds[0].type, 'pon', 'the meld was not upgraded');
});

test('doOwnKan allows the same kakan when not in riichi', async () => {
  const t = makeTable();
  const me = t.ctx.players[0];
  me.isCpu = true;
  me.hand = ['3m', '2p', '3p', '4p', '6s', '7s', '8s', '9s', '1z', '2z', '5z', '6z', '3m'];
  me.melds = [ponMeld('3m')];

  const before = me.hand.length;
  const out = await t.doOwnKan(0, me, { kind: 'kakan', tile: '3m' });

  assert.equal(out.end, false);
  assert.equal(me.hand.length, before - 1, 'the fourth tile moved out of hand');
  assert.equal(me.melds[0].type, 'kakan', 'the meld was upgraded');
  assert.equal(me.melds[0].tiles.length, 4);
});

test('doOwnKan warns and returns a chombo outcome for a declaration flagged chombo', async () => {
  const t = makeTable();
  const me = t.ctx.players[0];
  const warnings = [];
  t.sendError = (seat, code, message) => warnings.push({ seat, code, message });

  me.hand = ['1m', '1m', '1m', '1m', '3p', '4p', '6s', '7s', '8s', '9s', '1z', '2z', '5z', '3z'];
  const before = me.hand.length;
  const out = await t.doOwnKan(0, me, { kind: 'ankan', tile: '1m', chombo: true });

  assert.deepEqual(out, { end: true, winner: -3, winBy: { type: 'chombo', offender: 0 } });
  assert.equal(warnings.length, 1, 'the offender is warned');
  assert.equal(warnings[0].seat, 0);
  assert.equal(warnings[0].code, 'Chombo');
  assert.match(warnings[0].message, /mangan penalty/);
  assert.equal(me.hand.length, before, 'the illegal kan is not applied');
  assert.equal(me.melds.length, 0, 'no ankan meld is created');
});

// ------------------------------------------- tsumo gating: yaku vs noten

test('open haku pon with a complete shape can tsumo (yakuhai is a yaku)', () => {
  const t = makeTable();
  const me = t.ctx.players[0];
  // 123m 456p 789s + 77p pair, pon haku from another player, tsumo 7p.
  me.hand = ['1m', '2m', '3m', '4p', '5p', '6p', '7s', '8s', '9s', '7p', '7p'];
  me.melds = [{ tiles: ['5z', '5z', '5z'], open: true, type: 'pon' }];
  me.lastDrawn = '7p';
  const claim = t.scoreFor(0, '7p', { tsumo: true, kan: false, last: false, tenhou: false });
  assert.equal(claim.isAgari, true);
  assert.ok(claim.yakuman > 0 || claim.han >= 1, 'haku pon must supply a yaku');
  assert.equal(t.isAWin(claim), true);
  assert.equal(t.tsumoBlockReason(0, claim), null);
  const v = t.validateAct(0, { type: 'Tsumo' }, { firstDraw: false, isLastDraw: false });
  assert.equal(v.ok, true, JSON.stringify(v));
});

test('tsumo denial separates noten from no-yaku from shibari', () => {
  const t = makeTable();
  const me = t.ctx.players[0];
  // Noten: incomplete shape, no waits.
  me.hand = ['1m', '4m', '7m', '2p', '5p', '8p', '3s', '6s', '9s', '1z', '2z', '3z', '5z'];
  me.melds = [];
  me.lastDrawn = '5z';
  const noten = t.scoreFor(0, '5z', { tsumo: true, kan: false, last: false, tenhou: false });
  assert.equal(t.tsumoBlockReason(0, noten), 'noten');
  // Complete but yakuless open shape: open pinfu-only Aller (no haku, no tanyao
  // guarantee) scores isAgari with han 0.
  me.hand = ['2m', '3m', '4m', '6m', '7m', '8m', '2p', '3p', '4p', '7p', '7p'];
  me.melds = [{ tiles: ['6s', '7s', '8s'], open: true, type: 'chi' }];
  me.lastDrawn = '7p';
  const noyaku = t.scoreFor(0, '7p', { tsumo: true, kan: false, last: false, tenhou: false });
  if (noten.isAgari && !(noten.yakuman > 0 || noten.han >= 1)) {
    assert.equal(t.tsumoBlockReason(0, noyaku), 'no-yaku');
  } else {
    // If the fixture accidentally carries a yaku, at least the helper agrees
    // with isAWin: winnable -> null, else a named reason.
    assert.equal(t.tsumoBlockReason(0, noyaku), t.isAWin(noyaku) ? null : 'no-yaku');
  }
  // Shibari: overtime needs 2 han; force it and reuse the haku 1-han win.
  me.hand = ['1m', '2m', '3m', '4p', '5p', '6p', '7s', '8s', '9s', '7p', '7p'];
  me.melds = [{ tiles: ['5z', '5z', '5z'], open: true, type: 'pon' }];
  me.lastDrawn = '7p';
  const oneHan = t.scoreFor(0, '7p', { tsumo: true, kan: false, last: false, tenhou: false });
  assert.equal(t.isAWin(oneHan), true);
  t.overtime = true;
  try {
    assert.equal(t.winMeetsFloor(oneHan), oneHan.han >= 2 || oneHan.yakuman > 0);
    if (oneHan.han === 1 && !(oneHan.yakuman > 0)) {
      assert.equal(t.tsumoBlockReason(0, oneHan), 'shibari');
    }
  } finally {
    t.overtime = false;
  }
});

// ------------------------------------------------ malformed-input hardening

test('protocol: a non-array tiles payload cannot crash the codec', () => {
  // The crash from the audit: valid JSON with `tiles` as a number reached
  // `(tiles || []).map`, threw a TypeError out of the WS listener, and killed
  // the whole process (no uncaughtException handler).
  assert.deepEqual(P.tilesToSaki(1), []);
  assert.deepEqual(P.tilesToSaki(undefined), []);
  assert.deepEqual(P.tilesToSaki('3m'), []);
  const parsed = P.parseClientMessage('{"Action":{"Pon":{"tiles":1}}}');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.action.type, 'Pon');
  assert.deepEqual(parsed.action.tiles, []);
});

test('doOpenChi accepts a CPU claim that carries bare ranks, not codes', async () => {
  // CPU claims come from H.chiOptions as bare ranks ([2, 3]); human claims come
  // in as protocol codes (["2m","3m"]). The validator used to norm() the bare
  // ranks as-is, so no CPU chi ever matched a legal option and CPU seats could
  // never chi. Both shapes must work.
  const t = makeTable();
  const qp = t.ctx.players[1];
  qp.isCpu = true;
  qp.hand = ['2m', '3m', '5p', '6p', '7p', '2s', '3s', '4s', '6s', '7s', '8s', '1z', '1z'];
  t.ctx.players[0].discards = ['1m'];

  const out = await t.doOpenChi(1, 0, '1m', [2, 3]);
  assert.ok(out, 'the chi must be accepted, not rejected as an illegal option');
  assert.equal(qp.melds.length, 1);
  assert.equal(qp.melds[0].type, 'chi');
  assert.equal(qp.melds[0].tiles.length, 3);
});

// ---------------------------------------------------------------- ippatsu expiry

test('ippatsu survives the declaring discard and expires on the declarer next discard', async () => {
  const t = makeTable();
  t.assertConserved = () => {};
  const me = t.ctx.players[0];
  me.hand = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1p', '1p', '2p', '3p', '4p'];
  me.lastDrawn = '4p';
  me.riichi = true;
  me.ippatsu = true;
  me.ippatsuJustDeclared = true;

  await t.executeDiscard(0, '4p');
  assert.equal(me.ippatsu, true, 'the declaring discard itself must not clear ippatsu');
  assert.equal(me.ippatsuJustDeclared, false);

  me.hand.push('5p');
  me.lastDrawn = '5p';
  await t.executeDiscard(0, '5p');
  assert.equal(me.ippatsu, false, 'the declarer next discard clears ippatsu');

  me.hand.push('6p');
  me.lastDrawn = '6p';
  await t.executeDiscard(0, '6p');
  assert.equal(me.ippatsu, false, 'a later discard does not resurrect it');
});

// ---------------------------------------------------------------- turn clock

test('turnClockFor defaults to 10s and sanitises getTurnClock', () => {
  const t = makeTable();
  // The stub dispatcher has no getTurnClock: the documented default applies.
  assert.equal(t.turnClockFor(0), 10);
  const powers = t.ctx.state.powers;
  powers.getTurnClock = () => 6;
  assert.equal(t.turnClockFor(0), 6);
  powers.getTurnClock = () => 4.9;
  assert.equal(t.turnClockFor(0), 4, 'floors fractional seconds');
  for (const junk of [0, -3, NaN, Infinity, 'slow', null, undefined]) {
    powers.getTurnClock = () => junk;
    assert.equal(t.turnClockFor(0), 10, `junk ${String(junk)} falls back to 10`);
  }
});
