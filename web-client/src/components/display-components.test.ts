// display-components.test.ts — center-info, game-log and power-badge.
//
// These are the components that put numbers and state in front of the player: scores,
// honba, sticks on the table, wall count, seat winds, the action log, and the power
// meter. A mistake here is not cosmetic and not loud — the board simply tells the
// player something untrue.
//
// center-info's seat mapping is the part most worth pinning: it derives seat winds from
// the dealer and positions from your own seat, and those two derivations have to agree
// with the seats board.ts renders the ponds for.

import { describe, test, expect, beforeEach } from 'vitest';
import { render } from 'lit-html';

import { renderCenterInfo, type CenterInfoProps } from './center-info';
import { renderGameLog } from './game-log';
import { renderPowerBadge } from './power-badge';

function mount(template: any): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  render(template, host);
  return host;
}

const tile = (index: number) => ({ index });

function centerProps(over: Partial<CenterInfoProps> = {}): CenterInfoProps {
  return {
    roundWind: 'East',
    roundNumber: 1,
    honba: 0,
    riichiSticks: 0,
    remainingTiles: 70,
    doraIndicators: [tile(8)],
    scores: [25000, 25000, 25000, 25000],
    currentTurn: -1,
    dealerSeat: 0,
    yourSeat: 0,
    ...over,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

// ------------------------------------------------------------- center info

describe('renderCenterInfo', () => {
  const bar = (host: HTMLElement, pos: string) =>
    host.querySelector(`.board-center__score-bar--${pos}`) as HTMLElement;

  test('shows the round as kanji plus number', () => {
    expect(mount(renderCenterInfo(centerProps())).querySelector('.board-center__round')!.textContent!.trim())
      .toBe('東1局');
    expect(mount(renderCenterInfo(centerProps({ roundWind: 'South', roundNumber: 2 })))
      .querySelector('.board-center__round')!.textContent!.trim()).toBe('南2局');
  });

  test('an unknown round wind falls back to East rather than rendering undefined', () => {
    const host = mount(renderCenterInfo(centerProps({ roundWind: 'Nowhere' as any })));
    expect(host.querySelector('.board-center__round')!.textContent!.trim()).toBe('東1局');
  });

  test('renders one score bar per position', () => {
    const host = mount(renderCenterInfo(centerProps()));
    for (const p of ['bottom', 'right', 'top', 'left']) {
      expect(bar(host, p), `missing ${p}`).not.toBeNull();
    }
  });

  test('the dealer is shown as East and marked', () => {
    const host = mount(renderCenterInfo(centerProps({ dealerSeat: 0, yourSeat: 0 })));
    expect(bar(host, 'bottom').querySelector('.board-center__wind')!.className).toContain('is-dealer');
  });

  test('seat winds are derived from the dealer, not from seat index', () => {
    // Dealer seat 1 -> seat 1 is East, 2 South, 3 West, 0 North.
    const host = mount(renderCenterInfo(centerProps({ dealerSeat: 1, yourSeat: 0 })));
    const windOf = (pos: string) =>
      bar(host, pos).querySelector('.board-center__wind')!.textContent!.trim();
    // yourSeat 0 -> bottom=0, right=1, top=2, left=3. With dealerSeat 1: seat1 East,
    // seat2 South, seat3 West, seat0 North.
    expect(windOf('bottom')).toBe('北');
    expect(windOf('right')).toBe('東');
    expect(windOf('top')).toBe('南');
    expect(windOf('left')).toBe('西');
  });

  test('positions follow your seat', () => {
    // yourSeat 2 -> bottom=2, right=3, top=0, left=1
    const host = mount(renderCenterInfo(centerProps({
      dealerSeat: 0, yourSeat: 2,
      scores: [31000, 22000, 20000, 27000],
    })));
    const scoreOf = (pos: string) =>
      bar(host, pos).querySelector('.board-center__score')!.textContent!.trim();
    expect(scoreOf('bottom')).toBe('20000');
    expect(scoreOf('right')).toBe('27000');
    expect(scoreOf('top')).toBe('31000');
    expect(scoreOf('left')).toBe('22000');
  });

  test('a missing score falls back to the starting score instead of blank', () => {
    const host = mount(renderCenterInfo(centerProps({ scores: [25000] })));
    expect(bar(host, 'right').querySelector('.board-center__score')!.textContent!.trim())
      .toBe('25000');
  });

  test('the acting seat is marked active', () => {
    const host = mount(renderCenterInfo(centerProps({ currentTurn: 2, yourSeat: 0 })));
    expect(bar(host, 'top').className).toContain('is-active');
    expect(bar(host, 'bottom').className).not.toContain('is-active');
  });

  test('nobody is active between turns', () => {
    const host = mount(renderCenterInfo(centerProps({ currentTurn: -1 })));
    expect(host.querySelectorAll('.is-active').length).toBe(0);
  });

  test('wall, honba and stick counts are shown', () => {
    const host = mount(renderCenterInfo(centerProps({ remainingTiles: 13, honba: 2, riichiSticks: 3 })));
    const text = host.querySelector('.board-center__stats')!.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('13');
    expect(text).toContain('2');
    expect(text).toContain('3');
  });

  test('dora indicators are shown face up, and the rest of the slots face down', () => {
    const host = mount(renderCenterInfo(centerProps({ doraIndicators: [tile(8)] })));
    expect(host.querySelectorAll('.board-center__dora-tiles .mahjong-tile--back').length).toBe(4);
    expect(host.querySelector('.board-center__dora-tiles use')!.getAttribute('href')).toBe('#tile-9m');
  });

  test('a full set of five indicators leaves no face-down filler', () => {
    const host = mount(renderCenterInfo(centerProps({
      doraIndicators: [tile(0), tile(1), tile(2), tile(3), tile(4)],
    })));
    expect(host.querySelectorAll('.board-center__dora-tiles .mahjong-tile--back').length).toBe(0);
    expect(host.querySelectorAll('.board-center__dora-tiles .mahjong-tile').length).toBe(5);
  });

  test('more than five indicators does not produce a negative filler length', () => {
    const host = mount(renderCenterInfo(centerProps({
      doraIndicators: [tile(0), tile(1), tile(2), tile(3), tile(4), tile(5)],
    })));
    expect(host.querySelectorAll('.mahjong-tile--back').length).toBe(0);
  });

  test('a riichi pip is shown only for a seat in riichi', () => {
    const host = mount(renderCenterInfo(centerProps({
      riichiSeats: [false, true, false, false], yourSeat: 0,
    })));
    expect(host.querySelectorAll('.board-center__riichi-pip').length).toBe(1);
    expect(bar(host, 'right').querySelector('.board-center__riichi-pip')).not.toBeNull();
  });

  test('no riichi pips when nobody is in riichi', () => {
    const host = mount(renderCenterInfo(centerProps({
      riichiSeats: [false, false, false, false],
    })));
    expect(host.querySelectorAll('.board-center__riichi-pip').length).toBe(0);
  });

  test('rendering without riichiSeats does not throw', () => {
    expect(() => mount(renderCenterInfo(centerProps()))).not.toThrow();
  });

  test('hovering a dora indicator reports it and then clears', () => {
    const hovered: any[] = [];
    const host = mount(renderCenterInfo(centerProps({ onTileHover: (t) => hovered.push(t) })));
    const dora = host.querySelector('.board-center__dora-tiles .mahjong-tile') as HTMLElement;
    dora.dispatchEvent(new Event('mouseenter'));
    expect(hovered[0]).toEqual({ index: 8 });
    dora.dispatchEvent(new Event('mouseleave'));
    expect(hovered[hovered.length - 1]).toBeNull();
  });
});

// --------------------------------------------------------------- game log

describe('renderGameLog', () => {
  const store = (over: Record<string, any> = {}) => ({
    isLogExpanded: true,
    logs: [] as any[],
    toggles: 0,
    toggleLog() { this.toggles++; },
    ...over,
  } as any);

  const entry = (over: Record<string, any> = {}) => ({
    id: '1', timestamp: 'E1', category: 'turn', message: 'P0 discarded 1m', ...over,
  });

  test('the header toggles the log on click', () => {
    const s = store();
    const host = mount(renderGameLog(s));
    (host.querySelector('.game-log__header') as HTMLElement).dispatchEvent(new Event('click'));
    expect(s.toggles).toBe(1);
  });

  test('the header is keyboard operable', () => {
    // It carries role="button" tabindex="0", so Enter and Space must work. It did not:
    // this was the only element in the client with those attributes and it had no key
    // handler, so it was focusable and announced as a button while doing nothing
    // (WCAG 2.1.1).
    for (const key of ['Enter', ' ']) {
      const s = store();
      const host = mount(renderGameLog(s));
      const header = host.querySelector('.game-log__header') as HTMLElement;
      header.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      expect(s.toggles, `key "${key}" should toggle`).toBe(1);
    }
  });

  test('other keys do not toggle', () => {
    const s = store();
    const host = mount(renderGameLog(s));
    const header = host.querySelector('.game-log__header') as HTMLElement;
    for (const key of ['a', 'Tab', 'Escape', 'ArrowDown']) {
      header.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    }
    expect(s.toggles).toBe(0);
  });

  test('the header is focusable and exposed as a button', () => {
    const header = mount(renderGameLog(store())).querySelector('.game-log__header')!;
    expect(header.getAttribute('role')).toBe('button');
    expect(header.getAttribute('tabindex')).toBe('0');
  });

  test('the toggle button stops propagation so it toggles once, not twice', () => {
    // The button sits inside the header, which is itself clickable. Without
    // stopPropagation a single click would fire both handlers.
    const s = store();
    const host = mount(renderGameLog(s));
    (host.querySelector('.game-log__toggle-btn') as HTMLElement).dispatchEvent(
      new Event('click', { bubbles: true }),
    );
    expect(s.toggles).toBe(1);
  });

  test('expanded and collapsed are distinguished by class', () => {
    expect(mount(renderGameLog(store({ isLogExpanded: true }))).querySelector('.game-log')!.className)
      .toContain('game-log--expanded');
    expect(mount(renderGameLog(store({ isLogExpanded: false }))).querySelector('.game-log')!.className)
      .toContain('game-log--collapsed');
  });

  test('a collapsed log hides its entries', () => {
    const host = mount(renderGameLog(store({ isLogExpanded: false, logs: [entry()] })));
    expect(host.querySelectorAll('.game-log__item').length).toBe(0);
  });

  test('an expanded log shows every entry with its category class', () => {
    const host = mount(renderGameLog(store({
      logs: [entry({ id: '1', category: 'turn' }), entry({ id: '2', category: 'win', message: 'won' })],
    })));
    expect(host.querySelectorAll('.game-log__item').length).toBe(2);
    expect(host.querySelector('.game-log__item--win')!.textContent).toContain('won');
  });

  test('the entry count is shown even when collapsed', () => {
    const host = mount(renderGameLog(store({ isLogExpanded: false, logs: [entry(), entry()] })));
    expect(host.querySelector('.game-log__count')!.textContent!.trim()).toBe('2');
  });

  test('an empty expanded log shows the placeholder rather than nothing', () => {
    const host = mount(renderGameLog(store({ logs: [] })));
    expect(host.querySelector('.game-log__empty')).not.toBeNull();
  });

  test('details are rendered only when present', () => {
    const withD = mount(renderGameLog(store({ logs: [entry({ details: 'because' })] })));
    expect(withD.querySelector('.game-log__details')!.textContent).toContain('because');
    const without = mount(renderGameLog(store({ logs: [entry()] })));
    expect(without.querySelector('.game-log__details')).toBeNull();
  });

  test('every category gets a badge, including an unknown one', () => {
    for (const cat of ['turn', 'call', 'power', 'rule', 'win', 'mystery' as any]) {
      const host = mount(renderGameLog(store({ logs: [entry({ category: cat })] })));
      const badge = host.querySelector('.game-log__badge')!;
      expect(badge.textContent!.trim(), `category ${cat}`).not.toBe('');
      expect(badge.className).toContain(`game-log__badge--${cat}`);
    }
  });
});

// ------------------------------------------------------------ power badge

describe('renderPowerBadge', () => {
  const state = (over: Record<string, any> = {}) => ({
    power: 'saki', type: 'flow', active: false, gauge: 50, armedTier: 0,
    availableTiers: undefined, description: 'Burns a tile.', ...over,
  } as any);

  test('renders nothing for no power', () => {
    expect(mount(renderPowerBadge(state({ power: 'none' }))).querySelector('.power-badge')).toBeNull();
  });

  test('a flow-type power shows the gauge as a percentage', () => {
    const host = mount(renderPowerBadge(state({ gauge: 42 })));
    expect(host.querySelector('.power-badge__pct')!.textContent!.trim()).toBe('42%');
    const fill = host.querySelector('.power-badge__meter-fill') as HTMLElement;
    expect(fill.style.width).toBe('42%');
  });

  test('the gauge is clamped to 0..100', () => {
    expect(mount(renderPowerBadge(state({ gauge: 150 }))).querySelector('.power-badge__pct')!.textContent!.trim())
      .toBe('100%');
    expect(mount(renderPowerBadge(state({ gauge: -20 }))).querySelector('.power-badge__pct')!.textContent!.trim())
      .toBe('0%');
  });

  test('an absent gauge falls back to full when active, otherwise a nominal third', () => {
    expect(mount(renderPowerBadge(state({ gauge: undefined, active: true })))
      .querySelector('.power-badge__pct')!.textContent!.trim()).toBe('100%');
    expect(mount(renderPowerBadge(state({ gauge: undefined, active: false })))
      .querySelector('.power-badge__pct')!.textContent!.trim()).toBe('33%');
  });

  test('the active class reflects the active flag', () => {
    expect(mount(renderPowerBadge(state({ active: true }))).querySelector('.power-badge')!.className)
      .toContain('power-badge--active');
    expect(mount(renderPowerBadge(state({ active: false }))).querySelector('.power-badge')!.className)
      .not.toContain('power-badge--active');
  });

  test('the character class is derived from the power key', () => {
    expect(mount(renderPowerBadge(state({ power: 'saki' }))).querySelector('.power-badge')!.className)
      .toContain('power-badge--saki');
    expect(mount(renderPowerBadge(state({ power: 'saki-normal', type: 'normal' })))
      .querySelector('.power-badge')!.className).toContain('power-badge--saki-normal');
  });

  test('a normal-type power renders a passive pill, not a Flow meter', () => {
    const host = mount(renderPowerBadge(state({ type: 'normal' })));
    expect(host.querySelector('.power-badge--passive')).not.toBeNull();
    expect(host.querySelector('.power-badge__pct')!.textContent!.trim()).toBe('PASSIVE');
    expect(host.querySelector('.power-badge__meter')).toBeNull();
  });

  test('a normal-type power never offers the tier console', () => {
    const host = mount(renderPowerBadge(state({ type: 'normal' })));
    expect(host.querySelectorAll('.power-badge__tier-btn').length).toBe(0);
  });

  test('you only see the tier console for your own seat', () => {
    const onSelectTier = () => {};
    const mine = mount(renderPowerBadge(state(), { isYou: true, onSelectTier }));
    expect(mine.querySelectorAll('.power-badge__tier-btn').length).toBeGreaterThan(0);
    const theirs = mount(renderPowerBadge(state(), { isYou: false, onSelectTier }));
    expect(theirs.querySelectorAll('.power-badge__tier-btn').length).toBe(0);
  });

  test('without a tier handler no console is rendered even for you', () => {
    const host = mount(renderPowerBadge(state(), { isYou: true }));
    expect(host.querySelectorAll('.power-badge__tier-btn').length).toBe(0);
  });

  test('the default tier costs are 25/50/100/150 and the affordance matches', () => {
    const host = mount(renderPowerBadge(state({ gauge: 100 }), { isYou: true, onSelectTier: () => {} }));
    const labels = [...host.querySelectorAll('.power-badge__tier-btn')].map((b) => b.textContent!.trim());
    expect(labels).toEqual(['T1 (25)', 'T2 (50)', 'T3 (100)', 'T4 (150)']);
    // A full gauge affords every tier.
    expect(host.querySelectorAll('.power-badge__tier-btn.can-afford').length).toBe(4);
    expect(host.querySelectorAll('.power-badge__tier-btn[disabled]').length).toBe(0);
  });

  test('an empty gauge affords nothing', () => {
    const host = mount(renderPowerBadge(state({ gauge: 0 }), { isYou: true, onSelectTier: () => {} }));
    expect(host.querySelectorAll('.power-badge__tier-btn.can-afford').length).toBe(0);
    expect(host.querySelectorAll('.power-badge__tier-btn[disabled]').length).toBe(4);
  });

  test('the tier boundary is where the cost crosses the gauge', () => {
    // Tier 1 costs 25 of a 150-point meter, so it needs >= 17%.
    const at17 = mount(renderPowerBadge(state({ gauge: 17 }), { isYou: true, onSelectTier: () => {} }));
    const t1 = at17.querySelector('.power-badge__tier-btn')!;
    expect(t1.className).toContain('can-afford');
    const at16 = mount(renderPowerBadge(state({ gauge: 16 }), { isYou: true, onSelectTier: () => {} }));
    expect(at16.querySelector('.power-badge__tier-btn')!.className).not.toContain('can-afford');
  });

  test('clicking an unarmed tier arms it; clicking the armed one disarms', () => {
    const picked: number[] = [];
    const onSelectTier = (t: number) => picked.push(t);
    let armed = 0;
    const build = () => renderPowerBadge(state({ armedTier: armed }), { isYou: true, onSelectTier });

    let host = mount(build());
    (host.querySelectorAll('.power-badge__tier-btn')[1] as HTMLElement).dispatchEvent(new Event('click'));
    expect(picked).toEqual([2]);
    armed = 2;

    host = mount(build());
    const t2 = host.querySelectorAll('.power-badge__tier-btn')[1] as HTMLElement;
    expect(t2.className).toContain('is-armed');
    t2.dispatchEvent(new Event('click'));
    expect(picked, 'clicking the armed tier clears it').toEqual([2, 0]);
  });

  test('the conserve button clears the armed tier', () => {
    const picked: number[] = [];
    const host = mount(renderPowerBadge(state({ armedTier: 3 }), {
      isYou: true, onSelectTier: (t: number) => picked.push(t),
    }));
    (host.querySelector('.power-badge__tier-conserve') as HTMLElement).dispatchEvent(new Event('click'));
    expect(picked).toEqual([0]);
  });

  test('conserving is indicated when no tier is armed', () => {
    const host = mount(renderPowerBadge(state({ armedTier: 0 }), { isYou: true, onSelectTier: () => {} }));
    expect(host.querySelector('.power-badge__tier-conserve')!.textContent).toContain('✓');
    const armed = mount(renderPowerBadge(state({ armedTier: 2 }), { isYou: true, onSelectTier: () => {} }));
    expect(armed.querySelector('.power-badge__tier-conserve')!.className).not.toContain('is-armed');
  });

  test('server-provided tiers replace the defaults', () => {
    const host = mount(renderPowerBadge(state({
      availableTiers: [{ tier: 1, name: 'Only', cost: 10, canAfford: true, canActivate: true }],
    }), { isYou: true, onSelectTier: () => {} }));
    expect(host.querySelectorAll('.power-badge__tier-btn').length).toBe(1);
    expect(host.querySelector('.power-badge__tier-btn')!.textContent).toContain('T1 (10)');
  });

  test('advice text is shown only for your own seat', () => {
    expect(mount(renderPowerBadge(state(), { isYou: true })).querySelector('.power-badge__advice'))
      .not.toBeNull();
    expect(mount(renderPowerBadge(state(), { isYou: false })).querySelector('.power-badge__advice'))
      .toBeNull();
  });
});