import { createLoadingMarkup, createUnsupportedSizeMarkup, escapeHtml } from './templateUtils.js';

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
      ${createUnsupportedSizeMarkup('Race controls')}
      ${createLoadingMarkup('Race controls')}
    </header>
  `;
}

export function createSafetyCarControlMarkup({ compact = false } = {}) {
  if (compact) {
    return '<button class="sim-control sim-control--safety" type="button" data-safety-car aria-pressed="false">Safety Car</button>';
  }
  return `
    <div class="standalone-control" data-paddock-component="safety-car-control">
      <button class="sim-control sim-control--safety" type="button" data-safety-car aria-pressed="false">Safety Car</button>
      ${createUnsupportedSizeMarkup('Safety car control')}
    </div>
  `;
}
