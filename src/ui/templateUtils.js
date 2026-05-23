export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

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
