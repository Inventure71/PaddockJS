import { escapeHtml } from './htmlEscaping.js';
export { escapeHtml } from './htmlEscaping.js';

export function createLoadingMarkup(label = 'Loading') {
  return `
      <div class="paddock-loading" data-paddock-loading aria-label="${escapeHtml(label)} loading">
        <div class="paddock-loading__lights" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
          <span></span>
          <span></span>
        </div>
        <span class="paddock-loading__label">${escapeHtml(label)}</span>
      </div>
  `;
}

export function createUnsupportedSizeMarkup(label = 'PaddockJS component') {
  return `
      <div class="paddock-unsupported-size" data-paddock-unsupported-size role="status" aria-live="polite">
        <strong>Unsupported size</strong>
        <span>${escapeHtml(label)} needs more inline space or height to remain usable.</span>
      </div>
    `;
}

const COMPONENT_SURFACE_TAGS = new Set(['section', 'aside', 'div', 'header']);

export function createComponentSurfaceMarkup({
  tagName = 'section',
  className,
  componentName,
  ariaLabel,
  attributes = '',
  body = '',
  unsupportedLabel,
  loadingLabel,
} = {}) {
  const tag = COMPONENT_SURFACE_TAGS.has(tagName) ? tagName : 'section';
  const extraAttributes = attributes ? ` ${attributes}` : '';
  return `
      <${tag} class="${escapeHtml(className)}" data-paddock-component="${escapeHtml(componentName)}"${extraAttributes} aria-label="${escapeHtml(ariaLabel)}">
        ${body}
        ${unsupportedLabel ? createUnsupportedSizeMarkup(unsupportedLabel) : ''}
        ${loadingLabel ? createLoadingMarkup(loadingLabel) : ''}
      </${tag}>
  `;
}

export function createTelemetrySectorBarsMarkup({
  wrapperClassName = 'telemetry-sector-bars',
  barClassName = 'telemetry-sector-bar',
} = {}) {
  return `
        <div class="${escapeHtml(wrapperClassName)}">
          ${[1, 2, 3].map((sector) => `
          <div class="${escapeHtml(barClassName)}" data-telemetry-sector-bar="${sector}" style="--sector-fill: 0%">
            <span>S${sector}</span>
            <strong data-telemetry-sector-time="${sector}">--</strong>
          </div>
          `).join('')}
        </div>
  `;
}
