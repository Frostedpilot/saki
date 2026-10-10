import { html, TemplateResult } from 'lit-html';
import { ProtocolTile } from '../tiles/tile-utils';
import { renderTile } from '../tiles/svg-tiles';

export interface CenterInfoProps {
  roundWind: string;
  roundNumber: number;
  honba: number;
  riichiSticks: number;
  remainingTiles: number;
  doraIndicators: ProtocolTile[];
  scores: number[];
  currentTurn: number;
  dealerSeat: number;
  yourSeat: number;
  riichiSeats?: boolean[];
  onTileHover?: (_tile: ProtocolTile | null) => void;
  isHoverMatch?: (_tile: ProtocolTile) => boolean;
}

const WIND_KANJI: Record<string, string> = {
  East: '東',
  South: '南',
  West: '西',
  North: '北',
};

const WINDS = ['East', 'South', 'West', 'North'];

export function renderCenterInfo(props: CenterInfoProps): TemplateResult {
  const roundKanji = WIND_KANJI[props.roundWind] || '東';
  const roundText = `${roundKanji}${props.roundNumber}局`;

  const getSeatForPos = (pos: 'bottom' | 'right' | 'top' | 'left'): number => {
    switch (pos) {
      case 'bottom':
        return props.yourSeat;
      case 'right':
        return (props.yourSeat + 1) % 4;
      case 'top':
        return (props.yourSeat + 2) % 4;
      case 'left':
        return (props.yourSeat + 3) % 4;
    }
  };

  const getSeatWind = (seat: number): string => {
    const windIdx = (seat - props.dealerSeat + 4) % 4;
    return WINDS[windIdx] || 'East';
  };

  const renderSeatEdge = (pos: 'bottom' | 'right' | 'top' | 'left'): TemplateResult => {
    const seat = getSeatForPos(pos);
    const score = props.scores[seat] ?? 25000;
    const isTurn = props.currentTurn === seat;
    const isDealer = seat === props.dealerSeat;
    const wind = getSeatWind(seat);
    const hasRiichi = props.riichiSeats?.[seat] ?? false;

    return html`
      <div class="board-center__score-bar board-center__score-bar--${pos} ${isTurn ? 'is-active' : ''}">
        <span class="board-center__wind ${isDealer ? 'is-dealer' : ''}"> ${WIND_KANJI[wind] || wind.charAt(0)} </span>
        <span class="board-center__score">${score}</span>
        ${hasRiichi ? html`<span class="board-center__riichi-pip"></span>` : ''}
      </div>
    `;
  };

  return html`
    <div class="board-center">
      ${renderSeatEdge('top')} ${renderSeatEdge('left')} ${renderSeatEdge('right')} ${renderSeatEdge('bottom')}

      <div class="board-center__inner">
        <div class="board-center__round">${roundText}</div>

        <div class="board-center__dora">
          <div class="board-center__dora-tiles">
            ${props.doraIndicators.map((t) =>
              renderTile(t, {
                show: 'face',
                isHoverMatch: props.isHoverMatch ? props.isHoverMatch(t) : false,
                onMouseEnter: props.onTileHover ? () => props.onTileHover!(t) : undefined,
                onMouseLeave: props.onTileHover ? () => props.onTileHover!(null) : undefined,
              })
            )}
            ${Array.from({ length: Math.max(0, 5 - props.doraIndicators.length) }).map(() =>
              renderTile({ index: 0 }, { show: 'back' })
            )}
          </div>
        </div>

        <div class="board-center__stats">
          <span class="board-center__stat" title="Remaining wall tiles"> 🀫 ${props.remainingTiles} </span>
          <span class="board-center__stat" title="Honba counter"> 本 ${props.honba} </span>
          <span class="board-center__stat" title="Riichi sticks on table"> 立 ${props.riichiSticks} </span>
        </div>
      </div>
    </div>
  `;
}
