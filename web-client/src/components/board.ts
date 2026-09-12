import { html, TemplateResult } from 'lit-html';
import { GameStore } from '../state/store';
import { renderSakiCard } from './saki-card';
import { renderPowerBadge } from './power-badge';
import { renderPlayerHand, renderOpponentHand } from './hand';
import { renderDiscards } from './discards';
import { renderMelds } from './melds';
import { renderCenterInfo } from './center-info';
import { renderActionBar } from './action-bar';
import { renderRoundModal } from './round-modal';
import { renderGameLog } from './game-log';

const WINDS = ['East', 'South', 'West', 'North'];

export function renderBoard(store: GameStore): TemplateResult {
  const getSeatWind = (seat: number): string => {
    // Relative to dealer seat
    const windIdx = (seat - store.dealerSeat + 4) % 4;
    return WINDS[windIdx] || 'East';
  };

  const getPlayerName = (seat: number): string => {
    const s = store.seats[seat];
    if (seat === store.yourSeat) return s?.name ? `${s.name} (You)` : 'You';
    if (s?.kind === 'cpu') return `${s.name} (${s.level || 'Normal'})`;
    if (s?.kind === 'human') return s.name;
    return `CPU ${seat} (Normal)`;
  };

  const isDealer = (seat: number): boolean => {
    return seat === store.dealerSeat;
  };

  const renderStation = (seat: number, pos: 'bottom' | 'top' | 'left' | 'right'): TemplateResult => {
    const isTurn = store.currentTurn === seat;
    return html`
      <div class="player-station player-station--${pos} ${isTurn ? 'is-turn' : ''}">
        <div class="player-station__card-box">
          ${renderSakiCard({
            character: store.powerSeats[seat] || 'none',
            placement: pos,
          })}
          ${renderPowerBadge(store.powers[seat], {
            isYou: seat === store.yourSeat,
            onSelectTier: (tier: number) => store.selectPowerTier(tier),
          })}
        </div>
        <div class="player-station__info">
          <div class="player-station__name-row">
            <span class="player-station__name">${getPlayerName(seat)}</span>
            <span class="player-station__wind ${isDealer(seat) ? 'is-dealer' : ''}">
              ${getSeatWind(seat)}
            </span>
          </div>
          ${isTurn
            ? html`
                <span class="player-station__turn-pill">
                  ${seat === store.yourSeat ? '🎯 YOUR TURN' : '⚡ THINKING...'}
                </span>
              `
            : ''}
          <div class="player-station__score">${store.scores[seat] ?? 25000}</div>
        </div>
      </div>
    `;
  };

  const renderPlayerFlowBar = (): TemplateResult => {
    const p = store.powers[store.yourSeat];
    if (!p || p.power === 'none') return html``;
    const gauge = p.gauge ?? (p.active ? 100 : 33);
    const activeClass = p.active ? 'player-flow-bar--active' : '';
    return html`
      <div class="player-flow-bar ${activeClass}">
        <span class="player-flow-bar__label">⚡ FLOW</span>
        <div class="player-flow-bar__track">
          <div class="player-flow-bar__fill" style="width: ${gauge}%"></div>
        </div>
        <span class="player-flow-bar__value">${gauge}%</span>
        ${p.active ? html`<span class="player-flow-bar__tag">ACTIVE</span>` : ''}
      </div>
    `;
  };

  return html`
    <div class="mahjong-board">
      <!-- Header -->
      <header class="board-header">
        <div class="board-header__title">
          SAKI <span>MAHJONG</span>
        </div>
        <div class="board-header__meta">
          <span>Room: <strong>${store.roomCode}</strong></span>
          <span>Round: <strong>${store.roundWind} ${store.roundNumber}</strong></span>
          <span>Your Seat: <strong>${getSeatWind(store.yourSeat)}</strong></span>
          <button class="board-header__leave-btn" @click=${() => store.leaveRoom()}>
            Leave Game
          </button>
        </div>
      </header>

      <!-- Viewport Wrapper (Centers the board and displays outer HUD) -->
      <div class="board-viewport">
        <!-- Player Stations (Non-intrusive outer HUD) -->
        ${renderStation(0, 'bottom')}
        ${renderStation(1, 'right')}
        ${renderStation(2, 'top')}
        ${renderStation(3, 'left')}

        <!-- Symmetric Mahjong Table Surface (5x5 grid) -->
        <main class="board-table">
          <!-- Top Melds (Left corner of top player) -->
          <div class="zone-top-melds">
            ${renderMelds(store.melds[2], store, 'top')}
          </div>

          <!-- Top Hand (Opponent 2) -->
          <div class="zone-top-hand">
            ${renderOpponentHand(store.opponentTileCounts[2])}
          </div>

          <!-- Right Melds (Top corner of right player) -->
          <div class="zone-right-melds">
            ${renderMelds(store.melds[1], store, 'right')}
          </div>

          <!-- Left Hand (Opponent 3) -->
          <div class="zone-left-hand">
            ${renderOpponentHand(store.opponentTileCounts[3], true)}
          </div>

          <!-- TOP RIVER (Seat 2 Discards) -->
          ${renderDiscards(store.discards[2], 'top', store, 2)}

          <!-- LEFT RIVER (Seat 3 Discards) -->
          ${renderDiscards(store.discards[3], 'left', store, 3)}

          <!-- CENTER COMPASS (Scores, Dora, Wall, Honba) -->
          ${renderCenterInfo({
            roundWind: store.roundWind,
            roundNumber: store.roundNumber,
            honba: store.honba,
            riichiSticks: store.riichiSticks,
            remainingTiles: store.remainingTiles,
            doraIndicators: store.doraIndicators,
            scores: store.scores,
            currentTurn: store.currentTurn,
            dealerSeat: store.dealerSeat,
            yourSeat: store.yourSeat,
            riichiSeats: store.riichiDeclared,
            onTileHover: (tile) => store.setHoveredTile(tile),
            isHoverMatch: (tile) => store.isTileHoveredMatch(tile),
          })}

          <!-- RIGHT RIVER (Seat 1 Discards) -->
          ${renderDiscards(store.discards[1], 'right', store, 1)}

          <!-- Right Hand (Opponent 1) -->
          <div class="zone-right-hand">
            ${renderOpponentHand(store.opponentTileCounts[1], true)}
          </div>

          <!-- Left Melds (Bottom corner of left player) -->
          <div class="zone-left-melds">
            ${renderMelds(store.melds[3], store, 'left')}
          </div>

          <!-- BOTTOM RIVER (Your Discards) -->
          ${renderDiscards(store.discards[0], 'bottom', store, 0)}

          <!-- Bottom Hand & Action Bar (Player 0) -->
          <div class="zone-bottom-hand">
            ${renderActionBar(store)}
            ${renderPlayerFlowBar()}
            ${renderPlayerHand({
              tiles: store.hand,
              drawnTile: store.drawnTile,
              canDiscard: store.actions.can_discard,
              bannedIndices: store.kuikaeBannedIndices,
              store,
              onDiscard: (tile) => store.discard(tile),
              onBannedClick: (tile) => store.handleBannedTileClick(tile),
            })}
          </div>

          <!-- Bottom Melds (Right corner of your hand) -->
          <div class="zone-bottom-melds">
            ${renderMelds(store.melds[0], store, 'bottom')}
          </div>
        </main>

        <!-- Action and Rule HUD Log (Bottom-Right) -->
        ${renderGameLog(store)}
      </div>

      <!-- Modals and Overlays -->
      ${renderRoundModal(store)}

      <!-- Superpower Activation Cut-in (Non-blocking anime banner) -->
      <div class="power-cutin ${store.cutin?.visible ? 'power-cutin--show' : ''}">
        <div class="power-cutin__content">
          <div class="power-cutin__title">${store.cutin?.title || ''}</div>
          <div class="power-cutin__desc">${store.cutin?.desc || ''}</div>
        </div>
      </div>

      <!-- Toast alerts (Kuikae and illegal actions) -->
      ${store.toast
        ? html`
            <div class="game-toast game-toast--${store.toast.type}">
              <span class="game-toast__icon">${store.toast.type === 'error' ? '⚠️' : '⚡'}</span>
              <span class="game-toast__text">${store.toast.text}</span>
            </div>
          `
        : ''}
    </div>
  `;
}
