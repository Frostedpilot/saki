'use strict';
// protocol.js — serde-shaped JSON for the riichi_mahjong_rs protocol v6.
// Mirrors:
//   crates/mahjong-server/src/protocol/mod.rs (ServerEvent / ClientAction)
//   crates/mahjong-server/src/protocol/net.rs  (ServerMessage / ClientMessage)
//
// Serde conventions (externally tagged enums):
//   unit variant      -> "VariantName"                      e.g. "Pass"
//   newtype variant   -> {"VariantName": value}             e.g. {"Dora":"RedDora"}
//   struct variant    -> {"VariantName":{"field": ...}}     e.g. {"TileDrawn":{...}}
// Tiles are {"index":0..33, "red_dora":bool}; index is the kind (0m indexes 4).

const PROTOCOL_VERSION = 6;

// ---------------------------------------------------------------- tile codec
const SUIT_OFFSET = { m: 0, p: 1, s: 2 };

// "5m" -> {index:4, red_dora:false}; "0p" -> {index:13, red_dora:true}
function sakiToTile(code) {
  const red = code[0] === '0';
  const n = red ? 5 : parseInt(code[0], 10);
  const s = code[1];
  const index = s === 'z' ? 27 + n - 1 : SUIT_OFFSET[s] * 9 + (n - 1);
  return { index, red_dora: red };
}

// {index:4, red_dora:true} -> "0m"; {index:27,...} -> "1z"
function tileToSaki(tile) {
  if (!tile || typeof tile.index !== 'number') return null;
  const { index, red_dora } = tile;
  if (index >= 27) return (index - 27 + 1) + 'z';
  const s = 'mps'[Math.floor(index / 9)];
  const n = (index % 9) + 1;
  return red_dora && n === 5 ? '0' + s : n + s;
}

function tilesToSaki(tiles) { return (tiles || []).map(tileToSaki).filter(Boolean); }
function tilesToProtocol(tiles) { return (tiles || []).map(sakiToTile); }

// ------------------------------------------------------------------ winds
const WINDS = ['East', 'South', 'West', 'North'];
// Seat wind of `seat` relative to `dealer` (dealer's seat is East).
function seatWind(seat, dealer) { return WINDS[(seat - dealer + 4) % 4]; }
// 1..4 jikaze digit used by the riichi lib (East=1 relative to dealer).
function jikazeOf(seat, dealer) { return ((seat - dealer + 4) % 4) + 1; }

// ---------------------------------------------------------- server messages
function welcome(sessionToken) {
  return { Welcome: { session_token: sessionToken, protocol_version: PROTOCOL_VERSION } };
}

function roomState(opts) {
  const msg = {
    code: opts.code,
    seats: opts.seats,
    host_seat: opts.hostSeat,
    your_seat: opts.yourSeat,
    post_game: !!opts.postGame,
    returned_to_lobby: opts.returnedToLobby || [false, false, false, false],
  };
  // Field-present-or-absent matters: the client falls back to its defaults
  // when these are missing (serde #[serde(default)]), so an empty rules {}
  // object is fine.
  msg.rules = opts.rules !== undefined ? opts.rules : {};
  msg.length = opts.length || 'EastOnly';
  if (opts.cpuConfigs) msg.cpu_configs = opts.cpuConfigs;
  if (opts.powerSeats) msg.power_seats = opts.powerSeats;
  return { RoomState: msg };
}

function event(ev) { return { Event: ev }; }
function gameOver(finalScores) { return { GameOver: { final_scores: finalScores } }; }
function errorMessage(code, message) { return { Error: { code, message } }; }
function turnTimer(seconds) { return { TurnTimer: { seconds } }; }

// ----------------------------------------------------------- server events
function evGameStarted(opts) {
  return {
    GameStarted: {
      seat_wind: opts.seatWind || opts.seat_wind,
      hand: opts.hand,
      scores: opts.scores,
      round_wind: opts.roundWind || opts.round_wind,
      dora_indicators: opts.doraIndicators || opts.dora_indicators,
      round_number: opts.roundNumber !== undefined ? opts.roundNumber : opts.round_number,
      total_rounds: opts.totalRounds !== undefined ? opts.totalRounds : opts.total_rounds,
      honba: opts.honba,
      riichi_sticks: opts.riichiSticks !== undefined ? opts.riichiSticks : opts.riichi_sticks,
      three_player: !!(opts.threePlayer !== undefined ? opts.threePlayer : opts.three_player),
      nuki_dora: !!(opts.nukiDora !== undefined ? opts.nukiDora : opts.nuki_dora),
    },
  };
}

function evTileDrawn(opts) {
  return {
    TileDrawn: {
      tile: opts.tile,
      remaining_tiles: opts.remaining !== undefined ? opts.remaining : opts.remaining_tiles,
      can_tsumo: !!(opts.canTsumo !== undefined ? opts.canTsumo : opts.can_tsumo),
      can_riichi: !!(opts.canRiichi !== undefined ? opts.canRiichi : opts.can_riichi),
      is_furiten: !!(opts.isFuriten !== undefined ? opts.isFuriten : opts.is_furiten),
    },
  };
}

function evOtherPlayerDrew(opts) {
  return {
    OtherPlayerDrew: {
      player: opts.player,
      remaining_tiles: opts.remaining !== undefined ? opts.remaining : opts.remaining_tiles,
    },
  };
}

function evTileDiscarded(opts) {
  return {
    TileDiscarded: {
      player: opts.player,
      tile: opts.tile,
      is_tsumogiri: !!(opts.isTsumogiri !== undefined ? opts.isTsumogiri : opts.is_tsumogiri),
      hand_index: opts.handIndex !== undefined ? opts.handIndex : (opts.hand_index !== undefined ? opts.hand_index : null),
    },
  };
}

function evCallAvailable(opts) {
  return { CallAvailable: { tile: opts.tile, discarder: opts.discarder, calls: opts.calls } };
}

function evPlayerCalled(opts) {
  return {
    PlayerCalled: {
      player: opts.player,
      call_type: opts.callType || opts.call_type,
      called_tile: opts.calledTile !== undefined ? opts.calledTile : opts.called_tile,
      tiles: opts.tiles,
      from_player: opts.fromPlayer !== undefined ? opts.fromPlayer : opts.from_player,
    },
  };
}

function evDoraIndicatorsUpdated(opts) {
  return { DoraIndicatorsUpdated: { dora_indicators: opts.doraIndicators || opts.dora_indicators } };
}

function evPlayerRiichi(opts) {
  return { PlayerRiichi: { player: opts.player, scores: opts.scores, riichi_sticks: opts.riichiSticks !== undefined ? opts.riichiSticks : opts.riichi_sticks } };
}

function evHandUpdated(opts) {
  return { HandUpdated: { hand: opts.hand } };
}

function evRoundWon(opts) {
  return {
    RoundWon: {
      winner: opts.winner,
      loser: opts.loser !== undefined ? opts.loser : null,
      winning_tile: opts.winningTile !== undefined ? opts.winningTile : opts.winning_tile,
      scores: opts.scores,
      yaku_list: opts.yakuList || opts.yaku_list || [],
      han: opts.han,
      fu: opts.fu,
      score_points: opts.scorePoints !== undefined ? opts.scorePoints : opts.score_points,
      rank: opts.rank,
      has_opened: !!(opts.hasOpened !== undefined ? opts.hasOpened : opts.has_opened),
      uradora_indicators: opts.uradoraIndicators || opts.uradora_indicators || [],
      riichi_sticks: opts.riichiSticks !== undefined ? opts.riichiSticks : (opts.riichi_sticks !== undefined ? opts.riichi_sticks : 0),
      honba: opts.honba,
      honba_points: opts.honbaPoints !== undefined ? opts.honbaPoints : (opts.honba_points !== undefined ? opts.honba_points : 0),
      player_hands: opts.playerHands || opts.player_hands || [],
    },
  };
}

function evRoundDraw(opts) {
  return {
    RoundDraw: {
      scores: opts.scores,
      reason: opts.reason,
      tenpai: opts.tenpai,
      riichi_sticks: opts.riichiSticks !== undefined ? opts.riichiSticks : (opts.riichi_sticks !== undefined ? opts.riichi_sticks : 0),
      player_hands: opts.playerHands || opts.player_hands || [],
      declarer: opts.declarer === null || opts.declarer === undefined ? null : opts.declarer,
    },
  };
}

function evPlayerConnectionChanged(opts) {
  return { PlayerConnectionChanged: { seat: opts.seat, connected: opts.connected } };
}

function evPowerActivated({ player, power, tier, eventType }) {
  return {
    PowerActivated: {
      player,
      power,
      tier: tier || 0,
      event_type: eventType || '',
    },
  };
}

function evSuperpowerIndicator({ seat, active, gauge, description, power, armedTier, availableTiers, type }) {
  return {
    SuperpowerIndicator: {
      seat,
      active: !!active,
      type: type || 'flow',
      gauge: gauge !== undefined && gauge !== null ? gauge : null,
      description: description || '',
      power: power || '',
      armed_tier: armedTier !== undefined ? armedTier : 0,
      available_tiers: availableTiers || [],
    },
  };
}

// ---------------------------------------------------------- client messages
// Parses a raw JSON text into a normalized client message.
// Returns { ok:true, kind, ... } or { ok:false }.
function parseClientMessage(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { return { ok: false }; }

  // Unit variants are bare strings.
  if (raw === 'LeaveRoom') return { ok: true, kind: 'LeaveRoom' };
  if (raw === 'ReadyNextRound') return { ok: true, kind: 'ReadyNextRound' };
  if (raw === 'ReturnToLobby') return { ok: true, kind: 'ReturnToLobby' };

  if (typeof raw !== 'object' || raw === null) return { ok: false };
  const keys = Object.keys(raw);
  if (keys.length !== 1) return { ok: false };
  const kind = keys[0];
  const payload = raw[kind] || {};

  switch (kind) {
    case 'Hello':
      return {
        ok: true, kind,
        protocol_version: payload.protocol_version,
        session_token: payload.session_token ?? null,
        display_name: payload.display_name ?? '',
      };
    case 'CreateRoom':
      return { ok: true, kind, length: payload.length ?? 'EastOnly', rules: payload.rules ?? {} };
    case 'JoinRoom':
      return { ok: true, kind, code: String(payload.code ?? '').toUpperCase() };
    case 'SetCpuConfigs':
      return { ok: true, kind, cpu_configs: payload.cpu_configs ?? null };
    case 'SetPowers':
      return { ok: true, kind, power_seats: payload.power_seats ?? null };
    case 'SelectPowerTier':
      return { ok: true, kind, tier: typeof payload.tier === 'number' ? payload.tier : 0 };
    case 'StartGame':
      return { ok: true, kind, cpu_configs: payload.cpu_configs ?? null };
    case 'Action':
      return parseAction(payload);
    default:
      return { ok: false };
  }
}

function parseAction(payload) {
  if (payload === 'Tsumo') return { ok: true, kind: 'Action', action: { type: 'Tsumo' } };
  if (payload === 'Ron') return { ok: true, kind: 'Action', action: { type: 'Ron' } };
  if (payload === 'Pass') return { ok: true, kind: 'Action', action: { type: 'Pass' } };
  if (payload === 'Pei') return { ok: true, kind: 'Action', action: { type: 'Pei' } };
  if (typeof payload !== 'object' || payload === null) return { ok: false };
  const k = Object.keys(payload)[0];
  const p = payload[k] || {};
  switch (k) {
    case 'Discard': return { ok: true, kind: 'Action', action: { type: 'Discard', tile: p.tile ? tileToSaki(p.tile) : null } };
    case 'Riichi': return { ok: true, kind: 'Action', action: { type: 'Riichi', tile: p.tile ? tileToSaki(p.tile) : null } };
    case 'Chi': return { ok: true, kind: 'Action', action: { type: 'Chi', tiles: tilesToSaki(p.tiles) } };
    case 'Pon': return { ok: true, kind: 'Action', action: { type: 'Pon', tiles: tilesToSaki(p.tiles) } };
    case 'Kan': return { ok: true, kind: 'Action', action: { type: 'Kan', tile_index: p.tile_index ?? 0 } };
    case 'NineTerminals': return { ok: true, kind: 'Action', action: { type: 'NineTerminals', declare: !!p.declare } };
    case 'SelectPowerTier': return { ok: true, kind: 'Action', action: { type: 'SelectPowerTier', tier: typeof p.tier === 'number' ? p.tier : 0 } };
    default: return { ok: false };
  }
}

module.exports = {
  PROTOCOL_VERSION,
  WINDS,
  sakiToTile,
  tileToSaki,
  tilesToSaki,
  tilesToProtocol,
  seatWind,
  jikazeOf,
  welcome,
  roomState,
  event,
  gameOver,
  errorMessage,
  turnTimer,
  evGameStarted,
  evTileDrawn,
  evOtherPlayerDrew,
  evTileDiscarded,
  evCallAvailable,
  evPlayerCalled,
  evDoraIndicatorsUpdated,
  evPlayerRiichi,
  evHandUpdated,
  evRoundWon,
  evRoundDraw,
  evPlayerConnectionChanged,
  evPowerActivated,
  evSuperpowerIndicator,
  parseClientMessage,
};