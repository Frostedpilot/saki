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
  onClick?: () => void;
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

  if (show === 'back') {
    return html`
      <span
        class="${classes.join(' ')}"
        @click=${options.onClick || null}
        .innerHTML=${backSvg}
      ></span>
    `;
  }

  return html`
    <span
      class="${classes.join(' ')}"
      @click=${options.onClick || null}
      title="${face}"
    >
      ${svg`<svg width="100%" height="100%" viewBox="0 0 300 400" aria-label="${face}">
        <use href="#tile-${face}"/>
      </svg>`}
    </span>
  `;
}
