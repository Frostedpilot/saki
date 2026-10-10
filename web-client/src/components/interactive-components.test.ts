// interactive-components.test.ts — hand.ts and action-bar.ts.
//
// These two are where the player *acts*, so a mistake is not cosmetic: a tile that
// looks selectable but cannot be discarded, a riichi candidate highlight on the wrong
// tile, or an action bar that offers a move the server will reject.
//
// The riichi-candidate index space is the subtle part and is pinned deliberately. The
// store builds candidates over `[...hand, drawnTile]` while the renderer numbers the
// hand tiles `0..hand.length-1` and the drawn tile `hand.length`. Those two spaces only
// line up by convention, so the alignment is asserted rather than assumed.

import { describe, test, expect, beforeEach } from 'vitest';
import { render } from 'lit-html';

import { renderPlayerHand, renderOpponentHand, type HandProps } from './hand';
import { renderActionBar } from './action-bar';

function mount(template: any): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  render(template, host);
  return host;
}

const tile = (index: number, red = false) => ({ index, ...(red ? { red_dora: true } : {}) });
const tiles = (...idx: number[]) => idx.map((i) => tile(i));

function fakeStore(over: Record<string, any> = {}) {
  return {
    riichiDeclared: [false, false, false, false],
    yourSeat: 0,
    isRiichiMode: false,
    riichiCandidateIndices: new Set<number>(),
    hoveredDiscardWaitHint: null as any,
    drawnTile: null as any,
    hand: [] as any[],
    actions: {
      can_discard: false,
      can_riichi: false,
      can_tsumo: false,
      can_kan: false,
      can_chi: false,
      can_pon: false,
      can_ron: false,
    },
    // recorders
    hovered: [] as any[],
    hoveredDiscard: [] as any[],
    calls: [] as string[],
    discarded: [] as any[],
    setHoveredTile(t: any) {
      this.hovered.push(t);
    },
    setHoveredDiscardTile(i: number | null) {
      this.hoveredDiscard.push(i);
    },
    getTenpaiWaits() {
      return [];
    },
    isTileHoveredMatch() {
      return false;
    },
    isTileDora() {
      return false;
    },
    isTileAkaDora() {
      return false;
    },
    cancelRiichiMode() {
      this.calls.push('cancelRiichiMode');
    },
    callTsumo() {
      this.calls.push('callTsumo');
    },
    callRon() {
      this.calls.push('callRon');
    },
    callPon() {
      this.calls.push('callPon');
    },
    callChi() {
      this.calls.push('callChi');
    },
    callKan(i: number) {
      this.calls.push('callKan:' + i);
    },
    enterRiichiMode() {
      this.calls.push('enterRiichiMode');
    },
    passAction() {
      this.calls.push('passAction');
    },
    discard(t: any) {
      this.discarded.push(t);
      this.calls.push('discard');
    },
    ...over,
  } as any;
}

function handProps(over: Partial<HandProps> = {}): HandProps {
  return {
    tiles: tiles(0, 1, 2, 3),
    drawnTile: null,
    canDiscard: false,
    onDiscard: () => {},
    ...over,
  };
}

const clickable = (host: HTMLElement) => [...host.querySelectorAll('.mahjong-tile--clickable')];
const grayed = (host: HTMLElement) => [...host.querySelectorAll('.mahjong-tile--grayed')];

beforeEach(() => {
  document.body.innerHTML = '';
});

// ------------------------------------------------------------- opponent hand

describe('renderOpponentHand', () => {
  test('renders one face-down tile per count', () => {
    expect(mount(renderOpponentHand(13)).querySelectorAll('.mahjong-tile--back').length).toBe(13);
  });

  test('renders nothing for a count of zero', () => {
    expect(mount(renderOpponentHand(0)).querySelectorAll('.mahjong-tile--back').length).toBe(0);
  });

  test('a negative count does not throw or render tiles', () => {
    // Opponent counts come off the wire; a malformed one must not explode the board.
    expect(() => renderOpponentHand(-1)).not.toThrow();
    expect(mount(renderOpponentHand(-1)).querySelectorAll('.mahjong-tile--back').length).toBe(0);
  });

  test('the vertical variant adds its class', () => {
    expect(mount(renderOpponentHand(3, true)).querySelector('.opponent-hand')!.className).toContain(
      'opponent-hand--vertical'
    );
    expect(mount(renderOpponentHand(3)).querySelector('.opponent-hand')!.className).not.toContain(
      'opponent-hand--vertical'
    );
  });
});

// --------------------------------------------------------------- player hand

describe('renderPlayerHand', () => {
  test('renders every tile in the hand', () => {
    const host = mount(renderPlayerHand(handProps({ tiles: tiles(0, 1, 2, 3, 4) })));
    expect(host.querySelectorAll('.player-hand .mahjong-tile').length).toBe(5);
  });

  test('a drawn tile is rendered separately, after a gap', () => {
    const host = mount(
      renderPlayerHand(
        handProps({
          tiles: tiles(0, 1, 2),
          drawnTile: tile(5),
          canDiscard: true,
        })
      )
    );
    expect(host.querySelectorAll('.player-hand__drawn-gap').length).toBe(1);
    expect(host.querySelectorAll('.player-hand .mahjong-tile').length).toBe(4);
  });

  test('nothing is clickable when the player cannot discard', () => {
    const host = mount(renderPlayerHand(handProps({ tiles: tiles(0, 1, 2), canDiscard: false })));
    expect(clickable(host).length).toBe(0);
  });

  test('every tile is clickable when discarding is allowed', () => {
    const host = mount(renderPlayerHand(handProps({ tiles: tiles(0, 1, 2), canDiscard: true })));
    expect(clickable(host).length).toBe(3);
  });

  test('clicking a tile discards it', () => {
    const discarded: any[] = [];
    const host = mount(
      renderPlayerHand(
        handProps({
          tiles: tiles(0, 1, 2),
          canDiscard: true,
          onDiscard: (t) => discarded.push(t),
        })
      )
    );
    (host.querySelectorAll('.mahjong-tile')[1] as HTMLElement).dispatchEvent(new Event('click'));
    expect(discarded.length).toBe(1);
    expect(discarded[0].index).toBe(1);
  });

  // -------------------------------------------------------- kuikae

  test('a banned tile is grayed and routes to the banned handler, not to discard', () => {
    const discarded: any[] = [];
    let bannedClicks = 0;
    const host = mount(
      renderPlayerHand(
        handProps({
          tiles: tiles(0, 1, 2),
          canDiscard: true,
          bannedIndices: [1],
          onDiscard: (t) => discarded.push(t),
          onBannedClick: () => {
            bannedClicks++;
          },
        })
      )
    );
    const tiles_ = [...host.querySelectorAll('.mahjong-tile')];
    expect(grayed(host).length).toBe(1);
    tiles_[1].dispatchEvent(new Event('click'));
    expect(bannedClicks).toBe(1);
    expect(discarded.length).toBe(0);
  });

  test('a banned tile is grayed and not clickable', () => {
    // Fixed: `clickable` now excludes banned tiles, so a kuikae-banned tile no
    // longer gets pointer-cursor + hover lift while grayed. Clicking still
    // routes to onBannedClick (asserted above) so the *why* affordance remains.
    const host = mount(
      renderPlayerHand(
        handProps({
          tiles: tiles(0, 1, 2),
          canDiscard: true,
          bannedIndices: [1],
        })
      )
    );
    expect(grayed(host).length).toBe(1);
    expect(clickable(host).length).toBe(2);
  });

  test('every copy of a banned kind is banned, not just one position', () => {
    // Kuikae bans a tile *kind*: two 1m in hand are both undiscardable.
    const host = mount(
      renderPlayerHand(
        handProps({
          tiles: tiles(0, 0, 5),
          canDiscard: true,
          bannedIndices: [0],
        })
      )
    );
    expect(grayed(host).length).toBe(2);
  });

  // -------------------------------------------------------- riichi mode

  test('in riichi mode only candidates are clickable', () => {
    const store = fakeStore();
    store.isRiichiMode = true;
    store.riichiCandidateIndices = new Set([1, 3]);
    const host = mount(
      renderPlayerHand(
        handProps({
          tiles: tiles(0, 1, 2, 3),
          canDiscard: true,
          store,
        })
      )
    );
    expect(clickable(host).length).toBe(2);
    expect(grayed(host).length).toBe(2);
  });

  test('candidates carry the candidate class', () => {
    const store = fakeStore();
    store.isRiichiMode = true;
    store.riichiCandidateIndices = new Set([2]);
    const host = mount(
      renderPlayerHand(
        handProps({
          tiles: tiles(0, 1, 2, 3),
          canDiscard: true,
          store,
        })
      )
    );
    expect(host.querySelectorAll('.mahjong-tile--riichi-candidate').length).toBe(1);
  });

  test('clicking a non-candidate in riichi mode discards nothing', () => {
    const discarded: any[] = [];
    const store = fakeStore();
    store.isRiichiMode = true;
    store.riichiCandidateIndices = new Set([1]);
    const host = mount(
      renderPlayerHand(
        handProps({
          tiles: tiles(0, 1, 2, 3),
          canDiscard: true,
          store,
          onDiscard: (t) => discarded.push(t),
        })
      )
    );
    const all = [...host.querySelectorAll('.mahjong-tile')];
    all[2].dispatchEvent(new Event('click'));
    expect(discarded.length).toBe(0);
    all[1].dispatchEvent(new Event('click'));
    expect(discarded.length).toBe(1);
    expect(discarded[0].index).toBe(1);
  });

  test('the drawn tile is judged by the same candidate index space', () => {
    // computeRiichiCandidates numbers [...hand, drawnTile], so the drawn tile's index is
    // hand.length. If the renderer numbered it differently the highlight would land on
    // the wrong tile — silently, with nothing to indicate a mistake.
    const store = fakeStore();
    store.isRiichiMode = true;
    const hand = tiles(0, 1, 2);
    store.riichiCandidateIndices = new Set([hand.length]); // only the drawn tile
    const host = mount(
      renderPlayerHand(
        handProps({
          tiles: hand,
          drawnTile: tile(9),
          canDiscard: true,
          store,
        })
      )
    );
    const drawn = host.querySelector('.player-hand__drawn-gap .mahjong-tile')!;
    expect(drawn.className).toContain('mahjong-tile--riichi-candidate');
    expect(clickable(host).length).toBe(1);
    expect(clickable(host)[0].isSameNode(drawn)).toBe(true);
  });

  // -------------------------------------------------------- after riichi

  test('in riichi only the drawn tile may be discarded', () => {
    const store = fakeStore();
    store.riichiDeclared = [true, false, false, false];
    store.yourSeat = 0;
    const host = mount(
      renderPlayerHand(
        handProps({
          tiles: tiles(0, 1, 2),
          drawnTile: tile(5),
          canDiscard: true,
          store,
        })
      )
    );
    expect(clickable(host).length).toBe(1);
    expect(clickable(host)[0].querySelector('.mahjong-tile')).toBeNull();
  });

  test('in riichi the undrawn tiles are grayed', () => {
    const store = fakeStore();
    store.riichiDeclared = [true, false, false, false];
    const host = mount(
      renderPlayerHand(
        handProps({
          tiles: tiles(0, 1, 2),
          drawnTile: tile(5),
          canDiscard: true,
          store,
        })
      )
    );
    expect(grayed(host).length).toBe(3);
  });

  test('riichi status is read from your seat, not seat 0', () => {
    // You sitting in a different seat must not inherit someone else's riichi.
    const store = fakeStore();
    store.yourSeat = 2;
    store.riichiDeclared = [true, false, false, false];
    const host = mount(
      renderPlayerHand(
        handProps({
          tiles: tiles(0, 1, 2),
          drawnTile: tile(5),
          canDiscard: true,
          store,
        })
      )
    );
    expect(grayed(host).length, 'seat 2 is not the riichi player').toBe(0);
  });

  // -------------------------------------------------------- hover hints

  test('hovering a tile records both the tile and its index', () => {
    const store = fakeStore();
    const host = mount(renderPlayerHand(handProps({ tiles: tiles(0, 1, 2), store })));
    const t = host.querySelectorAll('.mahjong-tile')[2] as HTMLElement;
    t.dispatchEvent(new Event('mouseenter'));
    expect(store.hovered.length).toBe(1);
    expect(store.hovered[0].index).toBe(2);
    expect(store.hoveredDiscard[0]).toBe(2);
    t.dispatchEvent(new Event('mouseleave'));
    expect(store.hovered[store.hovered.length - 1]).toBeNull();
  });

  test('the waits hint only appears when there are waits', () => {
    const withNone = fakeStore();
    withNone.getTenpaiWaits = () => [];
    expect(
      mount(renderPlayerHand(handProps({ tiles: tiles(0, 1, 2), store: withNone }))).querySelector('.hand-waits-hint')
    ).toBeNull();

    const withSome = fakeStore();
    withSome.riichiDeclared = [true, false, false, false];
    withSome.getTenpaiWaits = () => [{ face: '3p', count: 4 }];
    const host = mount(renderPlayerHand(handProps({ tiles: tiles(0, 1, 2), store: withSome })));
    expect(host.querySelector('.hand-waits-hint')).not.toBeNull();
    expect(host.textContent).toContain('4 left');
  });

  test('a hovered discard hint takes precedence over the standing tenpai', () => {
    const store = fakeStore();
    store.riichiDeclared = [true, false, false, false];
    store.getTenpaiWaits = () => [{ face: '3p', count: 4 }];
    store.hoveredDiscardWaitHint = [{ face: '7s', count: 2 }];
    const host = mount(renderPlayerHand(handProps({ tiles: tiles(0, 1, 2), store })));
    const labels = [...host.querySelectorAll('.hand-waits-hint__list svg')].map((s) => s.getAttribute('aria-label'));
    expect(labels, 'the hovered discard wait replaces the standing tenpai wait').toEqual(['7s']);
  });

  test('a wait with no copies left is flagged as empty', () => {
    const store = fakeStore();
    store.riichiDeclared = [true, false, false, false];
    store.getTenpaiWaits = () => [{ face: '3p', count: 0 }];
    const host = mount(renderPlayerHand(handProps({ tiles: tiles(0, 1, 2), store })));
    expect(host.querySelectorAll('.hand-waits-hint__count.is-empty').length).toBe(1);
  });
});

// --------------------------------------------------------------- action bar

describe('renderActionBar', () => {
  const btn = (host: HTMLElement, label: string): HTMLElement | null =>
    [...host.querySelectorAll('button')].find((b) => b.textContent!.trim().startsWith(label)) ?? null;

  test('renders nothing when there is no action to take', () => {
    expect(mount(renderActionBar(fakeStore())).querySelector('.action-bar')).toBeNull();
  });

  test('PASS is always offered once something else is', () => {
    const store = fakeStore();
    store.actions.can_chi = true;
    expect(btn(mount(renderActionBar(store)), 'PASS')).toBeTruthy();
  });

  test('offers only the calls the server allows', () => {
    const store = fakeStore();
    store.actions.can_ron = true;
    store.actions.can_pon = true;
    const host = mount(renderActionBar(store));
    expect(btn(host, 'RON')).toBeTruthy();
    expect(btn(host, 'PON')).toBeTruthy();
    expect(btn(host, 'CHI')).toBeNull();
    expect(btn(host, 'KAN')).toBeNull();
    expect(btn(host, 'RIICHI')).toBeNull();
  });

  test('RON takes precedence over nothing else and calls the store', () => {
    const store = fakeStore();
    store.actions.can_ron = true;
    btn(mount(renderActionBar(store)), 'RON')!.dispatchEvent(new Event('click'));
    expect(store.calls).toContain('callRon');
  });

  test('PON and CHI call through', () => {
    const store = fakeStore();
    store.actions.can_pon = true;
    store.actions.can_chi = true;
    const host = mount(renderActionBar(store));
    btn(host, 'PON')!.dispatchEvent(new Event('click'));
    btn(host, 'CHI')!.dispatchEvent(new Event('click'));
    expect(store.calls).toEqual(['callPon', 'callChi']);
  });

  test('KAN defers tile resolution to the store (pendingKanIndex)', () => {
    const store = fakeStore();
    store.actions.can_kan = true;
    btn(mount(renderActionBar(store)), 'KAN')!.dispatchEvent(new Event('click'));
    // Action-bar passes no hardcoded index; the store resolves pendingKanIndex.
    expect(store.calls).toEqual(['callKan:undefined']);
  });

  test('RIICHI enters riichi mode rather than declaring directly', () => {
    // Declaring riichi immediately would discard an arbitrary tile; the flow is to pick
    // the discard tile first.
    const store = fakeStore();
    store.actions.can_riichi = true;
    btn(mount(renderActionBar(store)), 'RIICHI')!.dispatchEvent(new Event('click'));
    expect(store.calls).toEqual(['enterRiichiMode']);
  });

  test('PASS is offered even when nothing else is callable', () => {
    const store = fakeStore();
    store.actions.can_discard = true;
    store.riichiDeclared = [false, false, false, false];
    const host = mount(renderActionBar(store));
    // can_discard alone is not enough to show the bar for a non-riichi player...
    expect(host.querySelector('.action-bar')).toBeNull();
  });

  test('riichi mode shows only a prompt and CANCEL', () => {
    const store = fakeStore();
    store.isRiichiMode = true;
    const host = mount(renderActionBar(store));
    expect(host.querySelector('.action-bar--riichi-mode')).not.toBeNull();
    expect(host.textContent).toContain('Select a highlighted tile');
    expect(host.querySelectorAll('button').length).toBe(1);
    btn(host, 'CANCEL')!.dispatchEvent(new Event('click'));
    expect(store.calls).toEqual(['cancelRiichiMode']);
  });

  test('after riichi the bar offers TSUMOGIRI, not the full call set', () => {
    const store = fakeStore();
    store.riichiDeclared = [true, false, false, false];
    store.actions.can_discard = true;
    store.hand = tiles(0, 1, 2);
    store.drawnTile = tile(7);
    const host = mount(renderActionBar(store));
    expect(btn(host, 'TSUMOGIRI')).toBeTruthy();
    expect(btn(host, 'RON')).toBeNull();
    expect(btn(host, 'PON')).toBeNull();
    expect(btn(host, 'PASS')).toBeNull();
  });

  test('TSUMOGIRI discards the drawn tile when there is one', () => {
    const store = fakeStore();
    store.riichiDeclared = [true, false, false, false];
    store.actions.can_discard = true;
    store.hand = tiles(0, 1, 2);
    store.drawnTile = tile(7);
    btn(mount(renderActionBar(store)), 'TSUMOGIRI')!.dispatchEvent(new Event('click'));
    expect(store.discarded.length).toBe(1);
    expect(store.discarded[0].index).toBe(7);
  });

  test('with no drawn tile TSUMOGIRI falls back to the last tile in hand', () => {
    const store = fakeStore();
    store.riichiDeclared = [true, false, false, false];
    store.actions.can_discard = true;
    store.hand = tiles(0, 1, 2);
    store.drawnTile = null;
    btn(mount(renderActionBar(store)), 'TSUMOGIRI')!.dispatchEvent(new Event('click'));
    expect(store.discarded.length).toBe(1);
    expect(store.discarded[0].index).toBe(2);
  });

  test('TSUMO is offered alongside TSUMOGIRI after riichi when available', () => {
    const store = fakeStore();
    store.riichiDeclared = [true, false, false, false];
    store.actions.can_discard = true;
    store.actions.can_tsumo = true;
    store.drawnTile = tile(7);
    const host = mount(renderActionBar(store));
    expect(btn(host, 'TSUMO')).toBeTruthy();
    expect(btn(host, 'TSUMOGIRI')).toBeTruthy();
  });

  test('a player who is not in riichi does not see TSUMOGIRI', () => {
    const store = fakeStore();
    store.yourSeat = 0;
    store.riichiDeclared = [false, true, false, false];
    store.actions.can_discard = true;
    store.actions.can_ron = true;
    const host = mount(renderActionBar(store));
    expect(btn(host, 'TSUMOGIRI')).toBeNull();
    expect(btn(host, 'RON')).toBeTruthy();
  });
});
