'use strict';
// Headless integration test: boots the bridge server (index.js), connects a
// mock protocol-v6 client, creates a room, starts a 1-human + 3-CPU game, and
// plays it to completion — asserting the whole event flow and GameOver.
//
// The mock client policy is intentionally conservative (bot-legal):
//   - accept every tsumo / ron the server offers,
//   - riichi occasionally when the server says can_riichi,
//   - otherwise tsumogiri discard,
//   - pass every pon/chi prompt,
//   - ReadyNextRound after every hand, ReturnToLobby after GameOver.

const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const WebSocket = require('ws');
const P = require('../protocol');

test('protocol tile codec correctly maps red dora and normal tiles', () => {
  const redMap = {
    '0m': { index: 4, red_dora: true },
    '5m': { index: 4, red_dora: false },
    '0p': { index: 13, red_dora: true },
    '5p': { index: 13, red_dora: false },
    '0s': { index: 22, red_dora: true },
    '5s': { index: 22, red_dora: false },
    '1m': { index: 0, red_dora: false },
    '9m': { index: 8, red_dora: false },
    '1p': { index: 9, red_dora: false },
    '9p': { index: 17, red_dora: false },
    '1s': { index: 18, red_dora: false },
    '9s': { index: 26, red_dora: false },
    '1z': { index: 27, red_dora: false },
    '7z': { index: 33, red_dora: false },
  };

  for (const [code, expected] of Object.entries(redMap)) {
    const tile = P.sakiToTile(code);
    assert.deepStrictEqual(tile, expected, `sakiToTile failed for ${code}`);
    const back = P.tileToSaki(tile);
    assert.strictEqual(back, code, `tileToSaki roundtrip failed for ${code}`);
  }
});

function startServer() {
  return new Promise((resolve, reject) => {
    const port = 20000 + Math.floor(Math.random() * 20000);
    const child = spawn(process.execPath, ['index.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: String(port), SAKI_POWER_SEATS: '0', BOT_DELAY_MS: '0' },
    });
    let log = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('server start timeout')); }, 15000);
    child.stdout.on('data', (d) => {
      log += d.toString();
      const m = log.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) { clearTimeout(timer); resolve({ child, port: parseInt(m[1], 10) }); }
    });
    child.stderr.on('data', (d) => { log += d.toString(); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited early (${code}):\n${log}`));
    });
  });
}

class MockClient {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.frames = [];
    this.waiting = null;
    this.errors = [];
    this.scoreSnapshots = [];
    this.counts = { GameStarted: 0, TileDrawn: 0, OtherPlayerDrew: 0, TileDiscarded: 0, RoundWon: 0, RoundDraw: 0, CallAvailable: 0, PlayerCalled: 0, PlayerRiichi: 0 };
    this.sent = false; // did we just reply to a TileDrawn?
    this.opened = new Promise((res, rej) => {
      this.ws.on('open', res);
      this.ws.on('error', rej);
    });
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      this.onMessage(m);
    });
  }

  onMessage(m) {
    if (m.Error) {
      this.errors.push(m.Error);
      // Resilient recovery: if we're mid-turn and the server rejected our
      // (only possibly-invalid) action, fall back to a tsumogiri discard.
      if (this.sent) { this.send({ Action: { Discard: { tile: null } } }); this.sent = false; }
      this.enqueue(m);
      return;
    }
    this.sent = false;
    const ev = m.Event;
    if (ev) {
      for (const key of Object.keys(this.counts)) if (ev[key]) this.counts[key]++;
      // Accumulate as frames stream past — next() drains them, so they cannot be
      // inspected afterwards.
      if (ev.RoundWon) {
        this.scoreSnapshots.push({ yakuList: ev.RoundWon.yaku_list, scores: ev.RoundWon.scores });
      }
      // --- auto-policy: respond to actionable events ---
      if (ev.TileDrawn) {
        const t = ev.TileDrawn;
        this.sent = true;
        if (t.can_tsumo) { this.send({ Action: 'Tsumo' }); }
        else if (t.can_riichi && Math.random() < 0.3) { this.send({ Action: { Riichi: { tile: null } } }); }
        else { this.send({ Action: { Discard: { tile: null } } }); }
      } else if (ev.CallAvailable) {
        const calls = ev.CallAvailable.calls || [];
        this.send({ Action: calls.includes('Ron') ? 'Ron' : 'Pass' });
      } else if (ev.RoundWon || ev.RoundDraw) {
        this.send('ReadyNextRound');
      }
      // Always enqueue so next()/nextWhere() can observe the event.
      this.enqueue(m);
      return;
    }
    this.enqueue(m);
  }

  enqueue(m) {
    if (this.waiting) { const w = this.waiting; this.waiting = null; w(m); }
    else this.frames.push(m);
  }

  send(obj) {
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
    else this.ws.on('open', () => this.send(obj));
  }

  async next() {
    if (this.frames.length) return this.frames.shift();
    return new Promise((res) => { this.waiting = res; });
  }

  async nextWhere(pred, timeoutMs = 40000) {
    const i = this.frames.findIndex(pred);
    if (i >= 0) return this.frames.splice(i, 1)[0];
    const start = Date.now();
    for (;;) {
      const m = await this.next();
      if (pred(m)) return m;
      if (Date.now() - start > timeoutMs) throw new Error('timeout waiting for matching message');
    }
  }

  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

test('Hello is rejected when the client asks for a different protocol version', { timeout: 30000 }, async () => {
  const server = await startServer();
  let client;
  try {
    client = new MockClient(`ws://127.0.0.1:${server.port}/ws`);
    await client.opened;

    client.send({ Hello: { protocol_version: 5, display_name: 'OldClient' } });
    const err = await client.nextWhere((m) => m.Error);
    assert.equal(err.Error.code, 'VersionMismatch');
    assert.match(err.Error.message, /v6/);
    // No session was minted, so no Welcome follows.
    assert.equal(client.frames.some((m) => m.Welcome), false);
  } finally {
    if (client) client.close();
    server.child.kill();
  }
});

test('Hello without a protocol_version is accepted (the field is optional)', { timeout: 30000 }, async () => {
  const server = await startServer();
  let client;
  try {
    client = new MockClient(`ws://127.0.0.1:${server.port}/ws`);
    await client.opened;

    client.send({ Hello: { display_name: 'NoVersion' } });
    const welcome = await client.nextWhere((m) => m.Welcome);
    assert.equal(welcome.Welcome.protocol_version, 6);
  } finally {
    if (client) client.close();
    server.child.kill();
  }
});

test('full bridge match (1 human + 3 CPU) completes with GameOver', { timeout: 90000 }, async () => {
  const server = await startServer();
  let client;
  try {
    console.log('[test] server up, connecting');
    client = new MockClient(`ws://127.0.0.1:${server.port}/ws`);
    await client.opened;
    console.log('[test] ws open');

    // Hello → Welcome
    client.send({ Hello: { protocol_version: 6, session_token: null, display_name: 'Tester' } });
    const welcome = await client.nextWhere((m) => m.Welcome);
    assert.equal(welcome.Welcome.protocol_version, 6, 'welcome carries protocol v6');
    assert.ok(typeof welcome.Welcome.session_token === 'string' && welcome.Welcome.session_token.length > 0);
    console.log('[test] welcome ok');

    // CreateRoom → RoomState (host seat 0)
    client.send({ CreateRoom: { length: 'EastOnly', rules: {} } });
    const rs1 = await client.nextWhere((m) => m.RoomState);
    const room = rs1.RoomState;
    assert.equal(room.your_seat, 0);
    assert.equal(room.seats.length, 4);
    assert.equal(room.seats[0].Human.name, 'Tester');
    console.log('[test] room created, host seat 0');

    // StartGame → GameStarted + a full hand of events
    client.send({ StartGame: {} });
    const gs = await client.nextWhere((m) => m.Event && m.Event.GameStarted);
    const g = gs.Event.GameStarted;
    assert.equal(g.hand.length, 13, 'dealt 13-tile hand');
    assert.equal(g.scores.length, 4);
    console.log('[test] game started, waiting for GameOver');

    // Drive the match to GameOver.
    let gameOverMsg = null;
    let msgs = 0;
    const deadline = Date.now() + 75000;
    while (!gameOverMsg) {
      if (Date.now() > deadline) throw new Error('match did not finish in time');
      const m = await client.next();
      if (++msgs % 5 === 0) console.log(`[test] ...${msgs} non-event frames, still waiting`);
      if (m.GameOver) { gameOverMsg = m.GameOver; break; }
      // All event-driven responses are handled inside onMessage.
    }
    console.log('[test] GAMEOVER received after', msgs, 'non-event frames');

    assert.ok(client.counts.GameStarted >= 1, 'at least one hand');
    assert.ok(client.counts.TileDrawn >= 1, 'our draw events arrived');
    assert.ok(client.counts.OtherPlayerDrew >= 1, 'CPU draw events arrived');
    assert.ok(client.counts.TileDiscarded >= 1, 'discards arrived');
    assert.ok(gameOverMsg.final_scores.length === 4);
    for (const s of gameOverMsg.final_scores) assert.ok(Number.isFinite(s));

    // Money conservation. Nothing moves points in or out of the table except
    // riichi sticks, which are already taken from a player when declared, so
    // every score snapshot the server emits must still total 100 000. A payout
    // bug (wrong honba, double-counted sticks, a loser charged twice) would
    // break this while still leaving every individual score finite.
    const TOTAL = 4 * 25000;
    const finalTotal = gameOverMsg.final_scores.reduce((a, b) => a + b, 0);
    assert.equal(finalTotal, TOTAL, `final scores must total ${TOTAL}, got ${finalTotal}`);

    const scoreSnapshots = client.scoreSnapshots;
    for (const [i, { scores: snap }] of scoreSnapshots.entries()) {
      const sum = snap.reduce((a, b) => a + b, 0);
      assert.equal(sum, TOTAL, `RoundWon #${i} scores must total ${TOTAL}, got ${sum}`);
    }
    // A match is seeded from Math.random(), so it may legitimately end with all
    // four hands drawn and no winner. Log rather than assert; settlement.test.js
    // covers the win paths deterministically.
    console.log(`[test] hands won: ${scoreSnapshots.length}`);

    // Return to lobby and confirm a post-game RoomState.
    client.send('ReturnToLobby');
    const rs2 = await client.nextWhere((m) => m.RoomState && m.RoomState.post_game === false);
    assert.ok(rs2, 'returned to lobby (Ready for rematch)');

    console.log(`\n[test] events seen: ${JSON.stringify(client.counts)}`);
    console.log(`[test] final scores: ${gameOverMsg.final_scores.join('/')}`);
    console.log(`[test] client-recoverable errors: ${client.errors.length}`);
    for (const e of client.errors) console.log(`       Error ${e.code}: ${e.message}`);
    assert.ok(client.errors.length <= 2, 'no unexpected spam of invalid-action errors');
  } finally {
    if (client) client.close();
    server.child.kill();
  }
});

test('normal-type powers on the wire: yuu/saki-normal report passive pills, koromo stays flow', { timeout: 90000 }, async () => {
  const server = await startServer();
  let client;
  try {
    client = new MockClient(`ws://127.0.0.1:${server.port}/ws`);
    await client.opened;
    client.send({ Hello: { protocol_version: 6, session_token: null, display_name: 'PowersTester' } });
    await client.nextWhere((m) => m.Welcome);

    client.send({ CreateRoom: { length: 'EastOnly', rules: {} } });
    await client.nextWhere((m) => m.RoomState);

    // Host sets a mixed table: two normal-type (yuu, saki-normal), one flow.
    client.send({ SetPowers: { power_seats: ['yuu', 'saki-normal', 'koromo', 'none'] } });
    client.send({ StartGame: {} });
    await client.nextWhere((m) => m.Event && m.Event.GameStarted);

    // Watch the SuperpowerIndicator stream until every seat has been seen once.
    const seen = new Map(); // seat -> indicator
    const deadline = Date.now() + 60000;
    while (seen.size < 3) {
      if (Date.now() > deadline) throw new Error('did not see all three power indicators');
      const m = await client.nextWhere((x) => x.Event && x.Event.SuperpowerIndicator);
      const spi = m.Event.SuperpowerIndicator;
      if (!seen.has(spi.seat)) seen.set(spi.seat, spi);
    }

    const yuu = seen.get(0);
    const sakiNormal = seen.get(1);
    const koromo = seen.get(2);

    assert.equal(yuu.power, 'yuu');
    assert.equal(yuu.type, 'normal');
    assert.equal(yuu.gauge, null, 'normal-type powers must report a null gauge');
    assert.equal(yuu.available_tiers.length, 0);

    assert.equal(sakiNormal.power, 'saki-normal');
    assert.equal(sakiNormal.type, 'normal');
    assert.equal(sakiNormal.gauge, null);

    assert.equal(koromo.power, 'koromo');
    assert.equal(koromo.type, 'flow');
    assert.equal(koromo.available_tiers.length, 4, 'flow seat keeps its tier ladder');
    assert.ok(typeof koromo.gauge === 'number', 'flow seat keeps its gauge');
  } finally {
    if (client) client.close();
    server.child.kill();
  }
});