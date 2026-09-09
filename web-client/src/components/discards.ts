import { html, TemplateResult } from 'lit-html';
import { PlayerDiscards } from '../state/store';
import { renderTile } from '../tiles/svg-tiles';

const TILES_PER_ROW = 6;
const MAX_ROWS = 3;

export function renderDiscards(
  discards: PlayerDiscards[],
  placement: 'bottom' | 'top' | 'left' | 'right' = 'bottom'
): TemplateResult {
  const rows: PlayerDiscards[][] = [];
  for (let i = 0; i < discards.length; i++) {
    const rowIndex = Math.min(MAX_ROWS - 1, Math.floor(i / TILES_PER_ROW));
    if (!rows[rowIndex]) rows[rowIndex] = [];
    rows[rowIndex].push(discards[i]);
  }

  return html`
    <div class="discard-pond discard-pond--${placement}">
      ${rows.map(
        (row) => html`
          <div class="discard-pond__row">
            ${row.map(
              (d) => html`
                <div class="discard-pond__tile-wrapper ${d.is_riichi ? 'is-riichi' : ''}">
                  ${renderTile(d.tile, {
                    show: 'face',
                    rotated: d.is_riichi,
                    grayed: d.grayed,
                  })}
                </div>
              `
            )}
          </div>
        `
      )}
    </div>
  `;
}
