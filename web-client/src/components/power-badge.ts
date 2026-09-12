import { html, TemplateResult } from 'lit-html';
import { SuperpowerState, TierInfo } from '../state/store';

export function renderPowerBadge(
  state: SuperpowerState,
  opts?: {
    isYou?: boolean;
    onSelectTier?: (tier: number) => void;
  }
): TemplateResult {
  const power = state.power || 'none';
  if (power === 'none') {
    return html``;
  }

  const isYou = !!opts?.isYou;
  const onSelectTier = opts?.onSelectTier;
  const activeClass = state.active ? 'power-badge--active' : '';
  const youClass = isYou ? 'power-badge--is-you' : '';
  const charClass = `power-badge--${power.toLowerCase()}`;

  // Normal-type powers are always-on passives outside the Flow economy: render
  // a passive pill instead of a meter + tier console.
  if (state.type === 'normal') {
    return html`
      <div class="power-badge power-badge--passive ${charClass} ${activeClass} ${youClass}" title="${state.description || `${power} (passive)`}">
        <div class="power-badge__header">
          <span class="power-badge__icon">${state.active ? '⚡' : '✦'}</span>
          <span class="power-badge__name">${power}</span>
          <span class="power-badge__pct power-badge__pct--passive">PASSIVE</span>
        </div>
        ${isYou && state.description ? html`<div class="power-badge__advice" title="${state.description}">${state.description}</div>` : ''}
      </div>
    `;
  }

  const gaugePct = state.gauge !== undefined && state.gauge !== null ? Math.min(100, Math.max(0, state.gauge)) : (state.active ? 100 : 33);
  const armedTier = state.armedTier || 0;

  const defaultTiers: TierInfo[] = [
    { tier: 1, name: 'Tier 1', cost: 25, canAfford: gaugePct >= Math.round((25 / 150) * 100), canActivate: true },
    { tier: 2, name: 'Tier 2', cost: 50, canAfford: gaugePct >= Math.round((50 / 150) * 100), canActivate: true },
    { tier: 3, name: 'Tier 3', cost: 100, canAfford: gaugePct >= Math.round((100 / 150) * 100), canActivate: true },
    { tier: 4, name: 'Tier 4', cost: 150, canAfford: gaugePct >= 100, canActivate: true },
  ];
  const tiers = state.availableTiers && state.availableTiers.length ? state.availableTiers : defaultTiers;

  return html`
    <div class="power-badge ${charClass} ${activeClass} ${youClass}" title="${state.description || `${power} power (${gaugePct}% charged)`}">
      <div class="power-badge__header">
        <span class="power-badge__icon">${state.active ? '⚡' : '✦'}</span>
        <span class="power-badge__name">${power}</span>
        <span class="power-badge__pct">${gaugePct}%</span>
      </div>
      <div class="power-badge__meter">
        <div class="power-badge__meter-fill" style="width: ${gaugePct}%;"></div>
      </div>

      ${isYou && state.description ? html`<div class="power-badge__advice" title="${state.description}">${state.description}</div>` : ''}

      ${isYou && onSelectTier
        ? html`
            <div class="power-badge__tiers">
              ${tiers.map((t) => {
                const isArmed = armedTier === t.tier;
                return html`
                  <button
                    class="power-badge__tier-btn ${isArmed ? 'is-armed' : ''} ${t.canAfford ? 'can-afford' : ''}"
                    ?disabled=${!t.canAfford}
                    title="${t.name} (Cost: ${t.cost} Flow)"
                    @click=${() => onSelectTier(isArmed ? 0 : t.tier)}
                  >
                    T${t.tier} (${t.cost})
                  </button>
                `;
              })}
              <button
                class="power-badge__tier-conserve ${armedTier === 0 ? 'is-armed' : ''}"
                title="Conserve Flow: Passives only, save meter for later"
                @click=${() => onSelectTier(0)}
              >
                ${armedTier === 0 ? '✓ Conserving' : 'Conserve Flow'}
              </button>
            </div>
          `
        : ''}
    </div>
  `;
}
