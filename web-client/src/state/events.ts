// Wire event -> store state. Extracted from store.ts (KI-11): the reducer is
// the biggest single block in the client and does not need the socket, so it
// lives next to the store instead of inside it.
import type { GameStore, PlayerMeld } from './store';
import {
  CallAvailableEvent,
  GameStartedEvent,
  OtherPlayerDrewEvent,
  PlayerCalledEvent,
  PlayerRiichiEvent,
  PowerActivatedEvent,
  ProtocolTile,
  RoundDrawEvent,
  RoundWonEvent,
  SuperpowerIndicatorEvent,
  TileDiscardedEvent,
  TileDrawnEvent,
} from '../net/protocol-types';
import { areTilesEqual, getKuikaeBannedIndices, sortTiles, tileToFace } from '../tiles/tile-utils';

export function applyGameEvent(store: GameStore, ev: any): void {
  if ('GameStarted' in ev) {
    const gs: GameStartedEvent = ev.GameStarted;
    store.screen = 'game';
    store.yourSeatWind = gs.seat_wind;
    store.roundWind = gs.round_wind;
    store.roundNumber = gs.round_number;
    store.totalRounds = gs.total_rounds;
    store.honba = gs.honba;
    store.riichiSticks = gs.riichi_sticks;
    store.scores = gs.scores;
    store.doraIndicators = gs.dora_indicators;
    store.hand = sortTiles(gs.hand);
    store.drawnTile = null;
    store.discards = [[], [], [], []];
    store.melds = [[], [], [], []];
    store.riichiDeclared = [false, false, false, false];
    store.opponentTileCounts = [13, 13, 13, 13];
    store.roundEndModal = null;
    store.isGameOver = false;
    store.currentTurn = store.dealerSeat;
    store.kuikaeBannedIndices = [];
    store.resetCalls();
    store.addLog(
      'turn',
      `Round ${gs.round_wind} ${gs.round_number} (Honba ${gs.honba}) started. Dealer: ${store.getSeatName(store.dealerSeat)}. Dora indicator: [${tileToFace(gs.dora_indicators[0])}].`
    );
    store.notify();
    return;
  }

  if ('TileDrawn' in ev) {
    const td: TileDrawnEvent = ev.TileDrawn;
    store.currentTurn = store.yourSeat;
    store.remainingTiles = td.remaining_tiles;
    store.drawnTile = td.tile;
    store.kuikaeBannedIndices = [];
    store.actions.can_discard = true;
    store.actions.can_tsumo = td.can_tsumo;
    store.actions.can_riichi = Boolean(td.can_riichi && !store.riichiDeclared[store.yourSeat]);
    store.isRiichiMode = false;
    store.riichiCandidateIndices.clear();

    // Check for own-turn Kan (Ankan 4 of a kind or Kakan pon upgrade)
    const allTiles = [...store.hand, td.tile];
    const counts: Record<number, number> = {};
    allTiles.forEach((t) => {
      counts[t.index] = (counts[t.index] || 0) + 1;
    });
    const ankanKey = Object.keys(counts).find((k) => counts[parseInt(k, 10)] === 4);
    const kakanMatch = store.melds[store.yourSeat].find(
      (m) => (m.callType === 'Pon' || m.callType === 'pon') && allTiles.some((t) => t.index === m.tiles[0]?.index)
    );
    // Kakan (pon upgrade) is never legal in riichi (chombo), so in riichi only
    // a closed ankan quartet may offer Kan. The server still validates waits.
    const inRiichiDraw = store.riichiDeclared[store.yourSeat];
    store.actions.can_kan = Boolean(ankanKey !== undefined || (!inRiichiDraw && kakanMatch));
    // Remember the actual tile index for the KAN action instead of always
    // sending 0. Prefer the ankan quartet; otherwise use the kakan tile.
    if (ankanKey !== undefined) store.pendingKanIndex = parseInt(ankanKey, 10);
    else if (kakanMatch?.tiles[0]) store.pendingKanIndex = kakanMatch.tiles[0].index;
    else store.pendingKanIndex = td.tile.index;

    store.addLog('turn', `You drew ${tileToFace(td.tile)}. Wall remaining: ${td.remaining_tiles}.`);
    if (td.is_furiten) {
      store.addLog(
        'rule',
        'Furiten Warning: You are in Furiten!',
        "Your discard river contains one of your winning waits. You cannot declare Ron off other players' discards. You can only win by self-draw (Tsumo)."
      );
    }
    if (td.can_tsumo) {
      store.addLog('win', `Tsumo Available on ${tileToFace(td.tile)}!`);
    } else if (td.can_tsumo_reason === 'no-yaku') {
      store.addLog('rule', `No tsumo: hand complete but no yaku on ${tileToFace(td.tile)}.`);
    } else if (td.can_tsumo_reason === 'shibari') {
      store.addLog('rule', `No tsumo: ryanhan-shibari needs 2+ han on ${tileToFace(td.tile)}.`);
    }
    if (td.can_riichi) {
      store.addLog('call', 'Riichi Available! Closed hand is in Tenpai.');
    }

    // Riichi tsumogiri fast path: in riichi the drawn tile is the only legal
    // discard, so when there is nothing to decide (no tsumo, no ankan quartet
    // to consider) discard it immediately instead of waiting for a manual
    // TSUMOGIRI click. Kakan is never legal in riichi, so it must not block
    // the fast path.
    if (store.riichiDeclared[store.yourSeat] && !td.can_tsumo && ankanKey === undefined) {
      store.addLog('turn', `Riichi tsumogiri: auto-discarded ${tileToFace(td.tile)}.`);
      store.discard(td.tile);
      return;
    }

    store.notify();
    return;
  }

  if ('OtherPlayerDrew' in ev) {
    const op: OtherPlayerDrewEvent = ev.OtherPlayerDrew;
    const seat = store.playerToSeat(op.player);
    store.currentTurn = seat;
    store.remainingTiles = op.remaining_tiles;
    store.resetTurnActions();
    store.resetCalls();
    store.drawnTile = null;
    store.opponentTileCounts[seat] = (store.opponentTileCounts[seat] || 13) + 1;
    store.addLog('turn', `${store.getSeatName(seat)} drew a tile. (Wall: ${op.remaining_tiles})`);
    store.notify();
    return;
  }

  if ('TileDiscarded' in ev) {
    const td: TileDiscardedEvent = ev.TileDiscarded;
    const seat = store.playerToSeat(td.player);
    store.lastDiscarderSeat = seat;

    const isRiichiTile = Boolean(store.riichiDeclared[seat] && !store.discards[seat].some((d) => d.is_riichi));
    store.discards[seat].push({
      tile: td.tile,
      is_riichi: isRiichiTile,
    });
    store.lastDiscard = { seat, index: store.discards[seat].length - 1 };

    store.resetTurnActions();

    if (seat === store.yourSeat) {
      store.kuikaeBannedIndices = [];
      if (store.drawnTile && areTilesEqual(store.drawnTile, td.tile)) {
        store.drawnTile = null;
      } else {
        const idx = store.hand.findIndex((t) => areTilesEqual(t, td.tile));
        if (idx >= 0) store.hand.splice(idx, 1);
        if (store.drawnTile) {
          store.hand.push(store.drawnTile);
          store.drawnTile = null;
          store.hand = sortTiles(store.hand);
        }
      }
    } else {
      store.opponentTileCounts[seat] = Math.max(0, (store.opponentTileCounts[seat] || 1) - 1);
    }

    const isTsumogiri = td.is_tsumogiri ? ' (tsumogiri)' : '';
    store.addLog(
      'turn',
      `${seat === store.yourSeat ? 'You' : store.getSeatName(seat)} discarded ${tileToFace(td.tile)}${isTsumogiri}.`
    );

    store.notify();
    return;
  }

  if ('CallAvailable' in ev) {
    const ca: CallAvailableEvent = ev.CallAvailable;
    store.actions.last_call_tile = ca.tile;
    store.actions.can_ron = false;
    store.actions.can_pon = false;
    store.actions.can_chi = false;
    store.actions.can_kan = false;
    store.actions.chi_options = [];
    store.actions.pon_options = [];

    const callTypes: string[] = [];
    if (Array.isArray(ca.calls)) {
      for (const c of ca.calls) {
        if (typeof c === 'string') {
          if (c === 'Ron') {
            store.actions.can_ron = true;
            callTypes.push('Ron');
          }
          if (c === 'Kan' || c === 'Daiminkan') {
            store.actions.can_kan = true;
            callTypes.push('Kan');
          }
        }
        if (typeof c === 'object' && c !== null) {
          if ('Pon' in c) {
            store.actions.can_pon = true;
            store.actions.pon_options = (c as any).Pon?.options || [];
            callTypes.push('Pon');
          }
          if ('Chi' in c) {
            store.actions.can_chi = true;
            store.actions.chi_options = (c as any).Chi?.options || [];
            callTypes.push('Chi');
          }
        }
      }
    }

    store.addLog(
      'call',
      `Call Available on discarded ${tileToFace(ca.tile)} from ${ca.discarder}: [${callTypes.join(', ')}]`
    );

    store.notify();
    return;
  }

  if ('PlayerCalled' in ev) {
    const pc: PlayerCalledEvent = ev.PlayerCalled;
    const callerSeat = store.playerToSeat(pc.player);
    const fromSeat = pc.from_player !== undefined ? store.playerToSeat(pc.from_player) : store.lastDiscarderSeat;

    const rel = fromSeat >= 0 ? (fromSeat - callerSeat + 4) % 4 : 3;
    const isAnkan = pc.call_type === 'Ankan' || pc.call_type === 'ClosedKan';
    const isKakan = pc.call_type === 'Kakan';

    let calledIdx: number;
    let orderedTiles: ProtocolTile[];

    if (isAnkan) {
      calledIdx = -1;
      orderedTiles = [...(pc.tiles || [])];
    } else if (isKakan) {
      const existingMeld = store.melds[callerSeat].find(
        (m) => (m.callType === 'Pon' || m.callType === 'pon') && m.tiles[0]?.index === pc.called_tile?.index
      );
      if (existingMeld) {
        existingMeld.callType = 'Kakan';
        if (pc.tiles && pc.tiles.length === 4) {
          existingMeld.tiles = pc.tiles;
        } else if (pc.called_tile) {
          existingMeld.tiles.push(pc.called_tile);
        }
        orderedTiles = existingMeld.tiles;
        calledIdx = existingMeld.calledIndex ?? 1;
      } else {
        orderedTiles = [...(pc.tiles || [])];
        calledIdx = 1;
      }
    } else {
      const totalCount = pc.tiles?.length || 3;
      if (rel === 3) {
        calledIdx = 0; // Kamicha (left)
      } else if (rel === 2) {
        calledIdx = 1; // Toimen (across)
      } else if (rel === 1) {
        calledIdx = totalCount - 1; // Shimocha (right)
      } else {
        calledIdx = 0;
      }

      const pool = [...(pc.tiles || [])];
      const matchIdx = pool.findIndex((t) => areTilesEqual(t, pc.called_tile));
      const calledTile = matchIdx >= 0 ? pool.splice(matchIdx, 1)[0] : pc.called_tile;
      pool.sort((a, b) => a.index - b.index);
      pool.splice(calledIdx, 0, calledTile);
      orderedTiles = pool;
    }

    if (!isKakan) {
      store.melds[callerSeat].push({
        callType: pc.call_type,
        calledTile: pc.called_tile,
        tiles: orderedTiles,
        calledIndex: calledIdx,
        fromSeat,
      });
    }

    const callType = String(pc.call_type || '').toLowerCase();

    // Keep the concealed-hand count in sync. TileDiscarded only decrements on
    // discards, so without this the count drifts high after every call.
    if (callerSeat !== store.yourSeat) {
      const taken =
        callType === 'chi' || callType === 'pon'
          ? 2
          : callType === 'daiminkan'
            ? 3
            : callType === 'ankan' || callType === 'closedkan'
              ? 4
              : callType === 'kakan'
                ? 1
                : 0;
      store.opponentTileCounts[callerSeat] = Math.max(0, (store.opponentTileCounts[callerSeat] || 0) - taken);
    }

    // Remove the called tile from the discarder's river — but only for calls
    // that genuinely consumed another player's discard. Ankan and kakan take
    // the tile from the caller's own hand, so `lastDiscarderSeat` is stale for
    // them and popping it deleted an unrelated player's river tile.
    const consumedDiscard = callType === 'chi' || callType === 'pon' || callType === 'daiminkan';
    if (consumedDiscard && store.lastDiscarderSeat >= 0 && store.discards[store.lastDiscarderSeat]?.length > 0) {
      store.discards[store.lastDiscarderSeat].pop();
      if (store.lastDiscard && store.lastDiscard.seat === store.lastDiscarderSeat) {
        store.lastDiscard = null;
      }
    }

    if (callerSeat === store.yourSeat) {
      if (pc.call_type === 'Chi' && pc.called_tile && pc.tiles) {
        const handTiles = pc.tiles.filter((t) => !areTilesEqual(t, pc.called_tile));
        store.kuikaeBannedIndices = getKuikaeBannedIndices(pc.called_tile, handTiles);
      } else if (pc.call_type === 'Pon' && pc.called_tile) {
        store.kuikaeBannedIndices = [pc.called_tile.index];
      }
    }

    const tileFaces = (orderedTiles || []).map(tileToFace).join(', ');
    // An ankan (and a kakan that only carries the caller's own fourth tile)
    // has no `called_tile`; `tileToFace(undefined)` would throw inside the
    // message handler and swallow the rest of the event.
    const target = pc.called_tile ? ` on ${tileToFace(pc.called_tile)}` : '';
    store.addLog(
      'call',
      `${callerSeat === store.yourSeat ? 'You' : store.getSeatName(callerSeat)} called ${pc.call_type}${target}! [${tileFaces}]`
    );

    store.currentTurn = callerSeat;
    store.resetCalls();
    store.resetTurnActions();
    store.notify();
    return;
  }

  if ('PlayerRiichi' in ev) {
    const pr: PlayerRiichiEvent = ev.PlayerRiichi;
    const seat = store.playerToSeat(pr.player);
    store.riichiDeclared[seat] = true;
    store.scores = pr.scores;
    store.riichiSticks = pr.riichi_sticks;
    if (seat === store.yourSeat) {
      store.actions.can_riichi = false;
      store.isRiichiMode = false;
      store.riichiCandidateIndices.clear();
    }
    store.addLog(
      'call',
      `${seat === store.yourSeat ? 'You' : store.getSeatName(seat)} declared RIICHI! 1,000 pt stick placed on center.`
    );
    store.notify();
    return;
  }

  if ('DoraIndicatorsUpdated' in ev) {
    store.doraIndicators = ev.DoraIndicatorsUpdated.dora_indicators;
    const indicators = store.doraIndicators.map(tileToFace).join(', ');
    store.addLog('turn', `New Dora Indicator revealed: [${indicators}]`);
    store.notify();
    return;
  }

  if ('HandUpdated' in ev) {
    store.hand = sortTiles(ev.HandUpdated.hand);
    store.drawnTile = null;
    store.actions.can_discard = true;
    store.notify();
    return;
  }

  if ('RoundWon' in ev) {
    const rw: RoundWonEvent = ev.RoundWon;
    const winnerSeat = store.playerToSeat(rw.winner);
    const loserSeat = rw.loser !== undefined && rw.loser !== null ? store.playerToSeat(rw.loser) : null;
    const isTsumo = loserSeat === null;
    const isYouWinner = winnerSeat === store.yourSeat;
    const prevScore = store.scores[store.yourSeat];
    store.scores = rw.scores;
    const delta = (store.scores[store.yourSeat] || 0) - (prevScore || 0);

    const winnerName = isYouWinner ? 'You' : store.seats[winnerSeat]?.name || `CPU ${winnerSeat}`;
    const title = isYouWinner
      ? `Agari! You Won (+${rw.score_points} pts)`
      : `${winnerName} Won (${!isTsumo && loserSeat !== null ? `Ron from ${loserSeat === store.yourSeat ? 'You' : store.seats[loserSeat]?.name || `CPU ${loserSeat}`}` : 'Tsumo'})`;

    // Server sends player_hands indexed by absolute seat 0..3.
    const handInfo = Array.isArray((rw as any).player_hands) ? (rw as any).player_hands[winnerSeat] : undefined;
    const winningHand: ProtocolTile[] | undefined = handInfo?.hand
      ? sortTiles([...handInfo.hand])
      : isYouWinner
        ? sortTiles([...store.hand, ...(store.drawnTile ? [store.drawnTile] : [])])
        : undefined;
    const winningMelds: PlayerMeld[] | undefined = handInfo?.melds
      ? handInfo.melds.map((m: any) => ({
          callType: m.call_type || 'Pon',
          tiles: [...(m.tiles || [])],
        }))
      : isYouWinner
        ? store.melds[winnerSeat]?.map((m) => ({ ...m, tiles: [...m.tiles] }))
        : undefined;

    store.roundEndModal = {
      title,
      delta,
      scores: rw.scores,
      yakuList: store.normalizeYakuList(rw.yaku_list),
      han: rw.han,
      fu: rw.fu,
      points: rw.score_points,
      winningTile: rw.winning_tile,
      winningHand,
      winningMelds,
      isTsumo,
      winnerSeat,
      loserSeat,
      honba: (rw as any).honba,
      honbaPoints: (rw as any).honba_points,
      riichiSticks: (rw as any).riichi_sticks,
      rank: (rw as any).rank,
    };
    store.resetCalls();
    store.resetTurnActions();

    const yakuNames = (store.roundEndModal.yakuList || []).map((y) => `${y.name} (${y.han} han)`).join(', ');
    store.addLog(
      'win',
      `🏆 Round Won by ${store.getSeatName(winnerSeat)} via ${isTsumo ? 'TSUMO' : `RON off ${rw.loser}`}! (+${rw.score_points} pts)`,
      yakuNames ? `Yaku: ${yakuNames}` : undefined
    );

    store.notify();
    return;
  }

  if ('RoundDraw' in ev) {
    const rd: RoundDrawEvent = ev.RoundDraw;
    const prevScore = store.scores[store.yourSeat];
    store.scores = rd.scores;
    const delta = (store.scores[store.yourSeat] || 0) - (prevScore || 0);

    const tenpaiSeats = (rd.tenpai || []).map((p: any) => store.playerToSeat(p));
    const youTenpai = tenpaiSeats.includes(store.yourSeat);

    store.roundEndModal = {
      title: `Draw: ${rd.reason} (${youTenpai ? 'You were Tenpai' : 'You were Noten'})`,
      delta,
      scores: rd.scores,
    };
    store.resetCalls();
    store.resetTurnActions();

    const tenpaiNames = tenpaiSeats.map((s: number) => store.getSeatName(s)).join(', ');
    store.addLog('turn', `Round ended in ${rd.reason} Draw (Ryuukyoku). Tenpai: [${tenpaiNames || 'None'}]`);

    store.notify();
    return;
  }

  if ('SuperpowerIndicator' in ev) {
    const spi: SuperpowerIndicatorEvent = ev.SuperpowerIndicator;
    if (store.powers[spi.seat]) {
      store.powers[spi.seat].active = spi.active;
      if (spi.type) store.powers[spi.seat].type = spi.type;
      if (spi.type === 'normal') delete store.powers[spi.seat].gauge;
      else if (spi.gauge !== undefined && spi.gauge !== null) store.powers[spi.seat].gauge = spi.gauge;
      if (spi.description) store.powers[spi.seat].description = spi.description;
      if (spi.power) store.powers[spi.seat].power = spi.power;
      if (spi.armed_tier !== undefined) store.powers[spi.seat].armedTier = spi.armed_tier;
      if (spi.available_tiers !== undefined) store.powers[spi.seat].availableTiers = spi.available_tiers;
    }
    store.notify();
    return;
  }

  if ('PowerActivated' in ev) {
    const pa: PowerActivatedEvent = ev.PowerActivated;
    const seat = store.playerToSeat(pa.player);
    const charName = store.powerSeats[seat] || pa.power;
    if (store.powers[seat]) {
      store.powers[seat].active = true;
    }
    store.showCutin(`⚡ ${charName.toUpperCase()} AWAKENED!`, `${charName.toUpperCase()} activated superpower!`);
    store.addLog(
      'power',
      `⚡ ${store.getSeatName(seat)} (${charName.toUpperCase()}) activated ${pa.event_type} (Tier ${pa.tier})!`
    );
    store.notify();
    return;
  }
}
