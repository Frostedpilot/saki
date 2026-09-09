import { html, TemplateResult } from 'lit-html';
import { ProtocolTile } from '../tiles/tile-utils';
import { renderTile } from '../tiles/svg-tiles';

export interface HandProps {
  tiles: ProtocolTile[];
  drawnTile: ProtocolTile | null;
  canDiscard: boolean;
  bannedIndices?: number[];
  onDiscard: (tile: ProtocolTile) => void;
  onBannedClick?: (tile: ProtocolTile) => void;
}

export function renderPlayerHand(props: HandProps): TemplateResult {
  const isBanned = (tile: ProtocolTile) => Boolean(props.bannedIndices?.includes(tile.index));

  const renderHandTile = (tile: ProtocolTile, isDrawn = false) => {
    const banned = isBanned(tile);
    const clickable = props.canDiscard;
    return renderTile(tile, {
      show: 'face',
      clickable,
      grayed: banned,
      highlight: isDrawn && !banned,
      onClick: () => {
        if (banned) {
          props.onBannedClick?.(tile);
        } else if (props.canDiscard) {
          props.onDiscard(tile);
        }
      },
    });
  };

  return html`
    <div class="player-hand">
      ${props.tiles.map((tile) => renderHandTile(tile, false))}
      ${props.drawnTile
        ? html`
            <span class="player-hand__drawn-gap">
              ${renderHandTile(props.drawnTile, true)}
            </span>
          `
        : ''}
    </div>
  `;
}

export function renderOpponentHand(count: number, isVertical = false): TemplateResult {
  const dummyArray = Array.from({ length: Math.max(0, count) });
  const verticalClass = isVertical ? 'opponent-hand--vertical' : '';

  return html`
    <div class="opponent-hand ${verticalClass}">
      ${dummyArray.map(() => renderTile({ index: 0 }, { show: 'back' }))}
    </div>
  `;
}
