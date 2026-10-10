import { html, TemplateResult } from 'lit-html';
import { GameLogEntry, GameStore } from '../state/store';

export function renderGameLog(store: GameStore): TemplateResult {
  const isExpanded = store.isLogExpanded;
  const logs = store.logs;

  return html`
    <aside
      class="game-log ${isExpanded ? 'game-log--expanded' : 'game-log--collapsed'}"
      aria-label="Game Action and Rule Log"
    >
      <div
        class="game-log__header"
        @click=${() => store.toggleLog()}
        @keydown=${(e: KeyboardEvent) => {
          // role="button" + tabindex="0" promises a keyboard-operable control. This
          // element was the only one in the client carrying those attributes and it had
          // no key handler at all, so it was focusable and announced as a button while
          // Enter and Space did nothing (WCAG 2.1.1). Enter and Space are the two keys
          // a native <button> responds to, so both are handled here.
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
            e.preventDefault();
            store.toggleLog();
          }
        }}
        role="button"
        tabindex="0"
      >
        <div class="game-log__title">
          <span class="game-log__icon">📜</span>
          <span class="game-log__label">Action & Rule Log</span>
          <span class="game-log__count">${logs.length}</span>
        </div>
        <button
          class="game-log__toggle-btn"
          title="${isExpanded ? 'Collapse Log' : 'Expand Log'}"
          aria-label="${isExpanded ? 'Collapse Log' : 'Expand Log'}"
          @click=${(e: Event) => {
            e.stopPropagation();
            store.toggleLog();
          }}
        >
          ${isExpanded ? '▼' : '▲'}
        </button>
      </div>

      ${
        isExpanded
          ? html`
              <div class="game-log__body" id="game-log-body">
                ${
                  logs.length === 0
                    ? html`<div class="game-log__empty">
                        Game in progress. Discards, calls, superpowers, and rules will be logged here.
                      </div>`
                    : logs.map(
                        (log) => html`
                          <div class="game-log__item game-log__item--${log.category}">
                            <div class="game-log__item-head">
                              <span class="game-log__time">${log.timestamp}</span>
                              <span class="game-log__badge game-log__badge--${log.category}">
                                ${renderCategoryBadge(log.category)}
                              </span>
                            </div>
                            <div class="game-log__msg">${log.message}</div>
                            ${log.details ? html`<div class="game-log__details">${log.details}</div>` : ''}
                          </div>
                        `
                      )
                }
              </div>
            `
          : ''
      }
    </aside>
  `;
}

function renderCategoryBadge(category: GameLogEntry['category']): string {
  switch (category) {
    case 'turn':
      return '🀄 Turn';
    case 'call':
      return '✨ Call';
    case 'power':
      return '⚡ Power';
    case 'rule':
      return '⚠️ Rule';
    case 'win':
      return '🏆 Win';
    default:
      return 'Info';
  }
}
