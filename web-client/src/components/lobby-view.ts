import { html, TemplateResult } from 'lit-html';
import { GameStore } from '../state/store';
import { renderSakiCard } from './saki-card';

const AVAILABLE_CHARACTERS = [
  { id: 'saki', name: 'Saki Miyanaga (Rinshan Kaihou) [Flow]' },
  { id: 'saki-normal', name: 'Saki Miyanaga — Ridge Resonance [Normal]' },
  { id: 'yuu', name: 'Yuu Matsumi (Hot Dams) [Normal]' },
  { id: 'nodoka', name: 'Nodoka Haramura (Digital Mahjong)' },
  { id: 'koromo', name: 'Koromo Amae (Haitei Raoyue / Darkness)' },
  { id: 'yuuki', name: 'Yuuki Kataoka (East Wind Blitz / Tacos)' },
  { id: 'hisa', name: 'Hisa Takei (Bad-Wait Chaos)' },
  { id: 'mako', name: 'Mako Someya (Memory Vision)' },
  { id: 'none', name: 'No Superpower (Standard Riichi)' },
];

export function renderLobby(store: GameStore): TemplateResult {
  const isInRoom = Boolean(store.roomCode);

  const handleCreateRoom = (e: Event) => {
    e.preventDefault();
    store.createRoom();
  };

  const handleJoinRoom = (e: Event) => {
    e.preventDefault();
    const input = (document.getElementById('join-room-code') as HTMLInputElement)?.value;
    if (input) store.joinRoom(input.trim().toUpperCase());
  };

  const handlePowerChange = (seat: number, power: string) => {
    const newPowers = [...store.powerSeats];
    newPowers[seat] = power;
    store.setPowers(newPowers);
  };

  const handleCpuLevelChange = (e: any) => {
    store.setCpuLevel(e.target.value);
  };

  return html`
    <div class="lobby-screen">
      <div class="lobby-card">
        <h1 class="lobby-card__title">SAKI <span>MAHJONG</span></h1>
        <p class="lobby-card__subtitle">
          Superpower Riichi Mahjong · Connection:
          <strong style="color: ${store.connectionStatus === 'connected' ? '#4ecca3' : '#e05252'}">
            ${store.connectionStatus}
          </strong>
        </p>

        ${!isInRoom
          ? html`
              <form class="lobby-form" @submit=${handleCreateRoom}>
                <div class="lobby-form__row">
                  <input
                    id="player-name-input"
                    class="lobby-form__input"
                    type="text"
                    placeholder="Your Name"
                    value="Player"
                  />
                  <button type="submit" class="lobby-form__btn">Create Room</button>
                </div>
              </form>

              <form class="lobby-form" @submit=${handleJoinRoom}>
                <div class="lobby-form__row">
                  <input
                    id="join-room-code"
                    class="lobby-form__input"
                    type="text"
                    placeholder="Enter Room Code (e.g. 7X9AB2)"
                    maxlength="6"
                  />
                  <button type="submit" class="lobby-form__btn lobby-form__btn--secondary">Join Room</button>
                </div>
              </form>
            `
          : html`
              <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 12px;">
                <span style="font-size: 1.1rem; color: #ffd700;">Room: <strong>${store.roomCode}</strong></span>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="font-size: 0.85rem; color: #94a3b8;">Bot Difficulty:</span>
                  <select
                    style="background: #0f172a; color: #4ecca3; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 2px 8px; font-weight: 600; outline: none; cursor: pointer;"
                    .value=${store.cpuLevel}
                    @change=${handleCpuLevelChange}
                  >
                    <option value="Normal">Normal AI</option>
                    <option value="Hard">Hard AI</option>
                    <option value="Easy">Easy AI</option>
                  </select>
                </div>
              </div>

              <!-- Character Roster Picker -->
              <div class="roster-picker">
                <div class="roster-picker__title">SELECT SAKI CHARACTER POWERS FOR TABLE</div>
                <div class="roster-picker__grid">
                  ${[0, 1, 2, 3].map(
                    (seat) => html`
                      <div class="roster-picker__seat">
                        <span class="roster-picker__seat-label" style="color: ${seat === 0 ? '#4ecca3' : '#ffd700'}">
                          ${seat === 0 ? 'Seat 0 (You)' : `Seat ${seat} (AI Bot)`}
                        </span>

                        ${renderSakiCard({
                          character: store.powerSeats[seat] || 'none',
                          placement: 'bottom',
                        })}

                        <select
                          .value=${store.powerSeats[seat] || 'none'}
                          @change=${(e: any) => handlePowerChange(seat, e.target.value)}
                        >
                          ${AVAILABLE_CHARACTERS.map(
                            (char) => html`
                              <option value="${char.id}" ?selected=${(store.powerSeats[seat] || 'none') === char.id}>
                                ${char.name}
                              </option>
                            `
                          )}
                        </select>
                      </div>
                    `
                  )}
                </div>
              </div>

              <div style="font-size: 0.82rem; color: #94a3b8; text-align: center; margin-top: -4px;">
                💡 <em>All 3 remaining seats will be filled by AI bots with the selected powers. Hover over cards to preview abilities.</em>
              </div>

              <div style="display: flex; gap: 12px; margin-top: 12px;">
                <button
                  class="lobby-form__btn"
                  style="flex: 2; padding: 14px; font-size: 1.05rem;"
                  @click=${() => {
                    store.setPowers(store.powerSeats);
                    store.startGame();
                  }}
                >
                  START MATCH (FILL WITH 3 BOTS)
                </button>
                <button
                  class="lobby-form__btn lobby-form__btn--secondary"
                  style="flex: 1;"
                  @click=${() => store.leaveRoom()}
                >
                  Leave
                </button>
              </div>
            `}
      </div>
    </div>
  `;
}
