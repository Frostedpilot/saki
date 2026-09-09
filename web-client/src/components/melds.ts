import { html, TemplateResult } from 'lit-html';
import { PlayerMeld } from '../state/store';
import { renderTile } from '../tiles/svg-tiles';

export function renderMelds(melds: PlayerMeld[]): TemplateResult {
  if (!melds || melds.length === 0) {
    return html``;
  }

  return html`
    <div class="meld-container">
      ${melds.map((meld) => {
        const isAnkan = meld.callType === 'Ankan' || meld.callType === 'ClosedKan';
        return html`
          <div class="meld-set">
            ${meld.tiles.map((t, idx) => {
              if (isAnkan && (idx === 0 || idx === 3)) {
                return renderTile(t, { show: 'back' });
              }
              const isCalled = meld.calledTile && t.index === meld.calledTile.index;
              return renderTile(t, {
                show: 'face',
                rotated: Boolean(isCalled),
              });
            })}
          </div>
        `;
      })}
    </div>
  `;
}
