import { GameSocket } from '../net/socket';
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
  ServerMessage,
  SuperpowerIndicatorEvent,
  TierInfo,
  TileDiscardedEvent,
  TileDrawnEvent,
} from '../net/protocol-types';
import {
  areTilesEqual,
  getKuikaeBannedIndices,
  sortTiles,
  tileToFace,
  TileFace,
  normFace,
  getDoraFromIndicator,
  hairiOfTiles,
  shantenOfTiles,
} from '../tiles/tile-utils';

export interface ToastMessage {
  id: number;
  text: string;
  type: 'info' | 'error' | 'power';
}

export interface GameLogEntry {
  id: string;
  timestamp: string;
  category: 'turn' | 'call' | 'power' | 'rule' | 'win';
  message: string;
  details?: string;
}

export interface PlayerActionHistory {
  id: string;
  seat: number;
  action: string;
  details?: string;
}

export interface PlayerDiscards {
  tile: ProtocolTile;
  is_riichi?: boolean;
  grayed?: boolean;
}

export interface MeldInfo {
  callType: string;
  calledTile?: ProtocolTile;
  tiles: ProtocolTile[];
  calledIndex?: number;
  fromSeat?: number;
}
export type PlayerMeld = MeldInfo;
export type { TierInfo };

export interface SuperpowerState {
  power: string;
  active: boolean;
  type?: 'flow' | 'normal';
  gauge?: number | null; // null for normal-type powers (no meter, passive pill)
  description?: string;
  armedTier?: number;
  availableTiers?: TierInfo[];
}

export interface AvailableActions {
  can_discard: boolean;
  can_tsumo: boolean;
  can_riichi: boolean;
  can_chi: boolean;
  can_pon: boolean;
  can_kan: boolean;
  can_ron: boolean;
  last_call_tile?: ProtocolTile;
  chi_options: ProtocolTile[][];
  pon_options: ProtocolTile[][];
}

export interface RoundModalData {
  title: string;
  delta: number;
  scores: number[];
  yakuList?: Array<{ name: string; han: number }>;
  han?: number;
  fu?: number;
  points?: number;
  winningTile?: ProtocolTile;
  winningHand?: ProtocolTile[];
  winningMelds?: PlayerMeld[];
  isTsumo?: boolean;
  winnerSeat?: number;
  loserSeat?: number | null;
  honba?: number;
  honbaPoints?: number;
  riichiSticks?: number;
  rank?: string;
}

export interface NormalizedSeat {
  kind: 'human' | 'cpu' | 'empty';
  name: string;
  level?: string;
  personality?: string;
}

const WINDS = ['East', 'South', 'West', 'North'];

export class GameStore {
  public socket: GameSocket;
  private listeners: Set<() => void> = new Set();

  // Screen
  public screen: 'lobby' | 'game' = 'lobby';
  public connectionStatus: 'connecting' | 'connected' | 'disconnected' = 'disconnected';

  // Room
  public roomCode = '';
  public seats: NormalizedSeat[] = [
    { kind: 'human', name: 'Player' },
    { kind: 'cpu', name: 'CPU 1', level: 'Normal' },
    { kind: 'cpu', name: 'CPU 2', level: 'Normal' },
    { kind: 'cpu', name: 'CPU 3', level: 'Normal' },
  ];
  public hostSeat = 0;
  public yourSeat = 0;
  public yourSeatWind: 'East' | 'South' | 'West' | 'North' = 'East';
  public powerSeats: string[] = ['saki', 'nodoka', 'koromo', 'yuuki'];
  public cpuLevel = 'Normal';

  // Game
  public roundWind: 'East' | 'South' | 'West' | 'North' = 'East';
  public roundNumber = 1;
  public totalRounds = 4;
  public honba = 0;
  public riichiSticks = 0;
  public scores: number[] = [25000, 25000, 25000, 25000];
  public doraIndicators: ProtocolTile[] = [];
  public remainingTiles = 70;

  public hand: ProtocolTile[] = [];
  public drawnTile: ProtocolTile | null = null;
  public opponentTileCounts: number[] = [13, 13, 13, 13];

  public discards: PlayerDiscards[][] = [[], [], [], []];
  public melds: PlayerMeld[][] = [[], [], [], []];
  public riichiDeclared: boolean[] = [false, false, false, false];

  public currentTurn = -1;
  public actions: AvailableActions = {
    can_discard: false,
    can_tsumo: false,
    can_riichi: false,
    can_chi: false,
    can_pon: false,
    can_kan: false,
    can_ron: false,
    chi_options: [],
    pon_options: [],
  };

  public lastDiscarderSeat = -1;
  public roundEndModal: RoundModalData | null = null;
  public isGameOver = false;

  public powers: SuperpowerState[] = [
    { power: 'saki', active: false, type: 'flow', gauge: 33, description: 'Flow: 50 / 150' },
    { power: 'nodoka', active: false, type: 'flow', gauge: 33, description: 'Flow: 50 / 150' },
    { power: 'koromo', active: false, type: 'flow', gauge: 33, description: 'Flow: 50 / 150' },
    { power: 'yuuki', active: false, type: 'flow', gauge: 33, description: 'Flow: 50 / 150' },
  ];

  public kuikaeBannedIndices: number[] = [];
  public isRiichiMode = false;
  public riichiCandidateIndices: Set<number> = new Set();
  public hoveredTileKind: string | null = null;
  public lastDiscard: { seat: number; index: number } | null = null;
  public hoveredDiscardWaitHint: Array<{ face: string; count: number }> | null = null;

  public toast: ToastMessage | null = null;
  private toastTimer: number | null = null;

  public cutin: { title: string; desc: string; visible: boolean } | null = null;
  private cutinTimer: number | null = null;

  public showToast(text: string, type: 'info' | 'error' | 'power' = 'info'): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toast = { id: Date.now(), text, type };
    this.notify();
    this.toastTimer = window.setTimeout(() => {
      this.toast = null;
      this.notify();
    }, 4200);
  }

  public logs: GameLogEntry[] = [];
  public isLogExpanded = true;

  public toggleLog(): void {
    this.isLogExpanded = !this.isLogExpanded;
    this.notify();
  }

  public addLog(category: GameLogEntry['category'], message: string, details?: string): void {
    const now = new Date();
    const timestamp = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    const entry: GameLogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp,
      category,
      message,
      details,
    };
    this.logs.push(entry);
    if (this.logs.length > 120) this.logs.shift();
    this.notify();

    setTimeout(() => {
      const el = document.getElementById('game-log-body');
      if (el) el.scrollTop = el.scrollHeight;
    }, 10);
  }

  public getSeatWind(seat: number): string {
    const windIdx = (seat - this.dealerSeat + 4) % 4;
    return WINDS[windIdx] || 'East';
  }

  public getSeatName(seat: number): string {
    if (seat === this.yourSeat) return 'You';
    const s = this.seats[seat];
    const wind = this.getSeatWind(seat);
    if (s?.name) return `${s.name} (${wind})`;
    return `Player ${seat} (${wind})`;
  }

  public handleBannedTileClick(tile: ProtocolTile): void {
    const face = tileToFace(tile);
    this.showToast(`Kuikae rule (喰い替え): Cannot discard ${face} right after calling that sequence!`, 'error');
    this.addLog(
      'rule',
      `Kuikae Prohibition: Cannot discard ${face}!`,
      'Riichi rules strictly prohibit Kuikae (calling a meld and discarding the exact same tile or the opposite sequence end on the same turn). Please discard another tile.'
    );
  }

  constructor(socket: GameSocket) {
    this.socket = socket;
    this.socket.onStatus((status) => {
      const wasInGame = this.screen === 'game';
      this.connectionStatus = status;
      // The bridge has no session resume: a reconnect produces a brand-new
      // anonymous session with no room and no seat. Keeping the old board would
      // leave the player staring at a dead table whose every action is rejected
      // with InvalidAction, so drop them back to the lobby and say why.
      if (status === 'disconnected' && wasInGame) {
        this.abandonSession();
        this.showToast(
          'Connection lost. The bridge cannot resume a game, so you have been returned to the lobby.',
          'error'
        );
      }
      this.notify();
    });

    this.socket.onMessage((msg) => this.handleServerMessage(msg));
  }

  /**
   * Clear every piece of game state and return to the lobby.
   *
   * Used when the session cannot be resumed. The next RoomState / GameStarted
   * repopulates seats, powers, and board state, so anything left stale here
   * would be rendered as if the abandoned hand were still live.
   */
  public abandonSession(): void {
    this.screen = 'lobby';
    this.roomCode = '';
    this.yourSeat = 0;
    this.yourSeatWind = 'East';
    this.hostSeat = 0;

    this.roundWind = 'East';
    this.roundNumber = 1;
    this.totalRounds = 4;
    this.honba = 0;
    this.riichiSticks = 0;
    this.scores = [25000, 25000, 25000, 25000];
    this.doraIndicators = [];
    this.remainingTiles = 70;

    this.hand = [];
    this.drawnTile = null;
    this.opponentTileCounts = [13, 13, 13, 13];
    this.discards = [[], [], [], []];
    this.melds = [[], [], [], []];
    this.riichiDeclared = [false, false, false, false];

    this.currentTurn = -1;
    this.lastDiscarderSeat = -1;
    this.resetTurnActions();
    this.resetCalls();
    this.roundEndModal = null;
    this.isGameOver = false;
    this.kuikaeBannedIndices = [];
    this.isRiichiMode = false;
    this.riichiCandidateIndices = new Set();
    this.hoveredTileKind = null;
    this.lastDiscard = null;
    this.hoveredDiscardWaitHint = null;
    this.cutin = null;
    this.logs = [];
  }

  public get dealerSeat(): number {
    const windIdx = WINDS.indexOf(this.yourSeatWind);
    if (windIdx >= 0) {
      return (this.yourSeat - windIdx + 4) % 4;
    }
    return (this.roundNumber - 1) % 4;
  }

  public playerToSeat(player: any): number {
    if (typeof player === 'number') return player;
    if (typeof player === 'string') {
      const idx = WINDS.indexOf(player);
      if (idx >= 0) {
        return (this.dealerSeat + idx) % 4;
      }
    }
    return 0;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((l) => l());
  }

  public sendHello(name = 'Player'): void {
    this.socket.send({ Hello: { display_name: name, protocol_version: 6 } });
  }

  public createRoom(): void {
    this.socket.send({
      CreateRoom: {
        length: 'EastOnly',
        rules: {},
      },
    });
  }

  public joinRoom(code: string): void {
    this.socket.send({ JoinRoom: { code } });
  }

  public setPowers(powerSeats: string[]): void {
    this.powerSeats = [...powerSeats];
    this.socket.send({ SetPowers: { power_seats: powerSeats } });
    this.notify();
  }

  public setCpuLevel(level: string): void {
    this.cpuLevel = level;
    this.socket.send({
      SetCpuConfigs: {
        cpu_configs: [
          { level, personality: 'Balanced' },
          { level, personality: 'Balanced' },
          { level, personality: 'Balanced' },
        ],
      },
    });
    this.notify();
  }

  public startGame(): void {
    this.socket.send({ StartGame: {} });
  }

  public computeRiichiCandidates(): void {
    this.riichiCandidateIndices.clear();
    const allTiles = [...this.hand, ...(this.drawnTile ? [this.drawnTile] : [])];
    for (let i = 0; i < allTiles.length; i++) {
      const remaining = allTiles.filter((_, idx) => idx !== i);
      if (shantenOfTiles(remaining) === 0) {
        this.riichiCandidateIndices.add(i);
      }
    }
  }

  public enterRiichiMode(): void {
    this.isRiichiMode = true;
    this.computeRiichiCandidates();
    this.notify();
  }

  public cancelRiichiMode(): void {
    this.isRiichiMode = false;
    this.riichiCandidateIndices.clear();
    this.notify();
  }

  public resetTurnActions(): void {
    this.actions.can_discard = false;
    this.actions.can_riichi = false;
    this.actions.can_tsumo = false;
    this.actions.can_kan = false;
    this.isRiichiMode = false;
    this.riichiCandidateIndices.clear();
    this.hoveredDiscardWaitHint = null;
  }

  public discard(tile: ProtocolTile): void {
    if (this.isRiichiMode) {
      this.callRiichi(tile);
      return;
    }
    if (this.kuikaeBannedIndices.includes(tile.index)) {
      this.handleBannedTileClick(tile);
      return;
    }
    this.resetTurnActions();
    this.socket.send({
      Action: { Discard: { tile } },
    });
    this.notify();
  }

  public passAction(): void {
    this.resetCalls();
    this.resetTurnActions();
    this.socket.send({ Action: 'Pass' });
    this.notify();
  }

  public callRiichi(tile?: ProtocolTile): void {
    const discardTile = tile || this.drawnTile || this.hand[this.hand.length - 1];
    this.resetTurnActions();
    this.socket.send({ Action: { Riichi: { tile: discardTile } } });
    this.notify();
  }

  public callTsumo(): void {
    this.resetTurnActions();
    this.socket.send({ Action: 'Tsumo' });
    this.notify();
  }

  public callRon(): void {
    this.resetCalls();
    this.socket.send({ Action: 'Ron' });
    this.notify();
  }

  // --- Mahjong Soul QoL Helpers ---
  public setHoveredTile(tile: ProtocolTile | TileFace | null): void {
    if (!tile) {
      this.hoveredTileKind = null;
    } else {
      const face = typeof tile === 'string' ? tile : tileToFace(tile);
      this.hoveredTileKind = normFace(face);
    }
    this.notify();
  }

  public setHoveredDiscardTile(handIdx: number | null): void {
    if (handIdx === null || !this.actions.can_discard) {
      this.hoveredDiscardWaitHint = null;
    } else {
      this.hoveredDiscardWaitHint = this.getWaitsIfDiscard(handIdx);
    }
    this.notify();
  }

  public isTileHoveredMatch(tile: ProtocolTile | TileFace): boolean {
    if (!this.hoveredTileKind) return false;
    const face = typeof tile === 'string' ? tile : tileToFace(tile);
    return normFace(face) === this.hoveredTileKind;
  }

  public getActiveDoraKinds(): string[] {
    return (this.doraIndicators || []).map((ind) => getDoraFromIndicator(ind));
  }

  public isTileDora(tile: ProtocolTile | TileFace): boolean {
    const face = typeof tile === 'string' ? tile : tileToFace(tile);
    return this.getActiveDoraKinds().includes(normFace(face));
  }

  public isTileAkaDora(tile: ProtocolTile | TileFace): boolean {
    if (typeof tile !== 'string' && tile.red_dora) return true;
    const face = typeof tile === 'string' ? tile : tileToFace(tile);
    return face[0] === '0';
  }

  public isTileLastDiscard(seat: number, tileIdx: number): boolean {
    return Boolean(this.lastDiscard && this.lastDiscard.seat === seat && this.lastDiscard.index === tileIdx);
  }

  private static readonly YAKU_KIND_LABELS: Record<string, string> = {
    Riichi: 'Riichi',
    DoubleRiichi: 'Double Riichi',
    Unbroken: 'Ippatsu',
    FullyConcealedHand: 'Menzen Tsumo',
    Pinfu: 'Pinfu',
    TwinSequences: 'Iipeikou',
    AllInside: 'Tanyao',
    ValueHonourWhiteDragon: 'Haku',
    ValueHonourGreenDragon: 'Hatsu',
    ValueHonourRedDragon: 'Chun',
    ValueHonourRoundWind: 'Round Wind',
    ValueHonourSeatWind: 'Seat Wind',
    LastTileDraw: 'Haitei',
    LastTileClaim: 'Houtei',
    AfterAQuad: 'Rinshan',
    RobbingAQuad: 'Chankan',
    SevenPairs: 'Chiitoitsu',
    MixedSequences: 'Sanshoku Doujun',
    FullStraight: 'Ittsuu',
    CommonEnds: 'Chanta',
    LittleDragons: 'Shousangen',
    MixedTriplets: 'Sanshoku Doukou',
    ThreeQuads: 'Sankantsu',
    CommonFlush: 'Honitsu',
    DoubleTwinSequences: 'Ryanpeikou',
    PerfectEnds: 'Junchan',
    CommonTerminals: 'Honroutou',
    PerfectFlush: 'Chinitsu',
    ThirteenOrphans: 'Kokushi Musou',
    ThirteenOrphansThirteenWait: 'Kokushi 13-sided',
    FourConcealedTriplets: 'Suuankou',
    FourConcealedTripletsPairWait: 'Suuankou Tanki',
    BigDragons: 'Daisangen',
    LittleWinds: 'Shousuushi',
    BigWinds: 'Daisuushi',
    AllHonours: 'Tsuuiisou',
    AllGreen: 'Ryuuiisou',
    PerfectTerminals: 'Chinroutou',
    FourQuads: 'Suukantsu',
    NineGates: 'Chuuren Poutou',
    PureNineGates: 'Pure Chuuren',
    BlessingOfHeaven: 'Tenhou',
    BlessingOfEarth: 'Chihou',
  };

  private static readonly DORA_LABELS: Record<string, string> = {
    Dora: 'Dora',
    RedDora: 'Aka Dora',
    UraDora: 'Ura Dora',
    PeiDora: 'Nuki Dora',
  };

  public normalizeYakuList(raw: any): Array<{ name: string; han: number }> {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((entry: any): { name: string; han: number } | null => {
        // New server shape: [{ Yaku: 'Riichi' } | { Dora: 'Dora' }, han]
        if (Array.isArray(entry) && entry.length >= 2) {
          const [item, han] = entry;
          const hanNum = typeof han === 'number' ? han : parseInt(han, 10) || 0;
          if (item && typeof item === 'object') {
            if (typeof (item as any).Yaku === 'string') {
              const kind = (item as any).Yaku as string;
              return { name: GameStore.YAKU_KIND_LABELS[kind] || kind, han: hanNum };
            }
            if (typeof (item as any).Dora === 'string') {
              const label = (item as any).Dora as string;
              return { name: GameStore.DORA_LABELS[label] || label, han: hanNum };
            }
          }
          return null;
        }
        // Legacy shape: { name, han }
        if (entry && typeof entry === 'object' && typeof entry.name === 'string') {
          return { name: entry.name, han: typeof entry.han === 'number' ? entry.han : 0 };
        }
        return null;
      })
      .filter((x): x is { name: string; han: number } => x !== null);
  }

  public getTenpaiWaits(handTiles?: ProtocolTile[]): Array<{ face: string; count: number }> {
    const tiles = handTiles || this.hand;
    const h = hairiOfTiles(tiles);
    if (h.now !== 0 || !h.wait) return [];

    const waits: Array<{ face: string; count: number }> = [];
    const waitFaces = Object.keys(h.wait);

    for (const wf of waitFaces) {
      const normW = normFace(wf);
      let visible = 0;
      for (const t of this.hand) {
        if (normFace(tileToFace(t)) === normW) visible++;
      }
      if (this.drawnTile && normFace(tileToFace(this.drawnTile)) === normW) visible++;
      for (const seatDiscards of this.discards) {
        for (const d of seatDiscards) {
          if (normFace(tileToFace(d.tile)) === normW) visible++;
        }
      }
      for (const seatMelds of this.melds) {
        for (const m of seatMelds) {
          for (const t of m.tiles) {
            if (normFace(tileToFace(t)) === normW) visible++;
          }
        }
      }
      for (const ind of this.doraIndicators) {
        if (normFace(tileToFace(ind)) === normW) visible++;
      }

      const remaining = Math.max(0, 4 - visible);
      waits.push({ face: wf, count: remaining });
    }

    return waits.sort((a, b) => b.count - a.count);
  }

  public getWaitsIfDiscard(tileIndexInHand: number): Array<{ face: string; count: number }> | null {
    const allTiles = [...this.hand, ...(this.drawnTile ? [this.drawnTile] : [])];
    if (tileIndexInHand < 0 || tileIndexInHand >= allTiles.length) return null;
    const remainingHand = allTiles.filter((_, i) => i !== tileIndexInHand);
    const waits = this.getTenpaiWaits(remainingHand);
    return waits.length > 0 ? waits : null;
  }

  public callChi(chosenTiles?: ProtocolTile[]): void {
    const tiles = chosenTiles || this.actions.chi_options[0];
    if (tiles) {
      if (this.actions.last_call_tile) {
        this.kuikaeBannedIndices = getKuikaeBannedIndices(this.actions.last_call_tile, tiles);
      }
      this.resetCalls();
      this.socket.send({ Action: { Chi: { tiles } } });
      this.notify();
    }
  }

  public callPon(chosenTiles?: ProtocolTile[]): void {
    const tiles = chosenTiles || this.actions.pon_options[0] || (this.actions.last_call_tile ? [this.actions.last_call_tile, this.actions.last_call_tile] : []);
    if (this.actions.last_call_tile) {
      this.kuikaeBannedIndices = [this.actions.last_call_tile.index];
    }
    this.resetCalls();
    this.socket.send({ Action: { Pon: { tiles } } });
    this.notify();
  }

  public callKan(tileIndex = 0): void {
    this.resetCalls();
    this.socket.send({ Action: { Kan: { tile_index: tileIndex } } });
    this.notify();
  }

  public readyNextRound(): void {
    this.roundEndModal = null;
    this.socket.send('ReadyNextRound');
    this.notify();
  }

  public returnToLobby(): void {
    this.roundEndModal = null;
    this.isGameOver = false;
    this.socket.send('ReturnToLobby');
    this.screen = 'lobby';
    this.notify();
  }

  public leaveRoom(): void {
    this.socket.send('LeaveRoom');
    this.screen = 'lobby';
    this.roomCode = '';
    this.roundEndModal = null;
    this.isGameOver = false;
    this.notify();
  }

  public selectPowerTier(tier: number): void {
    if (this.powers[this.yourSeat]) {
      this.powers[this.yourSeat].armedTier = tier;
    }
    this.socket.send({ SelectPowerTier: { tier } });
    this.notify();
  }

  private resetCalls(): void {
    this.actions.can_chi = false;
    this.actions.can_pon = false;
    this.actions.can_kan = false;
    this.actions.can_ron = false;
    this.actions.chi_options = [];
    this.actions.pon_options = [];
    this.actions.last_call_tile = undefined;
  }

  private showCutin(title: string, desc: string): void {
    if (this.cutinTimer) clearTimeout(this.cutinTimer);
    this.cutin = { title, desc, visible: true };
    this.notify();
    this.cutinTimer = window.setTimeout(() => {
      if (this.cutin) this.cutin.visible = false;
      this.notify();
    }, 2000);
  }

  private handleServerMessage(msg: ServerMessage): void {
    if ('Error' in msg) {
      const err = (msg as any).Error;
      const errMsg = typeof err === 'string' ? err : (err?.message || err?.code || 'Illegal action');
      const errCode = typeof err === 'object' && err?.code ? `[${err.code}] ` : '';
      if (this.currentTurn === this.yourSeat) {
        this.actions.can_discard = true;
      }
      let userFriendlyMsg = errMsg;
      let details: string | undefined;
      if (errMsg.toLowerCase().includes('kuikae')) {
        userFriendlyMsg = `Kuikae rule (喰い替え): Cannot discard this tile right after that call!`;
        details = 'Kuikae prohibits discarding the same tile or the opposite sequence end right after making a call.';
      } else if (errMsg.toLowerCase().includes('notinturn')) {
        userFriendlyMsg = 'Wait for your turn to act.';
      } else if (errMsg.toLowerCase().includes('callwindowclosed')) {
        userFriendlyMsg = 'Call window is already closed.';
      }
      this.showToast(userFriendlyMsg, 'error');
      this.addLog('rule', `Action Rejected: ${errCode}${userFriendlyMsg}`, details);
      this.notify();
      return;
    }

    if ('RoomState' in msg) {
      const rs = msg.RoomState;
      this.roomCode = rs.code;
      this.hostSeat = rs.host_seat;
      this.yourSeat = rs.your_seat;

      this.seats = (rs.seats || []).map((s: any, idx: number) => {
        if (!s || s === 'Empty') {
          return { kind: 'cpu', name: `CPU ${idx}`, level: this.cpuLevel, personality: 'Balanced' };
        }
        if (s.Human) {
          return { kind: 'human', name: s.Human.name || `Player ${idx + 1}` };
        }
        if (s.Cpu) {
          return { kind: 'cpu', name: `CPU ${idx}`, level: s.Cpu.level, personality: s.Cpu.personality };
        }
        return { kind: 'cpu', name: `CPU ${idx}`, level: this.cpuLevel };
      });

      if (rs.power_seats) {
        this.powerSeats = rs.power_seats;
        rs.power_seats.forEach((power, seat) => {
          if (this.powers[seat]) this.powers[seat].power = power;
        });
      }
      this.notify();
      return;
    }

    if ('Event' in msg) {
      this.handleGameEvent(msg.Event);
      return;
    }

    if ('GameOver' in msg) {
      this.scores = msg.GameOver.final_scores;
      this.isGameOver = true;
      this.addLog('win', `🏁 Game Over! Final Scores: ${this.scores.map((s, i) => `${this.getSeatName(i)}: ${s}`).join(' | ')}`);
      this.notify();
      return;
    }
  }

  private handleGameEvent(ev: any): void {
    if ('GameStarted' in ev) {
      const gs: GameStartedEvent = ev.GameStarted;
      this.screen = 'game';
      this.yourSeatWind = gs.seat_wind;
      this.roundWind = gs.round_wind;
      this.roundNumber = gs.round_number;
      this.totalRounds = gs.total_rounds;
      this.honba = gs.honba;
      this.riichiSticks = gs.riichi_sticks;
      this.scores = gs.scores;
      this.doraIndicators = gs.dora_indicators;
      this.hand = sortTiles(gs.hand);
      this.drawnTile = null;
      this.discards = [[], [], [], []];
      this.melds = [[], [], [], []];
      this.riichiDeclared = [false, false, false, false];
      this.opponentTileCounts = [13, 13, 13, 13];
      this.roundEndModal = null;
      this.isGameOver = false;
      this.currentTurn = this.dealerSeat;
      this.kuikaeBannedIndices = [];
      this.resetCalls();
      this.addLog(
        'turn',
        `Round ${gs.round_wind} ${gs.round_number} (Honba ${gs.honba}) started. Dealer: ${this.getSeatName(this.dealerSeat)}. Dora indicator: [${tileToFace(gs.dora_indicators[0])}].`
      );
      this.notify();
      return;
    }

    if ('TileDrawn' in ev) {
      const td: TileDrawnEvent = ev.TileDrawn;
      this.currentTurn = this.yourSeat;
      this.remainingTiles = td.remaining_tiles;
      this.drawnTile = td.tile;
      this.kuikaeBannedIndices = [];
      this.actions.can_discard = true;
      this.actions.can_tsumo = td.can_tsumo;
      this.actions.can_riichi = Boolean(td.can_riichi && !this.riichiDeclared[this.yourSeat]);
      this.isRiichiMode = false;
      this.riichiCandidateIndices.clear();

      // Check for own-turn Kan (Ankan 4 of a kind or Kakan pon upgrade)
      const allTiles = [...this.hand, td.tile];
      const counts: Record<number, number> = {};
      allTiles.forEach((t) => { counts[t.index] = (counts[t.index] || 0) + 1; });
      const ankanIndex = Object.keys(counts).find((k) => counts[parseInt(k, 10)] === 4);
      const kakanMatch = this.melds[this.yourSeat].find(
        (m) => (m.callType === 'Pon' || m.callType === 'pon') && allTiles.some((t) => t.index === m.tiles[0]?.index)
      );
      this.actions.can_kan = Boolean(ankanIndex !== undefined || kakanMatch);

      this.addLog('turn', `You drew ${tileToFace(td.tile)}. Wall remaining: ${td.remaining_tiles}.`);
      if (td.is_furiten) {
        this.addLog(
          'rule',
          'Furiten Warning: You are in Furiten!',
          'Your discard river contains one of your winning waits. You cannot declare Ron off other players\' discards. You can only win by self-draw (Tsumo).'
        );
      }
      if (td.can_tsumo) {
        this.addLog('win', `Tsumo Available on ${tileToFace(td.tile)}!`);
      }
      if (td.can_riichi) {
        this.addLog('call', 'Riichi Available! Closed hand is in Tenpai.');
      }

      this.notify();
      return;
    }

    if ('OtherPlayerDrew' in ev) {
      const op: OtherPlayerDrewEvent = ev.OtherPlayerDrew;
      const seat = this.playerToSeat(op.player);
      this.currentTurn = seat;
      this.remainingTiles = op.remaining_tiles;
      this.resetTurnActions();
      this.resetCalls();
      this.drawnTile = null;
      this.opponentTileCounts[seat] = (this.opponentTileCounts[seat] || 13) + 1;
      this.addLog('turn', `${this.getSeatName(seat)} drew a tile. (Wall: ${op.remaining_tiles})`);
      this.notify();
      return;
    }

    if ('TileDiscarded' in ev) {
      const td: TileDiscardedEvent = ev.TileDiscarded;
      const seat = this.playerToSeat(td.player);
      this.lastDiscarderSeat = seat;

      const isRiichiTile = Boolean(this.riichiDeclared[seat] && !this.discards[seat].some((d) => d.is_riichi));
      this.discards[seat].push({
        tile: td.tile,
        is_riichi: isRiichiTile,
      });
      this.lastDiscard = { seat, index: this.discards[seat].length - 1 };

      this.resetTurnActions();

      if (seat === this.yourSeat) {
        this.kuikaeBannedIndices = [];
        if (this.drawnTile && areTilesEqual(this.drawnTile, td.tile)) {
          this.drawnTile = null;
        } else {
          const idx = this.hand.findIndex((t) => areTilesEqual(t, td.tile));
          if (idx >= 0) this.hand.splice(idx, 1);
          if (this.drawnTile) {
            this.hand.push(this.drawnTile);
            this.drawnTile = null;
            this.hand = sortTiles(this.hand);
          }
        }
      } else {
        this.opponentTileCounts[seat] = Math.max(0, (this.opponentTileCounts[seat] || 1) - 1);
      }

      const isTsumogiri = td.is_tsumogiri ? ' (tsumogiri)' : '';
      this.addLog('turn', `${seat === this.yourSeat ? 'You' : this.getSeatName(seat)} discarded ${tileToFace(td.tile)}${isTsumogiri}.`);

      this.notify();
      return;
    }

    if ('CallAvailable' in ev) {
      const ca: CallAvailableEvent = ev.CallAvailable;
      this.actions.last_call_tile = ca.tile;
      this.actions.can_ron = false;
      this.actions.can_pon = false;
      this.actions.can_chi = false;
      this.actions.can_kan = false;
      this.actions.chi_options = [];
      this.actions.pon_options = [];

      const callTypes: string[] = [];
      if (Array.isArray(ca.calls)) {
        for (const c of ca.calls) {
          if (typeof c === 'string') {
            if (c === 'Ron') { this.actions.can_ron = true; callTypes.push('Ron'); }
            if (c === 'Kan' || c === 'Daiminkan') { this.actions.can_kan = true; callTypes.push('Kan'); }
          }
          if (typeof c === 'object' && c !== null) {
            if ('Pon' in c) {
              this.actions.can_pon = true;
              this.actions.pon_options = (c as any).Pon?.options || [];
              callTypes.push('Pon');
            }
            if ('Chi' in c) {
              this.actions.can_chi = true;
              this.actions.chi_options = (c as any).Chi?.options || [];
              callTypes.push('Chi');
            }
          }
        }
      }

      this.addLog(
        'call',
        `Call Available on discarded ${tileToFace(ca.tile)} from ${ca.discarder}: [${callTypes.join(', ')}]`
      );

      this.notify();
      return;
    }

    if ('PlayerCalled' in ev) {
      const pc: PlayerCalledEvent = ev.PlayerCalled;
      const callerSeat = this.playerToSeat(pc.player);
      const fromSeat = pc.from_player !== undefined ? this.playerToSeat(pc.from_player) : this.lastDiscarderSeat;

      const rel = fromSeat >= 0 ? (fromSeat - callerSeat + 4) % 4 : 3;
      const isAnkan = pc.call_type === 'Ankan' || pc.call_type === 'ClosedKan';
      const isKakan = pc.call_type === 'Kakan';

      let calledIdx = -1;
      let orderedTiles: ProtocolTile[] = [];

      if (isAnkan) {
        calledIdx = -1;
        orderedTiles = [...(pc.tiles || [])];
      } else if (isKakan) {
        const existingMeld = this.melds[callerSeat].find(
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
        this.melds[callerSeat].push({
          callType: pc.call_type,
          calledTile: pc.called_tile,
          tiles: orderedTiles,
          calledIndex: calledIdx,
          fromSeat,
        });
      }

      // Remove the called tile from the discarder's river
      if (this.lastDiscarderSeat >= 0 && this.discards[this.lastDiscarderSeat]?.length > 0) {
        this.discards[this.lastDiscarderSeat].pop();
        if (this.lastDiscard && this.lastDiscard.seat === this.lastDiscarderSeat) {
          this.lastDiscard = null;
        }
      }

      if (callerSeat === this.yourSeat) {
        if (pc.call_type === 'Chi' && pc.called_tile && pc.tiles) {
          const handTiles = pc.tiles.filter((t) => !areTilesEqual(t, pc.called_tile));
          this.kuikaeBannedIndices = getKuikaeBannedIndices(pc.called_tile, handTiles);
        } else if (pc.call_type === 'Pon' && pc.called_tile) {
          this.kuikaeBannedIndices = [pc.called_tile.index];
        }
      }

      const tileFaces = (orderedTiles || []).map(tileToFace).join(', ');
      this.addLog(
        'call',
        `${callerSeat === this.yourSeat ? 'You' : this.getSeatName(callerSeat)} called ${pc.call_type} on ${tileToFace(pc.called_tile)}! [${tileFaces}]`
      );

      this.currentTurn = callerSeat;
      this.resetCalls();
      this.resetTurnActions();
      this.notify();
      return;
    }

    if ('PlayerRiichi' in ev) {
      const pr: PlayerRiichiEvent = ev.PlayerRiichi;
      const seat = this.playerToSeat(pr.player);
      this.riichiDeclared[seat] = true;
      this.scores = pr.scores;
      this.riichiSticks = pr.riichi_sticks;
      if (seat === this.yourSeat) {
        this.actions.can_riichi = false;
        this.isRiichiMode = false;
        this.riichiCandidateIndices.clear();
      }
      this.addLog('call', `${seat === this.yourSeat ? 'You' : this.getSeatName(seat)} declared RIICHI! 1,000 pt stick placed on center.`);
      this.notify();
      return;
    }

    if ('DoraIndicatorsUpdated' in ev) {
      this.doraIndicators = ev.DoraIndicatorsUpdated.dora_indicators;
      const indicators = this.doraIndicators.map(tileToFace).join(', ');
      this.addLog('turn', `New Dora Indicator revealed: [${indicators}]`);
      this.notify();
      return;
    }

    if ('HandUpdated' in ev) {
      this.hand = sortTiles(ev.HandUpdated.hand);
      this.drawnTile = null;
      this.actions.can_discard = true;
      this.notify();
      return;
    }

    if ('RoundWon' in ev) {
      const rw: RoundWonEvent = ev.RoundWon;
      const winnerSeat = this.playerToSeat(rw.winner);
      const loserSeat = rw.loser !== undefined && rw.loser !== null ? this.playerToSeat(rw.loser) : null;
      const isTsumo = loserSeat === null;
      const isYouWinner = winnerSeat === this.yourSeat;
      const prevScore = this.scores[this.yourSeat];
      this.scores = rw.scores;
      const delta = (this.scores[this.yourSeat] || 0) - (prevScore || 0);

      const winnerName = isYouWinner ? 'You' : (this.seats[winnerSeat]?.name || `CPU ${winnerSeat}`);
      const title = isYouWinner
        ? `Agari! You Won (+${rw.score_points} pts)`
        : `${winnerName} Won (${!isTsumo && loserSeat !== null ? `Ron from ${loserSeat === this.yourSeat ? 'You' : this.seats[loserSeat]?.name || `CPU ${loserSeat}`}` : 'Tsumo'})`;

      // Server sends player_hands indexed by absolute seat 0..3.
      const handInfo = Array.isArray((rw as any).player_hands)
        ? (rw as any).player_hands[winnerSeat]
        : undefined;
      const winningHand: ProtocolTile[] | undefined = handInfo?.hand
        ? sortTiles([...handInfo.hand])
        : isYouWinner
          ? sortTiles([...this.hand, ...(this.drawnTile ? [this.drawnTile] : [])])
          : undefined;
      const winningMelds: PlayerMeld[] | undefined = handInfo?.melds
        ? handInfo.melds.map((m: any) => ({
            callType: m.call_type || 'Pon',
            tiles: [...(m.tiles || [])],
          }))
        : isYouWinner
          ? this.melds[winnerSeat]?.map((m) => ({ ...m, tiles: [...m.tiles] }))
          : undefined;

      this.roundEndModal = {
        title,
        delta,
        scores: rw.scores,
        yakuList: this.normalizeYakuList(rw.yaku_list),
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
      this.resetCalls();
      this.resetTurnActions();

      const yakuNames = (this.roundEndModal.yakuList || []).map((y) => `${y.name} (${y.han} han)`).join(', ');
      this.addLog(
        'win',
        `🏆 Round Won by ${this.getSeatName(winnerSeat)} via ${isTsumo ? 'TSUMO' : `RON off ${rw.loser}`}! (+${rw.score_points} pts)`,
        yakuNames ? `Yaku: ${yakuNames}` : undefined
      );

      this.notify();
      return;
    }

    if ('RoundDraw' in ev) {
      const rd: RoundDrawEvent = ev.RoundDraw;
      const prevScore = this.scores[this.yourSeat];
      this.scores = rd.scores;
      const delta = (this.scores[this.yourSeat] || 0) - (prevScore || 0);

      const tenpaiSeats = (rd.tenpai || []).map((p: any) => this.playerToSeat(p));
      const youTenpai = tenpaiSeats.includes(this.yourSeat);

      this.roundEndModal = {
        title: `Draw: ${rd.reason} (${youTenpai ? 'You were Tenpai' : 'You were Noten'})`,
        delta,
        scores: rd.scores,
      };
      this.resetCalls();
      this.resetTurnActions();

      const tenpaiNames = tenpaiSeats.map((s: number) => this.getSeatName(s)).join(', ');
      this.addLog('turn', `Round ended in ${rd.reason} Draw (Ryuukyoku). Tenpai: [${tenpaiNames || 'None'}]`);

      this.notify();
      return;
    }

    if ('SuperpowerIndicator' in ev) {
      const spi: SuperpowerIndicatorEvent = ev.SuperpowerIndicator;
      if (this.powers[spi.seat]) {
        this.powers[spi.seat].active = spi.active;
        if (spi.type) this.powers[spi.seat].type = spi.type;
        if (spi.type === 'normal') delete this.powers[spi.seat].gauge;
        else if (spi.gauge !== undefined && spi.gauge !== null) this.powers[spi.seat].gauge = spi.gauge;
        if (spi.description) this.powers[spi.seat].description = spi.description;
        if (spi.power) this.powers[spi.seat].power = spi.power;
        if (spi.armed_tier !== undefined) this.powers[spi.seat].armedTier = spi.armed_tier;
        if (spi.available_tiers !== undefined) this.powers[spi.seat].availableTiers = spi.available_tiers;
      }
      this.notify();
      return;
    }

    if ('PowerActivated' in ev) {
      const pa: PowerActivatedEvent = ev.PowerActivated;
      const seat = this.playerToSeat(pa.player);
      const charName = this.powerSeats[seat] || pa.power;
      if (this.powers[seat]) {
        this.powers[seat].active = true;
      }
      this.showCutin(`⚡ ${charName.toUpperCase()} AWAKENED!`, `${charName.toUpperCase()} activated superpower!`);
      this.addLog(
        'power',
        `⚡ ${this.getSeatName(seat)} (${charName.toUpperCase()}) activated ${pa.event_type} (Tier ${pa.tier})!`
      );
      this.notify();
      return;
    }
  }
}
