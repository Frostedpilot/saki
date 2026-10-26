'use strict';
// The call window for Table: ron/pon/kan/chi arbitration, the open-call and
// post-call-discard paths, and the recursive re-check after a call. Extracted
// from table.js (KI-11). It drives the Table through its public methods and the
// same `turn-core` candidates the offline driver uses.
const P = require('./protocol');
const H = require('../engine/helpers');
const { norm, same } = require('../engine/tiles');
const { RULES } = require('../engine/rules-config');
const MF = require('../engine/match-flow');
const TC = require('../engine/turn-core');
const { PHASE } = require('./phases');

// Backward-compatible collectRon helper (delegates to resolveCallWindow).
async function collectRon(table, tile, from, flags = {}) {
  const res = await table.resolveCallWindow(from, tile, { ...flags, chankan: true });
  if (res && res.end && res.winBy && res.winBy.type === 'ron') {
    return res.winBy.hits;
  }
  return [];
}

// Unified, simultaneous call window for Ron, Pon/Kan, and Chi with priority arbitration.
async function resolveCallWindow(table, from, tile, flags = {}) {
  const ctx = table.ctx;
  const { players } = ctx;
  table.phase = PHASE.CALL_WINDOW;
  table.activeSeat = -1;

  // 1. Collect all valid call options for the other 3 seats. The rules for
  // which calls exist (riichi cannot call, the daiminkan needs three copies
  // and kan budget, chi is shimocha-only) live in engine/turn-core.js so the
  // CLI cannot drift from the server. `calls` is the wire shape only.
  const candidates = TC.callCandidates({
    from,
    tile,
    players,
    dead: ctx.dead,
    scoreCtxFor: (q) => table.shootCtx(q, flags.chankan, flags.houtei),
    // No enchousen gate until overtime opens; then ryanhan-shibari.
    // Reads RULES via match-flow so the floor cannot drift (game.js overtime).
    minHan: MF.minHan(table.overtime),
    chankan: !!flags.chankan,
    kanCount: ctx.kanCount,
    rinshanIdx: ctx.rinshanIdx,
  });

  const candidateMap = new Map();
  for (const c of candidates) {
    if (!TC.isCall(c)) continue;
    const calls = [];
    if (c.ron) calls.push('Ron');
    if (c.daiminkan) calls.push('Daiminkan');
    if (c.pon) calls.push({ Pon: { options: c.pon.map((pair) => pair.map(P.sakiToTile)) } });
    if (c.chi) {
      const suit = norm(tile)[1];
      calls.push({ Chi: { options: c.chi.map((o) => o.map((n) => P.sakiToTile(n + suit))) } });
    }
    c.calls = calls;
    candidateMap.set(c.seat, c);
  }

  if (candidateMap.size === 0) {
    table.phase = PHASE.TURN_ACT;
    // Fully unclaimed discard: the only place suucha-riichi and suufon-renda
    // can fire (ron/pon/chi claims return above with their own outcomes).
    const lapAbort = table.checkLapAbort();
    if (lapAbort) return { end: true, winner: -1, winBy: { type: 'abort', reason: lapAbort } };
    return null;
  }

  // 2. Concurrently poll candidates
  const candidateSeats = Array.from(candidateMap.keys());
  const responses = await new Promise((resolveAll) => {
    let resolved = false;
    const results = [];
    let pendingCount = candidateSeats.length;

    for (const q of candidateSeats) {
      (async () => {
        const c = candidateMap.get(q);
        const qp = c.qp;
        let res;
        if (qp.isCpu) {
          if (c.ron) res = { seat: q, type: 'Ron' };
          else if (c.daiminkan && table.decide.next() < 0.25) res = { seat: q, type: 'Kan' };
          else if (
            c.pon &&
            H.botWantsCall(H.shantenOf(qp.hand) - H.shantenOf(table.removeCopies(qp.hand, tile, 2)), false, () =>
              table.decide.next()
            )
          ) {
            res = { seat: q, type: 'Pon' };
          } else if (c.chi && table.decide.next() < 0.35) {
            const chosen = c.chi[Math.floor(table.decide.next() * c.chi.length)];
            res = { seat: q, type: 'Chi', tiles: chosen };
          } else {
            res = { seat: q, type: 'Pass' };
          }
        } else {
          table.room.sendTo(
            q,
            P.event(
              P.evCallAvailable({
                tile: P.sakiToTile(tile),
                discarder: P.seatWind(from, ctx.dealer),
                calls: c.calls,
              })
            )
          );
          const allowed = new Set(['Pass']);
          if (c.ron) allowed.add('Ron');
          if (c.pon) allowed.add('Pon');
          if (c.daiminkan) allowed.add('Kan');
          if (c.chi) allowed.add('Chi');
          const action = await table.request(q, allowed);
          res = { seat: q, ...action };
        }

        if (resolved) return;
        results.push(res);
        pendingCount--;

        // If Ron was claimed and no other candidate can also Ron:
        const remainingCouldRon = candidateSeats.some(
          (s) => !results.some((r) => r.seat === s) && candidateMap.get(s)?.ron
        );
        if (res.type === 'Ron' && !remainingCouldRon) {
          resolved = true;
          for (const s of candidateSeats) {
            if (!results.some((r) => r.seat === s)) table.cancelRequest(s);
          }
          resolveAll(results);
          return;
        }

        if (pendingCount === 0) {
          resolved = true;
          resolveAll(results);
        }
      })().catch((err) => {
        console.error('[bridge] resolveCallWindow candidate error:', err);
        if (!resolved) {
          pendingCount--;
          if (pendingCount === 0) {
            resolved = true;
            resolveAll(results);
          }
        }
      });
    }
  });

  // 3. Priority Arbitration. The rule lives in engine/turn-core.js: ron
  // wins, then the nearest pon/daiminkan, then chi. `responses` arrives in
  // response order, not turn order, so the helper ranks explicitly. It also
  // reports the candidates who could have ronned and passed, which is the
  // temporary-furiten rule.
  const verdict = TC.arbitrateCalls({ from, candidates: candidateMap, responses });
  for (const seat of verdict.passers) players[seat].tempFuriten = true;

  if (verdict.type === 'ron') {
    table.phase = PHASE.TURN_ACT;
    // Turn order also decides who collects the riichi sticks below, so hits
    // stay in turn order rather than response order.
    return {
      end: true,
      winner: verdict.claims[0].seat,
      winBy: { type: 'ron', from, hits: verdict.claims, tile, flags },
    };
  }

  if (verdict.type === 'pon' || verdict.type === 'daiminkan') {
    return await table.doOpenCall(verdict.seat, from, tile, verdict.type);
  }

  if (verdict.type === 'chi') {
    return await table.doOpenChi(verdict.seat, from, tile, verdict.tiles);
  }

  table.phase = PHASE.TURN_ACT;
  // Everyone passed: same quiet-discard case as the empty window above.
  const lapAbort = table.checkLapAbort();
  if (lapAbort) return { end: true, winner: -1, winBy: { type: 'abort', reason: lapAbort } };
  return null;
}

function removeCopies(hand, tile, n) {
  const out = [...hand];
  for (let c = 0; c < n; c++) {
    const i = out.findIndex((x) => same(x, tile));
    if (i < 0) break;
    out.splice(i, 1);
  }
  return out;
}

async function doOpenCall(table, q, from, tile, kind) {
  const ctx = table.ctx;
  const qp = ctx.players[q];
  const tiles = [];
  const n = kind === 'daiminkan' ? 3 : 2;
  for (let c = 0; c < n; c++) {
    const i = qp.hand.findIndex((x) => same(x, tile));
    if (i < 0) break;
    tiles.push(qp.hand.splice(i, 1)[0]);
  }
  ctx.players[from].discards.pop();
  tiles.push(tile);
  qp.melds.push({ tiles, open: true, type: kind === 'daiminkan' ? 'kan' : 'pon' });
  table.recordJournal(q, 'call', { kind, tiles: [...tiles], from, called: tile });
  table.broadcast(
    P.evPlayerCalled({
      player: P.seatWind(q, ctx.dealer),
      fromPlayer: P.seatWind(from, ctx.dealer),
      callType: kind === 'daiminkan' ? 'Daiminkan' : 'Pon',
      calledTile: P.sakiToTile(tile),
      tiles: P.tilesToProtocol(tiles),
    })
  );
  console.log(`[bridge] P${q} ${kind.toUpperCase()} ${tile}`);
  ctx.callsMade++;
  H.clearAllIppatsu(ctx.players);

  if (!qp.isCpu) {
    table.room.sendTo(q, P.event(P.evHandUpdated({ hand: P.tilesToProtocol([...qp.hand]) })));
  }

  if (kind === 'daiminkan') {
    ctx.kansBy[q]++;
    if (MF.abortEnabled(RULES.serverAborts, 'suukaikan') && H.isSuukaikanAbort(ctx.kansBy)) {
      console.log(`[bridge] SUUKAIKAN (four kans: ${ctx.kansBy.join('/')}) - abortive draw`);
      return { end: true, winner: -1, winBy: { type: 'abort', reason: 'Suukaikan' } };
    }
    if (ctx.state.powers && typeof ctx.state.powers.broadcastPlayerKan === 'function') {
      ctx.state.powers.broadcastPlayerKan(q, ctx.state);
    }
    // Hook before the dora flip so a seeding power (Saki) can swap the
    // indicator about to be revealed (see doOwnKan). kanCount is the total
    // kan index revealKanDora will use, not the per-seat count.
    if (table.powerOf(q) !== 'none') {
      table.maybeActivateTier(q, ctx.kanCount + 1);
    }
    ctx.revealKanDora();
    const rt = ctx.dead[ctx.rinshanIdx++];
    if (rt !== undefined) {
      table.recordJournal(q, 'rinshan', rt);
      qp.hand.push(rt);
      qp.lastDrawn = rt;
      H.clearTempFuritenOnDraw(qp); // a kan draw is still a draw
      const trs = table.scoreFor(q, rt, { tsumo: true, kan: true, last: false, tenhou: false });
      const wantTsumo = table.isAWin(trs) && table.winMeetsFloor(trs);
      const tsumoReason = wantTsumo ? null : table.tsumoBlockReason(q, trs);

      table.room.sendTo(
        q,
        P.event(
          P.evTileDrawn({
            tile: P.sakiToTile(rt),
            remaining: ctx.poolTotal(),
            canTsumo: wantTsumo,
            canTsumoReason: tsumoReason,
            canRiichi: false,
            isFuriten: table.furitenNow(qp),
          })
        )
      );
      for (let s = 0; s < 4; s++) {
        if (s !== q) {
          table.room.sendTo(
            s,
            P.event(
              P.evOtherPlayerDrew({
                player: P.seatWind(q, ctx.dealer),
                remaining: ctx.poolTotal(),
              })
            )
          );
        }
      }

      if (wantTsumo && qp.isCpu) {
        table.settlePowerHook({ type: 'tsumo', winner: q, tag: 'RINSHAN' });
        return {
          end: true,
          winner: q,
          winBy: { type: 'tsumo', seat: q, winTile: rt, rinshan: true, haitei: false, first: false },
        };
      }
    }
  }

  const banned = kind === 'daiminkan' ? [] : [norm(tiles[0])];
  const disc = await table.discardAfterCall(q, qp, banned);
  table.broadcastPowerStatus();
  if (!disc) return { end: false, next: (q + 1) % 4 };
  if (disc.end) return disc;
  const houtei = ctx.poolTotal() === 0;
  const nextCall = await table.resolveCallWindow(q, disc.tile, { houtei });
  if (nextCall) return nextCall;
  return { end: false, next: (q + 1) % 4 };
}

async function doOpenChi(table, q, from, tile, chosen) {
  const ctx = table.ctx;
  const qp = ctx.players[q];
  // Validate the client's chosen pair BEFORE touching the hand. The old code
  // spliced tiles out one by one and then returned null on failure, leaving
  // a partially mutated hand.
  if (!Array.isArray(chosen) || chosen.length !== 2) {
    table.sendError(q, 'InvalidAction', 'chi requires exactly 2 hand tiles');
    return null;
  }
  const legalOpts = H.chiOptions(qp.hand, tile).map(([a, b]) => {
    const s = norm(tile)[1];
    return [`${a}${s}`, `${b}${s}`].map(norm).sort().join(',');
  });
  const normChosen = chosen
    .map((c) => {
      const s = norm(tile)[1];
      // CPU claims carry bare ranks (e.g. 3); human claims carry protocol
      // codes ("3m"). Normalize both to a suit-bearing code before comparing.
      // Previously bare ranks were norm()'d as-is, so CPU chi never matched
      // any legal option and CPU seats could never chi.
      const code = typeof c === 'string' && /[mpsz]$/.test(c) ? c : `${c}${s}`;
      return norm(code);
    })
    .sort()
    .join(',');
  if (!legalOpts.includes(normChosen)) {
    table.sendError(q, 'InvalidAction', 'chosen chi tiles do not match any legal option');
    return null;
  }
  const tiles = [tile];
  const suit = norm(tile)[1];
  // Re-resolve indices without mutating until all are found.
  const indices = [];
  for (const n of chosen) {
    const target =
      typeof n === 'string' && (n.endsWith('m') || n.endsWith('p') || n.endsWith('s') || n.endsWith('z'))
        ? norm(n)
        : n + suit;
    const i = qp.hand.findIndex((x, idx) => !indices.includes(idx) && norm(x) === target);
    if (i < 0) {
      table.sendError(q, 'InvalidAction', 'chosen chi tile not in hand');
      return null;
    }
    indices.push(i);
  }
  // Remove highest indices first so earlier splices don't shift later ones.
  indices.sort((a, b) => b - a).forEach((i) => tiles.push(qp.hand.splice(i, 1)[0]));
  if (tiles.length !== 3) return null; // shouldn't happen (validated)
  ctx.players[from].discards.pop();
  qp.melds.push({ tiles, open: true, type: 'chi' });
  table.recordJournal(q, 'call', { kind: 'chi', tiles: [...tiles], from, called: tile });
  table.broadcast(
    P.evPlayerCalled({
      player: P.seatWind(q, ctx.dealer),
      fromPlayer: P.seatWind(from, ctx.dealer),
      callType: 'Chi',
      calledTile: P.sakiToTile(tile),
      tiles: P.tilesToProtocol(tiles),
    })
  );
  console.log(`[bridge] P${q} CHI ${tile} [${chosen.join('+')}]`);
  ctx.callsMade++;
  H.clearAllIppatsu(ctx.players);

  if (!qp.isCpu) {
    table.room.sendTo(q, P.event(P.evHandUpdated({ hand: P.tilesToProtocol([...qp.hand]) })));
  }

  const banned = H.kuikaeBannedChi(tiles[1], tiles[2]);
  const disc = await table.discardAfterCall(q, qp, banned);
  table.broadcastPowerStatus();
  if (!disc) return { end: false, next: (q + 1) % 4 };
  const houtei = ctx.poolTotal() === 0;
  const nextCall = await table.resolveCallWindow(q, disc.tile, { houtei });
  if (nextCall) return nextCall;
  return { end: false, next: (q + 1) % 4 };
}

module.exports = {
  collectRon,
  resolveCallWindow,
  removeCopies,
  doOpenCall,
  doOpenChi,
};
