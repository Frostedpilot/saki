import { html, TemplateResult } from 'lit-html';
import { GameStore } from '../state/store';
import { renderTile } from '../tiles/svg-tiles';
import { renderSakiCard } from './saki-card';

export function renderRoundModal(store: GameStore): TemplateResult {
  if (store.isGameOver) {
    // Sort players by score descending
    const ranking = [0, 1, 2, 3]
      .map((seat) => ({
        seat,
        name: seat === store.yourSeat ? 'You' : (store.seats[seat]?.name || `CPU ${seat}`),
        score: store.scores[seat] ?? 25000,
        character: store.powerSeats[seat] || 'none',
      }))
      .sort((a, b) => b.score - a.score);

    return html`
      <div class="modal-overlay">
        <div class="modal-card">
          <div class="modal-card__header">
            <span class="modal-card__title">GAME OVER</span>
            <span class="modal-card__score-delta" style="color: #ffd700;">Final Standings</span>
          </div>

          <div style="display: flex; flex-direction: column; gap: 8px; margin: 8px 0;">
            ${ranking.map(
              (p, idx) => html`
                <div
                  style="display: flex; align-items: center; justify-content: space-between; background: rgba(0,0,0,0.3); padding: 8px 12px; border-radius: 6px; border-left: 4px solid ${idx === 0 ? '#ffd700' : idx === 1 ? '#cbd5e1' : idx === 2 ? '#cd7f32' : 'transparent'};"
                >
                  <div style="display: flex; align-items: center; gap: 10px;">
                    <strong style="font-size: 1.1rem; color: #ffd700; width: 24px;">#${idx + 1}</strong>
                    ${renderSakiCard({ character: p.character, placement: 'bottom' })}
                    <span style="font-weight: 600; color: #f1f5f9;">${p.name}</span>
                  </div>
                  <span style="font-family: 'JetBrains Mono', monospace; font-size: 1.1rem; font-weight: 700; color: #4ecca3;">
                    ${p.score} pts
                  </span>
                </div>
              `
            )}
          </div>

          <button class="modal-card__btn" @click=${() => store.returnToLobby()}>
            Return to Lobby
          </button>
        </div>
      </div>
    `;
  }

  const res = store.roundEndModal;
  if (!res) return html``;

  const deltaStr = res.delta > 0 ? `+${res.delta}` : `${res.delta}`;

  return html`
    <div class="modal-overlay">
      <div class="modal-card">
        <div class="modal-card__header">
          <span class="modal-card__title">${res.title}</span>
          <span class="modal-card__score-delta">${deltaStr} pts</span>
        </div>

        ${res.winningTile
          ? html`
              <div style="display: flex; gap: 3px; margin: 8px 0; justify-content: center; align-items: center;">
                <span style="font-size: 0.85rem; color: #94a3b8; margin-right: 6px;">Agari Tile:</span>
                ${renderTile(res.winningTile, { show: 'face' })}
              </div>
            `
          : ''}

        ${res.yakuList && res.yakuList.length > 0
          ? html`
              <div class="modal-card__yaku-list">
                ${res.yakuList.map(
                  (y) => html`
                    <div class="modal-card__yaku-item">
                      <span>${y.name}</span>
                      <span>${y.han} Han</span>
                    </div>
                  `
                )}
                ${res.han && res.fu
                  ? html`
                      <div class="modal-card__yaku-item" style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 4px; margin-top: 4px;">
                        <span>Total:</span>
                        <span>${res.han} Han ${res.fu} Fu (${res.points || 0} pts)</span>
                      </div>
                    `
                  : ''}
              </div>
            `
          : ''}

        <button class="modal-card__btn" @click=${() => store.readyNextRound()}>
          Next Round
        </button>
      </div>
    </div>
  `;
}
