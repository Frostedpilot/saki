'use strict';
// hand-driver.test.js — the hand-level turn order (phase 4a, KI-04).
//
// The adapter is a fake so these stay fast and deterministic: they pin the
// outer loop only, not the per-turn rules that still live in each driver.
const test = require('node:test');
const assert = require('node:assert');
const { playHand, playTurn } = require('../hand-driver');

function makeAdapter(overrides = {}) {
  const seen = [];
  const adapter = {
    checkKyuushu: () => -1,
    abortKyuushu: (seat) => ({ aborted: true, seat }),
    dealer: () => 0,
    wallLeft: () => 8,
    playTurn: (seat) => {
      seen.push(seat);
      if (seat === 2) return { end: true, winner: 2, winBy: { type: 'tsumo', seat: 2 } };
      return { end: false, next: (seat + 1) % 4 };
    },
    settle: (winner, winBy) => ({ winner, winBy }),
    ...overrides,
  };
  return { adapter, seen };
}

test('playHand follows next seats and settles the first end', async () => {
  const { adapter, seen } = makeAdapter();
  const result = await playHand(adapter);

  assert.deepEqual(seen, [0, 1, 2]);
  assert.equal(result.winner, 2);
  assert.deepEqual(result.winBy, { type: 'tsumo', seat: 2 });
});

test('playHand returns a kyuushu abort without playing a turn', async () => {
  const { adapter, seen } = makeAdapter({ checkKyuushu: () => 3 });
  const result = await playHand(adapter);

  assert.deepEqual(seen, []);
  assert.deepEqual(result, { aborted: true, seat: 3 });
});

test('playHand settles an exhausted wall with no winner', async () => {
  const { adapter, seen } = makeAdapter({ wallLeft: () => 0, settle: (w, wb) => ({ w, wb }) });
  const result = await playHand(adapter);

  assert.deepEqual(seen, []);
  assert.deepEqual(result, { w: -1, wb: null });
});

test('playHand defaults a missing next to the next seat', async () => {
  const { adapter, seen } = makeAdapter({
    playTurn: (seat) => {
      seen.push(seat);
      if (seat === 1) return { end: true, winner: 1, winBy: null };
      return { end: false };
    },
  });
  const result = await playHand(adapter);

  assert.deepEqual(seen, [0, 1]);
  assert.equal(result.winner, 1);
});

test('playHand stops an overlong hand at maxTurns', async () => {
  let stops = 0;
  const { adapter, seen } = makeAdapter({
    wallLeft: () => 8,
    playTurn: (seat) => {
      seen.push(seat);
      return { end: false, next: (seat + 1) % 4 };
    },
    onSafetyStop: () => {
      stops++;
    },
  });
  const result = await playHand(adapter, { maxTurns: 3 });

  assert.equal(seen.length, 3);
  assert.equal(stops, 1);
  assert.equal(result.winner, -1);
  assert.equal(result.winBy, null);
});

function makeTurnAdapter(overrides = {}) {
  const calls = [];
  const me = {
    hand: ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1p', '2p', '3p', '4p', '5p'],
    melds: [],
    discards: [],
    riichi: false,
    doubleRiichi: false,
    ippatsu: false,
    tempFuriten: false,
    lastDrawn: null,
  };
  const ctx = { drawsThisKyoku: 0, callsMade: 0, kanCount: 0, rinshanIdx: 0, players: [me] };
  const adapter = {
    ctx,
    startTurn: () => {
      calls.push('start');
      return 0;
    },
    onTurnStart: () => calls.push('turn-start'),
    wallLeft: () => 10,
    drawTurn: () => {
      calls.push('draw');
      return '9p';
    },
    scoreFor: () => ({ isAgari: false }),
    isAWin: () => false,
    winMeetsFloor: () => false,
    tsumoBlockReason: () => null,
    emitDraw: () => calls.push('emit'),
    chooseTurnAction: () => {
      calls.push('choose');
      return { type: 'Discard', tile: '1m' };
    },
    executeDiscard: () => ({ tile: '1m' }),
    afterDiscard: () => calls.push('after'),
    resolveCallWindow: () => null,
    ...overrides,
  };
  return { adapter, me, ctx, calls };
}

test('playTurn draws, chooses and returns the next seat', async () => {
  const { adapter, me, ctx, calls } = makeTurnAdapter();
  const out = await playTurn(adapter, 0);

  assert.deepEqual(out, { end: false, next: 1 });
  assert.equal(ctx.drawsThisKyoku, 1);
  assert.equal(me.lastDrawn, '9p');
  assert.deepEqual(calls, ['start', 'turn-start', 'draw', 'emit', 'choose', 'after']);
});

test('playTurn delegates a valid tsumo to the adapter', async () => {
  const { adapter } = makeTurnAdapter({
    scoreFor: () => ({ isAgari: true, han: 1 }),
    isAWin: () => true,
    winMeetsFloor: () => true,
    chooseTurnAction: () => ({ type: 'Tsumo' }),
    onTsumo: (seat) => ({ end: true, winner: seat, winBy: { type: 'tsumo', seat } }),
  });
  const out = await playTurn(adapter, 0);

  assert.deepEqual(out, { end: true, winner: 0, winBy: { type: 'tsumo', seat: 0 } });
});

test('playTurn delegates a kan without running the discard path', async () => {
  const { adapter, calls } = makeTurnAdapter({
    chooseTurnAction: () => ({ type: 'Kan', kan: { kind: 'ankan', tile: '1m' } }),
    doOwnKan: (seat, me, kan) => {
      calls.push(`kan:${seat}:${kan.kind}`);
      return { end: false, next: 2 };
    },
    executeDiscard: () => {
      calls.push('discard');
      return { tile: '1m' };
    },
  });
  const out = await playTurn(adapter, 0);

  assert.deepEqual(out, { end: false, next: 2 });
  assert.ok(calls.includes('kan:0:ankan'));
  assert.ok(!calls.includes('discard'));
});

test('playTurn reports an exhausted wall without choosing', async () => {
  const { adapter, calls } = makeTurnAdapter({
    drawTurn: () => null,
    onWallExhausted: () => ({ end: true, winner: -1, winBy: null }),
  });
  const out = await playTurn(adapter, 0);

  assert.deepEqual(out, { end: true, winner: -1, winBy: null });
  assert.ok(!calls.includes('choose'));
});
