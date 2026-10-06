// components.test.ts — the client's render layer.
//
// The engine and the bridge have tests; these 14 lit-html components had none, and a
// wrong class or seat index here is the worst kind of bug in the project: the board
// silently misinforms the player, nothing crashes, and nothing fails. The client already
// produced one real bug the moment it was tested (three of four error translations in
// store.ts were dead code), so this layer is worth the coverage.
//
// The renderers are pure functions of props plus an optional store, so a minimal fake
// store is enough — that keeps these tests about the components rather than about
// GameStore, which store.test.ts already covers.

import { describe, test, expect, beforeEach } from 'vitest';
import { render } from 'lit-html';

import { renderMelds, type MeldPlacement } from './melds';
import { renderDiscards } from './discards';
import { renderSakiCard } from './saki-card';

// --------------------------------------------------------------- test harness

function mount(template: any): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  render(template, host);
  return host;
}

// Only the surface the components actually call. Anything else would make these tests
// fail for the wrong reason when the store's API grows.
function fakeStore(over: Record<string, any> = {}) {
  return {
    hoveredTileKind: null as string | null,
    lastDiscard: null as { seat: number; index: number } | null,
    doraKinds: [] as string[],
    setHoveredTile(tile: any) {
      this.hoveredTileKind = tile === null ? null : (typeof tile === 'string' ? tile : `idx${tile.index}`);
    },
    isTileHoveredMatch() { return false; },
    isTileDora() { return this.doraKinds.includes('x'); },
    isTileAkaDora() { return false; },
    isTileLastDiscard(seat: number, idx: number) {
      return Boolean(this.lastDiscard && this.lastDiscard.seat === seat && this.lastDiscard.index === idx);
    },
    ...over,
  } as any;
}

const tile = (index: number, red = false) => ({ index, ...(red ? { red_dora: true } : {}) });

beforeEach(() => {
  document.body.innerHTML = '';
});

// ------------------------------------------------------------------- melds

describe('renderMelds', () => {
  const pon = (calledIndex = 1) => ({
    callType: 'Pon' as const,
    tiles: [tile(0), tile(0), tile(0)],
    calledIndex,
  });

  test('renders nothing for an empty meld list', () => {
    // An empty lit-html template still leaves marker comments behind, so assert on the
    // absence of real structure rather than on innerHTML being empty.
    expect(mount(renderMelds([])).querySelector('.meld-container')).toBeNull();
    expect(mount(renderMelds(undefined as any)).querySelector('.meld-container')).toBeNull();
  });

  test('renders one slot per tile for a pon', () => {
    const host = mount(renderMelds([pon()]));
    expect(host.querySelectorAll('.meld-set').length).toBe(1);
    expect(host.querySelectorAll('.meld-set__slot').length).toBe(3);
  });

  test('the called tile of a pon is rotated sideways', () => {
    const host = mount(renderMelds([pon(1)]));
    const slots = [...host.querySelectorAll('.meld-set__slot')];
    // The claimed tile is shown rotated; the two kept tiles are not.
    expect(slots[1].className).toContain('is-rotated');
    expect(slots[0].className).not.toContain('is-rotated');
    expect(slots[2].className).not.toContain('is-rotated');
  });

  test('the rotation follows calledIndex, not a fixed position', () => {
    // calledIndex 0 must rotate the FIRST slot. Hard-coding index 1 would hide this.
    const host = mount(renderMelds([pon(0)]));
    const slots = [...host.querySelectorAll('.meld-set__slot')];
    expect(slots[0].className).toContain('is-rotated');
    expect(slots[1].className).not.toContain('is-rotated');
  });

  test('a missing calledIndex rotates nothing', () => {
    const host = mount(renderMelds([{ callType: 'Pon', tiles: [tile(0), tile(0), tile(0)] } as any]));
    expect(host.querySelectorAll('.is-rotated').length).toBe(0);
  });

  test('an ankan shows its first and last tiles face down', () => {
    const host = mount(renderMelds([{ callType: 'Ankan', tiles: [tile(4), tile(4), tile(4), tile(4)] } as any]));
    const backs = host.querySelectorAll('.mahjong-tile--back');
    expect(backs.length).toBe(2);
    // The two outer tiles are the concealed ones.
    const slots = [...host.querySelectorAll('.meld-set__slot')];
    expect(slots[0].querySelector('.mahjong-tile--back')).not.toBeNull();
    expect(slots[3].querySelector('.mahjong-tile--back')).not.toBeNull();
    expect(slots[1].querySelector('.mahjong-tile--back')).toBeNull();
    expect(slots[2].querySelector('.mahjong-tile--back')).toBeNull();
  });

  test('ClosedKan is treated as an ankan too', () => {
    const host = mount(renderMelds([{ callType: 'ClosedKan', tiles: [tile(4), tile(4), tile(4), tile(4)] } as any]));
    expect(host.querySelectorAll('.mahjong-tile--back').length).toBe(2);
  });

  test('an ankan never rotates, even if a calledIndex is present', () => {
    // Rotation belongs to the *called* tile; a concealed kan has none.
    const host = mount(renderMelds([{ callType: 'Ankan', tiles: [tile(4), tile(4), tile(4), tile(4)], calledIndex: 2 } as any]));
    expect(host.querySelectorAll('.is-rotated').length).toBe(0);
  });

  test('a kakan gets the kakan modifier class', () => {
    const host = mount(renderMelds([{ callType: 'Kakan', tiles: [tile(0), tile(0), tile(0), tile(0)], calledIndex: 3 } as any]));
    expect(host.querySelector('.meld-set')!.className).toContain('meld-set--kakan');
    // The added fourth tile is the rotated one.
    const slots = [...host.querySelectorAll('.meld-set__slot')];
    expect(slots[3].className).toContain('is-rotated');
  });

  test('a non-kakan meld does not carry the kakan class', () => {
    expect(mount(renderMelds([pon()])).querySelector('.meld-set')!.className)
      .not.toContain('meld-set--kakan');
  });

  test('the placement reaches the container class', () => {
    const placements: MeldPlacement[] = ['bottom', 'top', 'left', 'right'];
    for (const p of placements) {
      const host = mount(renderMelds([pon()], undefined, p));
      expect(host.querySelector('.meld-container')!.className).toContain(`meld-container--${p}`);
    }
  });

  test('melds render without a store', () => {
    // The store is optional; a missing one must not throw or mark anything special.
    const host = mount(renderMelds([pon()]));
    expect(host.querySelectorAll('.mahjong-tile--dora').length).toBe(0);
    expect(host.querySelectorAll('.mahjong-tile--hover-match').length).toBe(0);
  });

  test('dora and aka-dora flags come from the store', () => {
    const store = fakeStore();
    store.isTileDora = () => true;
    store.isTileAkaDora = (t: any) => Boolean(t.red_dora);
    const host = mount(renderMelds([{ callType: 'Pon', tiles: [tile(0), tile(4, true), tile(0)], calledIndex: -1 } as any], store));
    expect(host.querySelectorAll('.mahjong-tile--dora').length).toBe(3);
    expect(host.querySelectorAll('.mahjong-tile--aka-dora').length).toBe(1);
  });

  test('hovering a meld tile tells the store', () => {
    const store = fakeStore();
    mount(renderMelds([pon()], store));
    const first = document.querySelector('.mahjong-tile') as HTMLElement;
    first.dispatchEvent(new Event('mouseenter'));
    expect(store.hoveredTileKind).not.toBeNull();
    first.dispatchEvent(new Event('mouseleave'));
    expect(store.hoveredTileKind).toBeNull();
  });

  test('multiple melds each render their own set', () => {
    const host = mount(renderMelds([pon(), { callType: 'Chi', tiles: [tile(1), tile(2), tile(3)], calledIndex: 0 } as any]));
    expect(host.querySelectorAll('.meld-set').length).toBe(2);
  });
});

// --------------------------------------------------------------- discards

describe('renderDiscards', () => {
  // renderDiscards takes ONE seat's flat pond, the way board.ts calls it with
  // store.discards[seat]. PlayerDiscards carries no index field — the renderer derives
  // position from array order, which is what the last-discard highlighting depends on.
  const pond = (n: number, extra: Record<string, any> = {}) =>
    Array.from({ length: n }, (_, i) => ({ tile: tile(i % 9), ...extra }));

  test('renders an empty pond without throwing', () => {
    expect(mount(renderDiscards([])).querySelectorAll('.discard-pond__tile-wrapper').length)
      .toBe(0);
  });

  test('lays the pond out six tiles per row', () => {
    const host = mount(renderDiscards(pond(14)));
    const rows = host.querySelectorAll('.discard-pond__row');
    expect(rows.length).toBe(3);
    // 6 + 6 + 2
    expect([...rows].map((r) => r.querySelectorAll('.discard-pond__tile-wrapper').length))
      .toEqual([6, 6, 2]);
  });

  test('a full 18-tile pond is exactly three rows', () => {
    const host = mount(renderDiscards(pond(18)));
    expect(host.querySelectorAll('.discard-pond__row').length).toBe(3);
    expect([...host.querySelectorAll('.discard-pond__row')]
      .map((r) => r.querySelectorAll('.discard-pond__tile-wrapper').length)).toEqual([6, 6, 6]);
  });

  test('tiles past 18 overflow into the last row rather than adding a fourth', () => {
    // A hand cannot normally exceed 18 discards, but the layout must not produce a
    // stray row that breaks the grid.
    const host = mount(renderDiscards(pond(21)));
    expect(host.querySelectorAll('.discard-pond__row').length).toBe(3);
    expect([...host.querySelectorAll('.discard-pond__row')]
      .map((r) => r.querySelectorAll('.discard-pond__tile-wrapper').length)).toEqual([6, 6, 9]);
  });

  test('a riichi discard is rotated', () => {
    const host = mount(renderDiscards([
      { tile: tile(0) },
      { tile: tile(1), is_riichi: true },
    ]));
    expect(host.querySelectorAll('.is-riichi').length).toBe(1);
    expect(host.querySelector('.mahjong-tile--rotated')).not.toBeNull();
  });

  test('a grayed discard is marked', () => {
    const host = renderDiscards([{ tile: tile(0), grayed: true }]);
    expect(mount(host).querySelector('.mahjong-tile--grayed')).not.toBeNull();
  });

  test('the last discard of the given seat is highlighted, and only that one', () => {
    const store = fakeStore();
    store.lastDiscard = { seat: 1, index: 2 };
    const host = mount(renderDiscards(pond(4), 'bottom', store, 1));
    expect(host.querySelectorAll('.mahjong-tile--last-discard').length).toBe(1);
  });

  test('a last-discard belonging to another seat highlights nothing', () => {
    const store = fakeStore();
    store.lastDiscard = { seat: 2, index: 0 };
    const host = mount(renderDiscards(pond(4), 'bottom', store, 1));
    expect(host.querySelectorAll('.mahjong-tile--last-discard').length).toBe(0);
  });

  test('the highlight follows pond position, not a hard-coded tile', () => {
    // Index 2 is the third tile. If the renderer used the first tile of each row, or a
    // fixed slot, this would highlight the wrong one — and the player would see the
    // "last discard" marker on an arbitrary tile.
    const store = fakeStore();
    store.lastDiscard = { seat: 0, index: 2 };
    const host = mount(renderDiscards(pond(14), 'bottom', store, 0));
    const wrappers = [...host.querySelectorAll('.discard-pond__tile-wrapper')];
    const marked = wrappers.findIndex((w) => w.querySelector('.mahjong-tile--last-discard'));
    expect(marked, 'the third discard is the one marked').toBe(2);
  });

  test('placement reaches the pond class', () => {
    for (const p of ['bottom', 'top', 'left', 'right'] as const) {
      const host = mount(renderDiscards(pond(3), p));
      expect(host.querySelector('.discard-pond')!.className).toContain(`discard-pond--${p}`);
    }
  });

  test('renders without a store or a seat', () => {
    const host = mount(renderDiscards(pond(6)));
    expect(host.querySelectorAll('.mahjong-tile--last-discard').length).toBe(0);
    expect(host.querySelectorAll('.mahjong-tile').length).toBe(6);
  });

  test('dora flags come from the store', () => {
    const store = fakeStore();
    store.isTileDora = () => true;
    const host = mount(renderDiscards(pond(3), 'bottom', store, 0));
    expect(host.querySelectorAll('.mahjong-tile--dora').length).toBe(3);
  });
});

// -------------------------------------------------------------- saki-card

describe('renderSakiCard', () => {
  test('renders the No Power placeholder for none', () => {
    expect(mount(renderSakiCard({ character: 'none' })).querySelector('.saki-card-empty'))
      .not.toBeNull();
  });

  test('an empty character also shows the placeholder', () => {
    expect(mount(renderSakiCard({ character: '' })).querySelector('.saki-card-empty'))
      .not.toBeNull();
  });

  test('maps a short id to the full character class', () => {
    const host = mount(renderSakiCard({ character: 'saki' }));
    expect(host.querySelector('.saki-card')!.className).toContain('miyanaga-saki');
  });

  test('maps every advertised alias', () => {
    const cases: Array<[string, string]> = [
      ['saki', 'miyanaga-saki'],
      ['saki-normal', 'miyanaga-saki'],
      ['nodoka', 'haramura-nodoka'],
      ['koromo', 'amae-koromo'],
      ['yuuki', 'kataoka-yuuki'],
      ['hisa', 'takei-hisa'],
      ['mako', 'someya-mako'],
      ['yuu', 'matsumi-yuu'],
      ['kuro', 'matsumi-kuro'],
      ['teru', 'miyanaga-teru'],
      ['toki', 'onjouji-toki'],
    ];
    for (const [id, cls] of cases) {
      const host = mount(renderSakiCard({ character: id }));
      expect(host.querySelector('.saki-card')!.className, `alias ${id}`).toContain(cls);
    }
  });

  test('an unknown id is used verbatim rather than dropped', () => {
    const host = mount(renderSakiCard({ character: 'brand-new-character' }));
    expect(host.querySelector('.saki-card')!.className).toContain('brand-new-character');
  });

  test('matching is case-insensitive and trims', () => {
    const host = mount(renderSakiCard({ character: '  SAKI  ' }));
    expect(host.querySelector('.saki-card')!.className).toContain('miyanaga-saki');
  });

  test('a full id passes straight through', () => {
    const host = mount(renderSakiCard({ character: 'miyanaga-saki' }));
    expect(host.querySelector('.saki-card')!.className).toContain('miyanaga-saki');
  });

  test('placement defaults to bottom and is otherwise applied', () => {
    expect(mount(renderSakiCard({ character: 'saki' })).querySelector('.saki-card-wrapper')!.className)
      .toContain('saki-card-wrapper--bottom');
    expect(mount(renderSakiCard({ character: 'saki', placement: 'left' }))
      .querySelector('.saki-card-wrapper')!.className).toContain('saki-card-wrapper--left');
  });

  test('the disabled class appears only when disabled', () => {
    expect(mount(renderSakiCard({ character: 'saki' })).querySelector('.saki-card')!.className)
      .not.toMatch(/\bdisabled\b/);
    expect(mount(renderSakiCard({ character: 'saki', disabled: true }))
      .querySelector('.saki-card')!.className).toMatch(/\bdisabled\b/);
  });

  test('the onClick fires when supplied', () => {
    let clicks = 0;
    const host = mount(renderSakiCard({ character: 'saki', onClick: () => { clicks++; } }));
    (host.querySelector('.saki-card-wrapper') as HTMLElement).dispatchEvent(new Event('click'));
    expect(clicks).toBe(1);
  });

  // Documented as a live question rather than asserted as a bug: every current caller
  // (board.ts, lobby-view.ts, round-modal.ts) passes neither onClick nor disabled, so
  // the combination is unreachable today. If a caller ever wires a click handler onto a
  // disabled card, it will fire — which is what this test would then catch.
  test('KNOWN GAP: disabled does not currently suppress onClick', () => {
    let clicks = 0;
    const host = mount(renderSakiCard({
      character: 'saki', disabled: true, onClick: () => { clicks++; },
    }));
    (host.querySelector('.saki-card-wrapper') as HTMLElement).dispatchEvent(new Event('click'));
    // Asserted as-is so the behaviour is recorded. Changing it is a deliberate decision.
    expect(clicks).toBe(1);
  });
});