import { createLoadingMarkup, escapeHtml } from './templateUtils.js';

function buttonHiddenAttribute(isVisible) {
  return isVisible ? '' : ' hidden';
}

export function createRaceControlsMarkup({
  title,
  kicker,
  backLinkHref,
  backLinkLabel,
  showBackLink,
}) {
  return `
    <header class="sim-topbar" data-paddock-component="race-controls">
      <a class="sim-backlink" href="${escapeHtml(backLinkHref)}"${buttonHiddenAttribute(showBackLink)}>${escapeHtml(backLinkLabel)}</a>
      <div class="sim-title-block">
        <p class="sim-kicker">${escapeHtml(kicker)}</p>
        <h1>${escapeHtml(title)}</h1>
      </div>
      <div class="sim-controls" aria-label="Race controls">
        ${createSafetyCarControlMarkup({ compact: true })}
        <button class="sim-control" type="button" data-restart-race>Restart</button>
      </div>
      ${createLoadingMarkup('Race controls')}
    </header>
  `;
}

export function createSafetyCarControlMarkup({ compact = false } = {}) {
  const className = compact
    ? 'sim-control sim-control--safety'
    : 'sim-control sim-control--safety standalone-control';
  const componentAttribute = compact ? '' : ' data-paddock-component="safety-car-control"';
  return `<button class="${className}" type="button" data-safety-car aria-pressed="false"${componentAttribute}>Safety Car</button>`;
}
