import { GameSocket } from '../net/socket';
import { applyGameEvent } from './events';
import { ProtocolTile, ServerMessage, TierInfo } from '../net/protocol-types';
import {
  getKuikaeBannedIndices,
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
  public pendingKanIndex = 0;
  public isRiichiMode = false;
  public riichiCandidateIndices: Set<number> = new Set();
  public hoveredTileKind: string | null = null;
  public lastDiscard: { seat: number; index: number } | null = null;
  public hoveredDiscardWaitHint: Array<{ face: string; count: number }> | null = null;

  // Character turn clock (server `TurnTimer` from the getTurnClock hook, phase
  // 2c). Advisory and enforced locally: on expiry during your own turn we
  // tsumogiri. A call window is left alone — auto-passing could decline a win.
  public turnClockSeconds = 0;
  public turnClockRemaining = 0;
  private turnClockTimer: number | null = null;

  private stopTurnClock(): void {
    if (this.turnClockTimer !== null) {
      clearInterval(this.turnClockTimer);
      this.turnClockTimer = null;
    }
    this.turnClockSeconds = 0;
    this.turnClockRemaining = 0;
  }

  private startTurnClock(seconds: number): void {
    this.stopTurnClock();
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    this.turnClockSeconds = Math.floor(seconds);
    this.turnClockRemaining = this.turnClockSeconds;
    this.turnClockTimer = window.setInterval(() => {
      this.turnClockRemaining = Math.max(0, this.turnClockRemaining - 1);
      if (this.turnClockRemaining === 0) {
        this.stopTurnClock();
        this.onTurnClockExpired();
      }
      this.notify();
    }, 1000);
  }

  private onTurnClockExpired(): void {
    if (!this.actions.can_discard) return; // opponent's turn, or a call window
    const tile = this.drawnTile ?? this.hand[this.hand.length - 1] ?? null;
    if (!tile) return;
    this.addLog('turn', `Turn clock expired — auto-discarded ${tileToFace(tile)}.`);
    this.discard(tile);
  }

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
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    if (this.cutinTimer) {
      clearTimeout(this.cutinTimer);
      this.cutinTimer = null;
    }
    this.stopTurnClock();
    this.toast = null;
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

  public notify(): void {
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
    // Riichi requires a closed hand; an open tenpai hand must never get
    // riichi highlights or enter riichi mode.
    if ((this.melds[this.yourSeat] || []).length > 0) return;
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
    this.stopTurnClock();
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
    AllTriplets: 'Toitoi',
    ThreeConcealedTriplets: 'Sanankou',
    NagashiMangan: 'Nagashi Mangan',
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
    const tiles =
      chosenTiles ||
      this.actions.pon_options[0] ||
      (this.actions.last_call_tile ? [this.actions.last_call_tile, this.actions.last_call_tile] : []);
    if (this.actions.last_call_tile) {
      this.kuikaeBannedIndices = [this.actions.last_call_tile.index];
    }
    this.resetCalls();
    this.socket.send({ Action: { Pon: { tiles } } });
    this.notify();
  }

  public callKan(tileIndex?: number): void {
    this.resetCalls();
    this.socket.send({ Action: { Kan: { tile_index: tileIndex !== undefined ? tileIndex : this.pendingKanIndex } } });
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

  public resetCalls(): void {
    this.actions.can_chi = false;
    this.actions.can_pon = false;
    this.actions.can_kan = false;
    this.actions.can_ron = false;
    this.actions.chi_options = [];
    this.actions.pon_options = [];
    this.actions.last_call_tile = undefined;
  }

  public showCutin(title: string, desc: string): void {
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
      const errMsg = typeof err === 'string' ? err : err?.message || err?.code || 'Illegal action';
      const errCode = typeof err === 'object' && err?.code ? `[${err.code}] ` : '';
      if (this.currentTurn === this.yourSeat) {
        this.actions.can_discard = true;
      }
      let userFriendlyMsg = errMsg;
      let details: string | undefined;
      // Match on the *code* as well as the message. The code is the stable token —
      // `NotInTurn`, `CallWindowClosed` — whereas the messages are prose
      // ("not your turn to act"), so testing the message for the concatenated code
      // never matched and two of these three translations were dead code: the player
      // saw the raw lowercase server string instead.
      const haystack = `${errCode}${errMsg}`.toLowerCase().replace(/[^a-z]/g, '');
      if (haystack.includes('kuikae')) {
        userFriendlyMsg = `Kuikae rule (喰い替え): Cannot discard this tile right after that call!`;
        details = 'Kuikae prohibits discarding the same tile or the opposite sequence end right after making a call.';
      } else if (haystack.includes('notinturn')) {
        userFriendlyMsg = 'Wait for your turn to act.';
      } else if (haystack.includes('callwindowclosed')) {
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

    if ('TurnTimer' in msg) {
      this.startTurnClock(msg.TurnTimer.seconds);
      return;
    }

    if ('Event' in msg) {
      applyGameEvent(this, msg.Event);
      return;
    }

    if ('GameOver' in msg) {
      this.scores = msg.GameOver.final_scores;
      this.isGameOver = true;
      this.addLog(
        'win',
        `🏁 Game Over! Final Scores: ${this.scores.map((s, i) => `${this.getSeatName(i)}: ${s}`).join(' | ')}`
      );
      this.notify();
      return;
    }
  }
}
