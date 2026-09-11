import { html, svg, TemplateResult } from 'lit-html';
import spriteRaw from '@/assets/fluffy-stuff.svg?raw';
import backSvgRaw from '@/assets/classic-yellow.svg?raw';
import { ProtocolTile, TileFace, tileToFace } from './tile-utils';

const backSvg = backSvgRaw.replace(/ width="\d+"/, '').replace(/ height="\d+"/, '');

let spriteInjected = false;

export function injectTileSprite(): void {
  if (spriteInjected || typeof document === 'undefined') return;
  const div = document.createElement('div');
  div.id = 'mahjong-tile-sprites';
  div.style.display = 'none';
  div.setAttribute('aria-hidden', 'true');
  div.innerHTML = spriteRaw;
  document.body.prepend(div);
  spriteInjected = true;
}

export interface RenderTileOptions {
  show?: 'face' | 'back';
  rotated?: boolean;
  grayed?: boolean;
  highlight?: boolean;
  clickable?: boolean;
  isHoverMatch?: boolean;
  isDora?: boolean;
  isAkaDora?: boolean;
  isRiichiCandidate?: boolean;
  isLastDiscard?: boolean;
  onClick?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export function renderTile(tile: ProtocolTile | TileFace, options: RenderTileOptions = {}): TemplateResult {
  injectTileSprite();
  const face: TileFace = typeof tile === 'string' ? tile : tileToFace(tile);
  const show = options.show ?? 'face';

  const classes = ['mahjong-tile'];
  if (show === 'back') classes.push('mahjong-tile--back');
  if (options.rotated) classes.push('mahjong-tile--rotated');
  if (options.grayed) classes.push('mahjong-tile--grayed');
  if (options.highlight) classes.push('mahjong-tile--highlight');
  if (options.clickable) classes.push('mahjong-tile--clickable');
  if (options.isHoverMatch) classes.push('mahjong-tile--hover-match');
  if (options.isDora) classes.push('mahjong-tile--dora');
  if (options.isAkaDora) classes.push('mahjong-tile--aka-dora');
  if (options.isRiichiCandidate) classes.push('mahjong-tile--riichi-candidate');
  if (options.isLastDiscard) classes.push('mahjong-tile--last-discard');

  if (show === 'back') {
    return html`
      <span
        class="${classes.join(' ')}"
        @click=${options.onClick || null}
        @mouseenter=${options.onMouseEnter || null}
        @mouseleave=${options.onMouseLeave || null}
        .innerHTML=${backSvg}
      ></span>
    `;
  }

  return html`
    <span
      class="${classes.join(' ')}"
      @click=${options.onClick || null}
      @mouseenter=${options.onMouseEnter || null}
      @mouseleave=${options.onMouseLeave || null}
      title="${face}${options.isDora ? ' (Dora)' : ''}${options.isAkaDora ? ' (Red 5)' : ''}"
    >
      ${svg`<svg width="100%" height="100%" viewBox="0 0 300 400" aria-label="${face}">
        <use href="#tile-${face}"/>
      </svg>`}
      ${options.isDora ? html`<span class="mahjong-tile__dora-badge" title="Dora">★</span>` : ''}
      ${options.isAkaDora && !options.isDora ? html`<span class="mahjong-tile__aka-badge" title="Aka Dora">●</span>` : ''}
      ${options.isLastDiscard ? html`<span class="mahjong-tile__last-pip"></span>` : ''}
    </span>
  `;
}
