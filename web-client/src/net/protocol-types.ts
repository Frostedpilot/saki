export type { ProtocolTile } from '../tiles/tile-utils';
import type { ProtocolTile } from '../tiles/tile-utils';

export interface RoomSeatHuman {
  kind: 'human';
  name: string;
}

export interface RoomSeatCpu {
  kind: 'cpu';
  level: string;
  personality: string;
}

export type RoomSeat = RoomSeatHuman | RoomSeatCpu | null;

export interface RoomStatePayload {
  code: string;
  seats: RoomSeat[];
  host_seat: number;
  your_seat: number;
  post_game: boolean;
  returned_to_lobby: boolean[];
  rules?: Record<string, unknown>;
  length?: string;
  cpu_configs?: Array<{ level: string; personality: string }>;
  power_seats?: string[];
}

export interface GameStartedEvent {
  seat_wind: 'East' | 'South' | 'West' | 'North';
  hand: ProtocolTile[];
  scores: number[];
  round_wind: 'East' | 'South' | 'West' | 'North';
  dora_indicators: ProtocolTile[];
  round_number: number;
  total_rounds: number;
  honba: number;
  riichi_sticks: number;
  three_player: boolean;
  nuki_dora: boolean;
}

export interface TileDrawnEvent {
  tile: ProtocolTile;
  remaining_tiles: number;
  can_tsumo: boolean;
  can_riichi: boolean;
  is_furiten: boolean;
}

export interface OtherPlayerDrewEvent {
  player: number;
  remaining_tiles: number;
}

export interface TileDiscardedEvent {
  player: number;
  tile: ProtocolTile;
  is_tsumogiri?: boolean;
  hand_index?: number;
}

export interface CallAvailableEvent {
  tile: ProtocolTile;
  discarder: number;
  calls: string[]; // e.g. ['Chi', 'Pon', 'Kan', 'Ron']
}

export interface PlayerCalledEvent {
  player: number;
  call_type: string;
  called_tile: ProtocolTile;
  tiles: ProtocolTile[];
  from_player?: number | string;
}

export interface DoraIndicatorsUpdatedEvent {
  dora_indicators: ProtocolTile[];
}

export interface PlayerRiichiEvent {
  player: number;
  scores: number[];
  riichi_sticks: number;
}

export interface HandUpdatedEvent {
  hand: ProtocolTile[];
}

export interface PlayerHandInfo {
  wind: string;
  hand: ProtocolTile[];
  melds: Array<{ call_type: string; tiles: ProtocolTile[] }>;
  pei?: unknown[];
}

export interface RoundWonEvent {
  winner: number | string;
  loser?: number | string | null;
  winning_tile: ProtocolTile;
  scores: number[];
  yaku_list: Array<{ name: string; han: number } | [{ Yaku?: string; Dora?: string }, number] | any>;
  han: number;
  fu: number;
  score_points: number;
  rank?: string;
  has_opened?: boolean;
  uradora_indicators?: ProtocolTile[];
  riichi_sticks?: number;
  honba?: number;
  honba_points?: number;
  player_hands?: PlayerHandInfo[];
}

export interface RoundDrawEvent {
  scores: number[];
  reason: string;
  tenpai?: boolean[];
  riichi_sticks?: number;
  declarer?: number | null;
}

export interface TierInfo {
  tier: number;
  name: string;
  cost: number;
  canAfford: boolean;
  canActivate: boolean;
}

export interface SuperpowerIndicatorEvent {
  seat: number;
  power: string;
  active: boolean;
  type?: 'flow' | 'normal';
  gauge?: number | null; // 0..100, or null for normal-type powers (no meter)
  description?: string;
  armed_tier?: number;
  available_tiers?: TierInfo[];
}

export interface PowerActivatedEvent {
  player: number;
  power: string;
  tier?: number;
  event_type?: string;
}

export type ServerEvent =
  | { GameStarted: GameStartedEvent }
  | { TileDrawn: TileDrawnEvent }
  | { OtherPlayerDrew: OtherPlayerDrewEvent }
  | { TileDiscarded: TileDiscardedEvent }
  | { CallAvailable: CallAvailableEvent }
  | { PlayerCalled: PlayerCalledEvent }
  | { DoraIndicatorsUpdated: DoraIndicatorsUpdatedEvent }
  | { PlayerRiichi: PlayerRiichiEvent }
  | { HandUpdated: HandUpdatedEvent }
  | { RoundWon: RoundWonEvent }
  | { RoundDraw: RoundDrawEvent }
  | { SuperpowerIndicator: SuperpowerIndicatorEvent }
  | { PowerActivated: PowerActivatedEvent };

export type ServerMessage =
  | { Welcome: { session_token: string; protocol_version: number } }
  | { RoomState: RoomStatePayload }
  | { Event: ServerEvent }
  | { GameOver: { final_scores: number[] } }
  | { Error: { code: string; message: string } }
  | { TurnTimer: { seconds: number } };

export type ClientMessage =
  | { Hello: { display_name: string; protocol_version?: number } }
  | { CreateRoom: { length: string; rules: Record<string, unknown> } }
  | { JoinRoom: { code: string } }
  | 'LeaveRoom'
  | { SetCpuConfigs: { cpu_configs: Array<{ level: string; personality: string }> } }
  | { SetPowers: { power_seats: string[] } }
  | { SelectPowerTier: { tier: number } }
  | { StartGame: Record<string, unknown> }
  | { Action: ClientAction }
  | 'ReadyNextRound'
  | 'ReturnToLobby';

export type ClientAction =
  | { Discard: { tile: ProtocolTile } }
  | { Riichi: { tile: ProtocolTile } }
  | 'Tsumo'
  | 'Ron'
  | 'Pass'
  | { Chi: { tiles: ProtocolTile[] } }
  | { Pon: { tiles: ProtocolTile[] } }
  | { Kan: { tile_index: number } }
  | { NineTerminals: { declare: boolean } }
  | { SelectPowerTier: { tier: number } };
