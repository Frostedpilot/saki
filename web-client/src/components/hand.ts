import { html, TemplateResult } from 'lit-html';
import { ProtocolTile } from '../tiles/tile-utils';
import { renderTile } from '../tiles/svg-tiles';
import { GameStore } from '../state/store';

export interface HandProps {
  tiles: ProtocolTile[];
  drawnTile: ProtocolTile | null;
  canDiscard: boolean;
  bannedIndices?: number[];
  store?: GameStore;
  onDiscard: (tile: ProtocolTile) => void;
  onBannedClick?: (tile: ProtocolTile) => void;
}

export function renderPlayerHand(props: HandProps): TemplateResult {
  const { store } = props;
  const isBanned = (tile: ProtocolTile) => Boolean(props.bannedIndices?.includes(tile.index));

  const renderHandTile = (tile: ProtocolTile, tileIdx: number, isDrawn = false) => {
    const inRiichi = Boolean(store && store.riichiDeclared[store.yourSeat]);
    const banned = isBanned(tile);
    const isRiichiMode = Boolean(store?.isRiichiMode);
    const isRiichiCandidate = Boolean(isRiichiMode && store?.riichiCandidateIndices.has(tileIdx));
    const clickable = props.canDiscard && (inRiichi ? isDrawn : (!isRiichiMode || isRiichiCandidate));
    const grayed = banned || (isRiichiMode && !isRiichiCandidate) || (inRiichi && !isDrawn);

    return renderTile(tile, {
      show: 'face',
      clickable,
      grayed,
      highlight: isDrawn && !banned && !isRiichiMode,
      isHoverMatch: store ? store.isTileHoveredMatch(tile) : false,
      isDora: store ? store.isTileDora(tile) : false,
      isAkaDora: store ? store.isTileAkaDora(tile) : false,
      isRiichiCandidate,
      onMouseEnter: store
        ? () => {
            store.setHoveredTile(tile);
            store.setHoveredDiscardTile(tileIdx);
          }
        : undefined,
      onMouseLeave: store
        ? () => {
            store.setHoveredTile(null);
            store.setHoveredDiscardTile(null);
          }
        : undefined,
      onClick: () => {
        if (banned) {
          props.onBannedClick?.(tile);
        } else if (clickable) {
          props.onDiscard(tile);
        }
      },
    });
  };

  // Check wait hints: either hovering discard candidate or in locked Riichi
  const isRiichi = Boolean(store && store.riichiDeclared[store.yourSeat]);
  const waitsToShow = store?.hoveredDiscardWaitHint || (isRiichi && store ? store.getTenpaiWaits() : null);

  return html`
    <div class="player-hand-wrapper">
      ${waitsToShow && waitsToShow.length > 0
        ? html`
            <div class="hand-waits-hint ${isRiichi ? 'hand-waits-hint--riichi' : ''}">
              <span class="hand-waits-hint__label">
                ${isRiichi ? '立直 (Riichi Waits):' : '聴牌 (Tenpai if discarded):'}
              </span>
              <div class="hand-waits-hint__list">
                ${waitsToShow.map(
                  (w) => html`
                    <span class="hand-waits-hint__item">
                      ${renderTile(w.face as any, { show: 'face' })}
                      <span class="hand-waits-hint__count ${w.count === 0 ? 'is-empty' : ''}">
                        ${w.count} left
                      </span>
                    </span>
                  `
                )}
              </div>
            </div>
          `
        : ''}

      <div class="player-hand">
        ${props.tiles.map((tile, i) => renderHandTile(tile, i, false))}
        ${props.drawnTile
          ? html`
              <span class="player-hand__drawn-gap">
                ${renderHandTile(props.drawnTile, props.tiles.length, true)}
              </span>
            `
          : ''}
      </div>
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
