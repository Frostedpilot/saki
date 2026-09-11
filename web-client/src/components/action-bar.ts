import { html, TemplateResult } from 'lit-html';
import { GameStore } from '../state/store';

export function renderActionBar(store: GameStore): TemplateResult {
  const { actions, isRiichiMode } = store;
  const inRiichi = Boolean(store.riichiDeclared[store.yourSeat]);
  const hasCalls =
    actions.can_chi ||
    actions.can_pon ||
    actions.can_kan ||
    actions.can_ron ||
    actions.can_riichi ||
    actions.can_tsumo ||
    isRiichiMode ||
    (inRiichi && actions.can_discard);

  if (!hasCalls) {
    return html``;
  }

  if (isRiichiMode) {
    return html`
      <div class="action-bar action-bar--riichi-mode">
        <span class="action-bar__prompt">Select a highlighted tile to discard for Riichi:</span>
        <button class="action-bar__btn action-bar__btn--pass" @click=${() => store.cancelRiichiMode()}>
          CANCEL
        </button>
      </div>
    `;
  }

  if (inRiichi && actions.can_discard) {
    const discardTarget = store.drawnTile || store.hand[store.hand.length - 1];
    return html`
      <div class="action-bar">
        ${actions.can_tsumo
          ? html`<button class="action-bar__btn action-bar__btn--win" @click=${() => store.callTsumo()}>TSUMO</button>`
          : ''}
        <button
          class="action-bar__btn action-bar__btn--riichi"
          @click=${() => store.discard(discardTarget)}
        >
          TSUMOGIRI (Discard)
        </button>
      </div>
    `;
  }

  return html`
    <div class="action-bar">
      ${actions.can_ron
        ? html`<button class="action-bar__btn action-bar__btn--win" @click=${() => store.callRon()}>RON</button>`
        : ''}
      ${actions.can_tsumo
        ? html`<button class="action-bar__btn action-bar__btn--win" @click=${() => store.callTsumo()}>TSUMO</button>`
        : ''}
      ${actions.can_riichi
        ? html`<button class="action-bar__btn action-bar__btn--riichi" @click=${() => store.enterRiichiMode()}>RIICHI</button>`
        : ''}
      ${actions.can_pon
        ? html`<button class="action-bar__btn" @click=${() => store.callPon()}>PON</button>`
        : ''}
      ${actions.can_chi
        ? html`<button class="action-bar__btn" @click=${() => store.callChi()}>CHI</button>`
        : ''}
      ${actions.can_kan
        ? html`<button class="action-bar__btn" @click=${() => store.callKan(0)}>KAN</button>`
        : ''}
      <button class="action-bar__btn action-bar__btn--pass" @click=${() => store.passAction()}>PASS</button>
    </div>
  `;
}
