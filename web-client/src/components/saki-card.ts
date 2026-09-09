import { html, TemplateResult } from 'lit-html';

export interface SakiCardProps {
  character: string; // e.g. 'saki', 'nodoka', 'koromo', 'yuuki', 'hisa', 'mako' or full id 'miyanaga-saki'
  placement?: 'bottom' | 'top' | 'left' | 'right';
  disabled?: boolean;
  onClick?: () => void;
}

const CHAR_ALIAS: Record<string, string> = {
  saki: 'miyanaga-saki',
  nodoka: 'haramura-nodoka',
  koromo: 'amae-koromo',
  yuuki: 'kataoka-yuuki',
  hisa: 'takei-hisa',
  mako: 'someya-mako',
  teru: 'miyanaga-teru',
  toki: 'onjouji-toki',
  kuro: 'matsumi-kuro',
};

export function renderSakiCard(props: SakiCardProps): TemplateResult {
  const rawId = (props.character || 'none').toLowerCase().trim();
  if (rawId === 'none' || !rawId) {
    return html`<div class="saki-card-empty" style="width: 68px; height: 98px; border: 1px dashed rgba(255,255,255,0.2); border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; color: #64748b;">No Power</div>`;
  }

  const charClass = CHAR_ALIAS[rawId] || rawId;
  const placementClass = `saki-card-wrapper--${props.placement || 'bottom'}`;
  const disabledClass = props.disabled ? 'disabled' : '';

  return html`
    <div class="saki-card-wrapper ${placementClass}" @click=${props.onClick || null}>
      <div class="saki-card ${charClass} ${disabledClass}"></div>
      <div class="saki-card-preview ${charClass}"></div>
    </div>
  `;
}
