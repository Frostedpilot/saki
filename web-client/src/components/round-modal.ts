import { html, TemplateResult } from 'lit-html';
import { GameStore } from '../state/store';
import { renderTile } from '../tiles/svg-tiles';
import { renderSakiCard } from './saki-card';

function fuPointsLine(han: number | undefined, fu: number | undefined, points: number | undefined): string {
  if (han === undefined || fu === undefined) return points !== undefined ? `${points} pts` : '';
  // Standard ron/tsumo formula before honba/riichi adjustments, for display only.
  // Server points are authoritative; this shows how han+fu map to score.
  if (han >= 13) return `${points ?? 0} pts (Yakuman)`;
  if (han >= 11) return `${points ?? 0} pts (Sanbaiman)`;
  if (han >= 8) return `${points ?? 0} pts (Baiman)`;
  if (han >= 6) return `${points ?? 0} pts (Haneman)`;
  if (han >= 5 || (han === 4 && fu >= 40) || (han === 3 && fu >= 70)) return `${points ?? 0} pts (Mangan)`;
  const base = Math.min(2000, Math.ceil((fu * Math.pow(2, han + 2)) / 100) * 100);
  return `${han} Han ${fu} Fu → base ${base} → ${points ?? 0} pts`;
}

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
  const extras: string[] = [];
  if (res.honba && res.honba > 0) extras.push(`Honba +${res.honbaPoints ?? res.honba * 300}`);
  if (res.riichiSticks && res.riichiSticks > 0) extras.push(`Riichi sticks +${res.riichiSticks * 1000}`);

  return html`
    <div class="modal-overlay">
      <div class="modal-card modal-card--agari">
        <div class="modal-card__header">
          <span class="modal-card__title">${res.title}</span>
          <span class="modal-card__score-delta">${deltaStr} pts</span>
        </div>

        ${res.winningHand && res.winningHand.length > 0 && res.winningTile
          ? html`
              <div class="agari-hand">
                <div class="agari-hand__tiles">
                  ${res.winningHand.map((t) => renderTile(t, { show: 'face' }))}
                  <span class="agari-hand__gap"></span>
                  <span class="agari-hand__win-tile">
                    <span class="agari-hand__win-label">${res.isTsumo ? 'TSUMO' : 'RON'}</span>
                    ${renderTile(res.winningTile, { show: 'face', highlight: true })}
                  </span>
                </div>
                ${res.winningMelds && res.winningMelds.length > 0
                  ? html`
                      <div class="agari-hand__melds">
                        ${res.winningMelds.map(
                          (m) => html`
                            <span class="agari-hand__meld">
                              ${m.tiles.map((t) => renderTile(t, { show: 'face' }))}
                              <span class="agari-hand__meld-tag">${m.callType}</span>
                            </span>
                          `
                        )}
                      </div>
                    `
                  : ''}
              </div>
            `
          : res.winningTile
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
                ${res.han !== undefined && res.fu !== undefined
                  ? html`
                      <div class="modal-card__yaku-total">
                        <div class="modal-card__yaku-total-row">
                          <span>Total:</span>
                          <span>${res.han} Han ${res.fu} Fu</span>
                        </div>
                        <div class="modal-card__yaku-fu-line">${fuPointsLine(res.han, res.fu, res.points)}</div>
                        ${extras.length > 0
                          ? html`<div class="modal-card__yaku-extras">incl. ${extras.join(' · ')} → ${res.points || 0} pts</div>`
                          : html`<div class="modal-card__yaku-extras">${res.points || 0} pts</div>`}
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
