// action-events.test.js — the server's event contract for calls and kans.
//
// validation.test.js pins *whether* a kan is legal. This suite pins what the
// client actually receives when one happens: the order of
// PlayerCalled -> HandUpdated -> TileDrawn, the exact tiles left in hand, the
// meld shape, and the rinse of the discard river. The post-kan HandUpdated was
// missing for ankan/kakan while open calls sent it, which left the kan tiles on
// screen and made riichi/discards reference tiles the server no longer had.
//
// These are wire-level assertions on purpose: the client reducer can only be as
// correct as the sequence it is fed, so a missing or reordered event should fail
// here before it becomes a client-state bug.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { Table } = require('../table');
const P = require('../protocol');

const HAND_13 = ['2m', '3m', '4m', '6s', '7s', '8s', '9s', '1z', '2z', '5z', '6z', '7z', '9p'];
// Same shape without a 3m, so "no copy of the called tile is left in hand" is
// unambiguous rather than tripping over a spare copy in the fixture.
const HAND_NO_3M = ['1m', '2m', '4m', '6s', '7s', '8s', '9s', '1z', '2z', '5z', '6z', '7z', '9p'];

function eventName(ev) {
  if (!ev) return '(none)';
  const payload = ev.Event || ev;
  return Object.keys(payload)[0] || '(empty)';
}

function makeTable({ dead = ['5z', '1p', '2p', '3p'] } = {}) {
  const room = {
    powerSeats: ['none', 'none', 'none', 'none'],
    sendTo(seat, ev) {
      t.timeline.push({ channel: 'send', seat, name: eventName(ev), ev });
    },
    broadcastRoomState() {},
  };
  const t = new Table(room, 999);
  t.timeline = [];
  t.broadcast = (ev) => t.timeline.push({ channel: 'broadcast', name: eventName(ev), ev });
  t.broadcastMessage = () => {};
  t.broadcastPowerStatus = () => {};
  t.settlePowerHook = () => {};
  t.playerHandsInfo = () => [];
  t.maybeActivateTier = () => {};
  t.powerOf = () => 'none';

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
      isCpu: false,
    })),
    dealer: 0,
    bakaze: 1,
    doraInd: [],
    uraInd: [],
    dead,
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

  // Capture the call pipeline's next step instead of running a whole hand.
  t.afterCall = [];
  t.discardAfterCall = async (seat, _me, banned) => {
    t.afterCall.push({ seat, banned });
    return null;
  };
  return t;
}

// A concise view of the timeline for assertions. Drops the OtherPlayerDrew
// fan-out, which is covered separately.
function names(t) {
  return t.timeline.filter((e) => e.name !== 'OtherPlayerDrew').map((e) => e.name);
}

function sentSeat(t, seat, name) {
  const hit = t.timeline.find((e) => e.channel === 'send' && e.seat === seat && e.name === name);
  return hit && hit.ev.Event[name];
}

function broadcast(t, name) {
  const hit = t.timeline.find((e) => e.channel === 'broadcast' && e.name === name);
  if (!hit) return undefined;
  return hit.ev.Event ? hit.ev.Event[name] : hit.ev[name];
}

function totalCopies(hand, melds, tileCode) {
  const tile = P.sakiToTile(tileCode).index;
  const inHand = hand.filter((x) => P.sakiToTile(x).index === tile).length;
  const inMelds = melds.reduce((n, m) => n + m.tiles.filter((x) => P.sakiToTile(x).index === tile).length, 0);
  return inHand + inMelds;
}

const ponMeld = (tile) => ({ tiles: [tile, tile, tile], open: true, type: 'pon' });

// ---------------------------------------------------------------- own ankan

test('an ankan emits PlayerCalled, HandUpdated, then the rinshan TileDrawn', async () => {
  const t = makeTable({ dead: ['5z', '1p', '2p', '3p'] });
  const me = t.ctx.players[0];
  me.hand = ['1m', '1m', '1m', '1m', '2p', '3p', '4p', '6s', '7s', '8s', '9s', '1z', '2z', '3z'];

  const out = await t.doOwnKan(0, me, { kind: 'ankan', tile: '1m' });

  assert.equal(out.end, false);
  assert.deepEqual(names(t), ['PlayerCalled', 'HandUpdated', 'TileDrawn']);

  const called = broadcast(t, 'PlayerCalled');
  assert.equal(called.call_type, 'Ankan');
  assert.equal(called.tiles.length, 4, 'the kan quartet is carried on the wire');

  const update = sentSeat(t, 0, 'HandUpdated');
  assert.equal(update.hand.length, 10, 'four tiles left the concealed hand');
  assert.equal(totalCopies(update.hand, me.melds, '1m'), 4, 'all four 1m are in the meld');
  assert.equal(
    update.hand.filter((x) => x.index === P.sakiToTile('1m').index).length,
    0,
    'no kan tile may linger in the hand'
  );

  assert.equal(me.melds.length, 1);
  assert.equal(me.melds[0].type, 'ankan');
  assert.equal(me.melds[0].open, false, 'an ankan stays concealed');
  assert.equal(me.melds[0].tiles.length, 4);

  // The rinshan draw lands after the snapshot, and the player ends on 11 tiles.
  assert.equal(me.hand.length, 11);
  assert.equal(me.lastDrawn, '5z');
  assert.equal(sentSeat(t, 0, 'TileDrawn').tile.index, P.sakiToTile('5z').index);
});

test('the other seats learn about the ankan draw without receiving the hand', async () => {
  const t = makeTable();
  const me = t.ctx.players[0];
  me.hand = ['1m', '1m', '1m', '1m', '2p', '3p', '4p', '6s', '7s', '8s', '9s', '1z', '2z', '3z'];

  await t.doOwnKan(0, me, { kind: 'ankan', tile: '1m' });

  for (const seat of [1, 2, 3]) {
    assert.equal(sentSeat(t, seat, 'HandUpdated'), undefined, `seat ${seat} must not see the hand`);
    assert.ok(sentSeat(t, seat, 'OtherPlayerDrew'), `seat ${seat} sees the draw`);
  }
});

test('an ankan leaves the previous discarder river intact', async () => {
  const t = makeTable();
  const me = t.ctx.players[0];
  t.ctx.players[1].discards = ['9p', '1z'];
  me.hand = ['1m', '1m', '1m', '1m', '2p', '3p', '4p', '6s', '7s', '8s', '9s', '1z', '2z', '3z'];

  await t.doOwnKan(0, me, { kind: 'ankan', tile: '1m' });

  assert.deepEqual(t.ctx.players[1].discards, ['9p', '1z'], 'own kans consume no discard');
});

// ---------------------------------------------------------------- own kakan

test('a kakan upgrades the pon, removes exactly one copy, and syncs the hand', async () => {
  const t = makeTable({ dead: ['9p', '1p', '2p', '3p'] });
  const me = t.ctx.players[0];
  me.hand = ['3m', ...HAND_NO_3M.slice(0, 12)];
  me.melds = [ponMeld('3m')];

  const out = await t.doOwnKan(0, me, { kind: 'kakan', tile: '3m' });

  assert.equal(out.end, false);
  assert.deepEqual(names(t), ['PlayerCalled', 'HandUpdated', 'TileDrawn']);

  const called = broadcast(t, 'PlayerCalled');
  assert.equal(called.call_type, 'Kakan');
  assert.equal(called.tiles.length, 4);

  const update = sentSeat(t, 0, 'HandUpdated');
  assert.equal(update.hand.length, 12, 'only the fourth copy left the hand');
  assert.equal(update.hand.filter((x) => x.index === P.sakiToTile('3m').index).length, 0);
  assert.equal(totalCopies(update.hand, me.melds, '3m'), 4);

  assert.equal(me.melds.length, 1, 'the pon is upgraded, not duplicated');
  assert.equal(me.melds[0].type, 'kakan');
  assert.equal(me.melds[0].tiles.length, 4);
  assert.equal(me.hand.length, 13, '12 concealed plus the rinshan draw');
  assert.equal(me.lastDrawn, '9p');
});

// ------------------------------------------------------------- daiminkan

test('a daiminkan emits PlayerCalled, HandUpdated, then TileDrawn', async () => {
  const t = makeTable({ dead: ['5z', '1p', '2p', '3p'] });
  const caller = t.ctx.players[0];
  const from = t.ctx.players[3];
  caller.hand = ['3m', '3m', '3m', ...HAND_NO_3M.slice(0, 10)];
  from.discards = ['9p', '3m'];

  const out = await t.doOpenCall(0, 3, '3m', 'daiminkan');

  assert.equal(out.end, false);
  assert.deepEqual(names(t), ['PlayerCalled', 'HandUpdated', 'TileDrawn']);

  const called = broadcast(t, 'PlayerCalled');
  assert.equal(called.call_type, 'Daiminkan');
  assert.equal(called.from_player, 'North');
  assert.equal(called.tiles.length, 4);
  assert.equal(
    called.tiles.filter((x) => x.index === P.sakiToTile('3m').index).length,
    4,
    'the called tile is part of the meld'
  );

  const update = sentSeat(t, 0, 'HandUpdated');
  assert.equal(update.hand.length, 10);
  assert.equal(update.hand.filter((x) => x.index === P.sakiToTile('3m').index).length, 0);

  assert.equal(caller.melds.length, 1);
  assert.equal(caller.melds[0].type, 'kan');
  assert.equal(caller.melds[0].open, true);
  assert.equal(caller.melds[0].tiles.length, 4);
  assert.equal(t.ctx.players[3].discards.length, 1, 'the called discard is removed');
  assert.equal(caller.hand.length, 11, '10 concealed plus the rinshan draw');
});

// --------------------------------------------------------------------- pon

test('a pon emits PlayerCalled then HandUpdated, with no illegal rinshan draw', async () => {
  const t = makeTable({ dead: ['5z', '1p', '2p', '3p'] });
  const caller = t.ctx.players[0];
  const from = t.ctx.players[3];
  caller.hand = ['3m', '3m', ...HAND_NO_3M.slice(0, 11)];
  from.discards = ['9p', '3m'];

  const out = await t.doOpenCall(0, 3, '3m', 'pon');

  assert.equal(out.end, false);
  assert.deepEqual(names(t), ['PlayerCalled', 'HandUpdated']);

  const called = broadcast(t, 'PlayerCalled');
  assert.equal(called.call_type, 'Pon');
  assert.equal(called.tiles.length, 3);

  const update = sentSeat(t, 0, 'HandUpdated');
  assert.equal(update.hand.length, 11, 'two tiles left the hand');
  assert.equal(update.hand.filter((x) => x.index === P.sakiToTile('3m').index).length, 0);
  assert.equal(caller.melds[0].tiles.length, 3);
  assert.equal(caller.melds[0].type, 'pon');
  assert.equal(t.ctx.dead[t.ctx.rinshanIdx], '5z', 'a pon does not consume the dead wall');
  assert.deepEqual(t.afterCall[0].banned, ['3m'], 'kuikae bans the called tile');
});

test('the pon caller total stays at fourteen physical tiles before the discard', async () => {
  const t = makeTable();
  const caller = t.ctx.players[0];
  const from = t.ctx.players[3];
  caller.hand = ['3m', '3m', ...HAND_NO_3M.slice(0, 11)];
  from.discards = ['3m'];

  await t.doOpenCall(0, 3, '3m', 'pon');

  const concealed = caller.hand.length;
  const melded = caller.melds.reduce((n, m) => n + m.tiles.length, 0);
  assert.equal(concealed + melded, 14, '13 in hand + one claimed tile');
  for (const code of ['3m']) {
    assert.ok(totalCopies(caller.hand, caller.melds, code) <= 4, `${code} never exceeds four copies`);
  }
});

// --------------------------------------------------------------------- chi

test('a chi emits PlayerCalled then HandUpdated with the called tile at the edge', async () => {
  const t = makeTable();
  const caller = t.ctx.players[0];
  const from = t.ctx.players[3];
  caller.hand = ['2m', '4m', ...HAND_NO_3M.slice(0, 11)];
  from.discards = ['9p', '3m'];

  const out = await t.doOpenChi(0, 3, '3m', ['2m', '4m']);

  assert.equal(out.end, false);
  assert.deepEqual(names(t), ['PlayerCalled', 'HandUpdated']);

  const called = broadcast(t, 'PlayerCalled');
  assert.equal(called.call_type, 'Chi');
  assert.equal(called.tiles.length, 3);

  const update = sentSeat(t, 0, 'HandUpdated');
  assert.equal(update.hand.length, 11);
  assert.equal(update.hand.filter((x) => x.index === P.sakiToTile('3m').index).length, 0);

  assert.equal(caller.melds[0].type, 'chi');
  assert.equal(caller.melds[0].open, true);
  assert.equal(caller.melds[0].tiles.length, 3);
  assert.equal(t.ctx.players[3].discards.length, 1);
  assert.equal(t.afterCall[0].banned.length > 0, true, 'chi passes a kuikae ban to the discard');
});

test('an invalid chi leaves the hand, melds and river untouched', async () => {
  const t = makeTable();
  const caller = t.ctx.players[0];
  const from = t.ctx.players[3];
  caller.hand = ['2m', '4m', ...HAND_13.slice(0, 11)];
  const handBefore = [...caller.hand];
  from.discards = ['3m'];
  const errors = [];
  t.sendError = (seat, code, message) => errors.push({ seat, code, message });

  const out = await t.doOpenChi(0, 3, '3m', ['1m', '4m']);

  assert.equal(out, null);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /legal option/);
  assert.deepEqual(caller.hand, handBefore, 'no partial splice');
  assert.deepEqual(caller.melds, []);
  assert.deepEqual(from.discards, ['3m']);
});

// -------------------------------------------------------------- invariants

test('every call type leaves hand + meld at the right physical size', async () => {
  const cases = [
    { name: 'pon', kind: 'pon', draw: false, expected: 14 },
    { name: 'daiminkan', kind: 'daiminkan', draw: true, expected: 14 },
    { name: 'chi', kind: 'chi', draw: false, expected: 14 },
  ];

  for (const c of cases) {
    const t = makeTable();
    const caller = t.ctx.players[0];
    const from = t.ctx.players[3];
    const hand = c.kind === 'chi' ? ['2m', '4m', ...HAND_13.slice(0, 11)] : ['3m', '3m', '3m', ...HAND_13.slice(0, 10)];
    caller.hand = hand;
    from.discards = ['3m'];

    if (c.kind === 'chi') await t.doOpenChi(0, 3, '3m', ['2m', '4m']);
    else await t.doOpenCall(0, 3, '3m', c.kind);

    const concealed = caller.hand.length - (c.draw ? 1 : 0); // ignore the rinshan tile
    const melded = caller.melds.reduce((n, m) => n + m.tiles.length, 0);
    assert.equal(concealed + melded, c.expected, `${c.name}: hand + meld size`);
  }
});
