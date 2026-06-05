import { createComponentSurfaceMarkup, escapeHtml } from './templateUtils.js';

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
  const body = `
      <a class="sim-backlink" href="${escapeHtml(backLinkHref)}"${buttonHiddenAttribute(showBackLink)}>${escapeHtml(backLinkLabel)}</a>
      <div class="sim-title-block">
        <p class="sim-kicker">${escapeHtml(kicker)}</p>
        <h1>${escapeHtml(title)}</h1>
      </div>
      <div class="sim-controls" aria-label="Race controls">
        ${createSafetyCarControlMarkup({ compact: true })}
        <button class="sim-control" type="button" data-restart-race>Restart</button>
      </div>
  `;

  return createComponentSurfaceMarkup({
    tagName: 'header',
    className: 'sim-topbar',
    componentName: 'race-controls',
    ariaLabel: 'Race controls',
    body,
    unsupportedLabel: 'Race controls',
    loadingLabel: 'Race controls',
  });
}

export function createSafetyCarControlMarkup({ compact = false } = {}) {
  if (compact) {
    return '<button class="sim-control sim-control--safety" type="button" data-safety-car aria-pressed="false">Safety Car</button>';
  }
  const body = `
      <button class="sim-control sim-control--safety" type="button" data-safety-car aria-pressed="false">Safety Car</button>
  `;

  return createComponentSurfaceMarkup({
    tagName: 'div',
    className: 'standalone-control',
    componentName: 'safety-car-control',
    ariaLabel: 'Safety car control',
    body,
    unsupportedLabel: 'Safety car control',
    loadingLabel: 'Safety car control',
  });
}
