// svg-tiles.test.ts — the tile rendering layer, under jsdom.
//
// `renderTile` is the only place the client turns a wire tile into something a
// player sees, and it had no tests. The classes it emits drive all of the board's
// state visualisation — dora highlight, riichi candidacy, last discard, greyed
// opponents — so a dropped class is a silently wrong board rather than a crash.
//
// lit-html templates need a real DOM to render into, hence the jsdom environment
// configured in vitest.config.ts.

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render as renderInto } from 'lit-html';
import { renderTile } from './svg-tiles';
import { tileToFace } from './tile-utils';

// Render a template into a fresh container and hand the element back.
// lit-html's signature is render(value, container) — template first.
function mount(tile: Parameters<typeof renderTile>[0], options?: Parameters<typeof renderTile>[1]): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  renderInto(renderTile(tile, options), host);
  return host.firstElementChild as HTMLElement;
}

const classesOf = (el: HTMLElement) => el.className.split(/\s+/).filter(Boolean);

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('renderTile', () => {
  test('renders a face as an SVG <use> pointing at the sprite symbol', () => {
    const el = mount({ index: 0 });
    expect(el.tagName.toLowerCase()).toBe('span');
    expect(classesOf(el)).toEqual(['mahjong-tile']);
    const use = el.querySelector('use');
    expect(use).not.toBeNull();
    expect(use!.getAttribute('href')).toBe('#tile-1m');
    expect(el.querySelector('svg')!.getAttribute('aria-label')).toBe('1m');
  });

  test('accepts a face string as well as a tile object', () => {
    expect(mount('3p').querySelector('use')!.getAttribute('href')).toBe('#tile-3p');
    expect(mount({ index: 20 }).querySelector('use')!.getAttribute('href')).toBe('#tile-3s');
  });

  test('a red 5 renders the aka symbol', () => {
    const el = mount({ index: 4, red_dora: true });
    expect(el.querySelector('use')!.getAttribute('href')).toBe('#tile-0m');
    expect(el.querySelector('svg')!.getAttribute('aria-label')).toBe('0m');
  });

  test('show:back renders the back art and no symbol reference', () => {
    const el = mount({ index: 0 }, { show: 'back' });
    expect(classesOf(el)).toContain('mahjong-tile--back');
    expect(el.querySelector('use')).toBeNull();
  });

  test('every option adds its own class', () => {
    const el = mount({ index: 0 }, {
      rotated: true, grayed: true, highlight: true, clickable: true,
      isHoverMatch: true, isDora: true, isAkaDora: true,
      isRiichiCandidate: true, isLastDiscard: true,
    });
    expect(classesOf(el)).toEqual(expect.arrayContaining([
      'mahjong-tile--rotated', 'mahjong-tile--grayed', 'mahjong-tile--highlight',
      'mahjong-tile--clickable', 'mahjong-tile--hover-match', 'mahjong-tile--dora',
      'mahjong-tile--aka-dora', 'mahjong-tile--riichi-candidate', 'mahjong-tile--last-discard',
    ]));
  });

  test('no option flags means no state classes', () => {
    const el = mount({ index: 0 });
    expect(classesOf(el)).toEqual(['mahjong-tile']);
  });

  test('the title carries the dora annotation', () => {
    expect(mount({ index: 0 }).title).toBe('1m');
    expect(mount({ index: 0 }, { isDora: true }).title).toBe('1m (Dora)');
    expect(mount({ index: 0 }, { isAkaDora: true }).title).toBe('1m (Red 5)');
    expect(mount({ index: 0 }, { isDora: true, isAkaDora: true }).title)
      .toBe('1m (Dora) (Red 5)');
  });

  test('click and hover handlers fire', async () => {
    let clicks = 0;
    let enters = 0;
    let leaves = 0;
    const el = mount({ index: 0 }, {
      clickable: true,
      onClick: () => { clicks++; },
      onMouseEnter: () => { enters++; },
      onMouseLeave: () => { leaves++; },
    });
    el.dispatchEvent(new Event('click'));
    el.dispatchEvent(new Event('mouseenter'));
    el.dispatchEvent(new Event('mouseleave'));
    await Promise.resolve();
    expect(clicks).toBe(1);
    expect(enters).toBe(1);
    expect(leaves).toBe(1);
  });

  test('rendering a tile with no handlers does not throw on interaction', () => {
    const el = mount({ index: 0 });
    expect(() => el.dispatchEvent(new Event('click'))).not.toThrow();
  });

  test('the face in the title agrees with tileToFace for every tile', () => {
    for (let i = 0; i < 34; i++) {
      expect(mount({ index: i }).title).toBe(tileToFace({ index: i }));
    }
  });
});

describe('injectTileSprite', () => {
  // `injectTileSprite` guards on a module-level `spriteInjected` flag, so a test
  // that empties document.body cannot simply call it again — the flag says it has
  // already run and it does nothing. That is fine in the app (body persists for the
  // lifetime of the page) but it makes the function untestable in place. Resetting
  // the module registry gives each test a genuinely fresh instance, so the guard is
  // exercised for real rather than assumed.
  async function freshModule() {
    vi.resetModules();
    return import('./svg-tiles');
  }

  test('injects the sprite sheet exactly once', async () => {
    const { injectTileSprite } = await freshModule();
    injectTileSprite();
    injectTileSprite();
    injectTileSprite();
    expect(document.querySelectorAll('#mahjong-tile-sprites')).toHaveLength(1);
  });

  test('the sprite container is hidden from assistive tech', async () => {
    const { injectTileSprite } = await freshModule();
    injectTileSprite();
    const sprite = document.getElementById('mahjong-tile-sprites')!;
    expect(sprite.style.display).toBe('none');
    expect(sprite.getAttribute('aria-hidden')).toBe('true');
  });

  test('the sprite sheet contains every symbol renderTile can reference', async () => {
    const { injectTileSprite } = await freshModule();
    injectTileSprite();
    const sprite = document.getElementById('mahjong-tile-sprites')!;
    // Every one of the 34 faces, including the three aka 5s.
    for (let i = 0; i < 34; i++) {
      const face = tileToFace({ index: i });
      expect(sprite.querySelector(`#tile-${face}`), `missing symbol for ${face}`).not.toBeNull();
    }
    for (const face of ['0m', '0p', '0s']) {
      expect(sprite.querySelector(`#tile-${face}`), `missing aka symbol ${face}`).not.toBeNull();
    }
  });

  test('rendering a tile injects the sprite as a side effect', async () => {
    const { renderTile } = await freshModule();
    expect(document.getElementById('mahjong-tile-sprites')).toBeNull();
    const host = document.createElement('div');
    document.body.appendChild(host);
    renderInto(renderTile({ index: 0 }), host);
    expect(document.getElementById('mahjong-tile-sprites')).not.toBeNull();
  });
});