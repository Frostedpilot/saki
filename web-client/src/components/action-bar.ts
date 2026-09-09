import { html, TemplateResult } from 'lit-html';
import { GameStore } from '../state/store';

export function renderActionBar(store: GameStore): TemplateResult {
  const { actions } = store;
  const hasCalls =
    actions.can_chi ||
    actions.can_pon ||
    actions.can_kan ||
    actions.can_ron ||
    actions.can_riichi ||
    actions.can_tsumo;

  if (!hasCalls) {
    return html``;
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
        ? html`<button class="action-bar__btn action-bar__btn--riichi" @click=${() => store.callRiichi()}>RIICHI</button>`
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
