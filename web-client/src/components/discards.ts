import { html, TemplateResult } from 'lit-html';
import { GameStore, PlayerDiscards } from '../state/store';
import { renderTile } from '../tiles/svg-tiles';

const TILES_PER_ROW = 6;
const MAX_ROWS = 4;

export function renderDiscards(
  discards: PlayerDiscards[],
  placement: 'bottom' | 'top' | 'left' | 'right' = 'bottom',
  store?: GameStore,
  seat?: number
): TemplateResult {
  const rows: Array<Array<{ discard: PlayerDiscards; globalIdx: number }>> = [];
  for (let i = 0; i < discards.length; i++) {
    const rowIndex = Math.min(MAX_ROWS - 1, Math.floor(i / TILES_PER_ROW));
    if (!rows[rowIndex]) rows[rowIndex] = [];
    rows[rowIndex].push({ discard: discards[i], globalIdx: i });
  }

  return html`
    <div class="discard-pond discard-pond--${placement}">
      ${rows.map(
        (row) => html`
          <div class="discard-pond__row">
            ${row.map(({ discard: d, globalIdx }) => {
              const isLast = Boolean(store && seat !== undefined && store.isTileLastDiscard(seat, globalIdx));
              return html`
                <div class="discard-pond__tile-wrapper ${d.is_riichi ? 'is-riichi' : ''}">
                  ${renderTile(d.tile, {
                    show: 'face',
                    rotated: d.is_riichi,
                    grayed: d.grayed,
                    isLastDiscard: isLast,
                    isHoverMatch: store ? store.isTileHoveredMatch(d.tile) : false,
                    isDora: store ? store.isTileDora(d.tile) : false,
                    isAkaDora: store ? store.isTileAkaDora(d.tile) : false,
                    onMouseEnter: store ? () => store.setHoveredTile(d.tile) : undefined,
                    onMouseLeave: store ? () => store.setHoveredTile(null) : undefined,
                  })}
                </div>
              `;
            })}
          </div>
        `
      )}
    </div>
  `;
}
