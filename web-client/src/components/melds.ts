import { html, TemplateResult } from 'lit-html';
import { GameStore, PlayerMeld } from '../state/store';
import { renderTile } from '../tiles/svg-tiles';

export type MeldPlacement = 'bottom' | 'top' | 'left' | 'right';

export function renderMelds(
  melds: PlayerMeld[],
  store?: GameStore,
  placement: MeldPlacement = 'bottom'
): TemplateResult {
  if (!melds || melds.length === 0) {
    return html``;
  }

  return html`
    <div class="meld-container meld-container--${placement}">
      ${melds.map((meld) => {
        const isAnkan = meld.callType === 'Ankan' || meld.callType === 'ClosedKan';
        const calledIdx = meld.calledIndex ?? -1;
        return html`
          <div class="meld-set ${meld.callType === 'Kakan' ? 'meld-set--kakan' : ''}">
            ${meld.tiles.map((t, idx) => {
              if (isAnkan && (idx === 0 || idx === 3)) {
                return html` <div class="meld-set__slot">${renderTile(t, { show: 'back' })}</div> `;
              }
              const isRotated = !isAnkan && idx === calledIdx;
              return html`
                <div class="meld-set__slot ${isRotated ? 'is-rotated' : ''}">
                  ${renderTile(t, {
                    show: 'face',
                    rotated: isRotated,
                    isHoverMatch: store ? store.isTileHoveredMatch(t) : false,
                    isDora: store ? store.isTileDora(t) : false,
                    isAkaDora: store ? store.isTileAkaDora(t) : false,
                    onMouseEnter: store ? () => store.setHoveredTile(t) : undefined,
                    onMouseLeave: store ? () => store.setHoveredTile(null) : undefined,
                  })}
                </div>
              `;
            })}
          </div>
        `;
      })}
    </div>
  `;
}
