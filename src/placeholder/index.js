function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeVariant(value) {
  return value === 'custom' ? 'custom' : 'lights';
}

function renderAttributes(attributes = {}) {
  if (!attributes || typeof attributes !== 'object') return '';
  return Object.entries(attributes)
    .filter(([name, value]) => (
      value != null &&
      value !== false &&
      /^[a-zA-Z_][\w:.-]*$/.test(name) &&
      !/^on/i.test(name)
    ))
    .map(([name, value]) => (value === true
      ? ` ${escapeHtml(name)}`
      : ` ${escapeHtml(name)}="${escapeHtml(value)}"`))
    .join('');
}

export function createPaddockLoadingPlaceholder({
  label = 'Loading simulator',
  detail = '',
  className = '',
  variant = 'lights',
  attributes,
} = {}) {
  const normalizedVariant = normalizeVariant(variant);
  const extraClassName = className ? ` ${escapeHtml(className)}` : '';
  const detailMarkup = detail
    ? `<span class="paddock-placeholder__detail">${escapeHtml(detail)}</span>`
    : '';
  const lightsMarkup = normalizedVariant === 'lights'
    ? `
      <div class="paddock-placeholder__lights" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
        <span></span>
        <span></span>
      </div>`
    : '';

  return `
    <div class="paddock-placeholder${extraClassName}" data-paddock-placeholder data-paddock-placeholder-variant="${normalizedVariant}" role="status" aria-live="polite" aria-busy="true"${renderAttributes(attributes)}>
      <div class="paddock-placeholder__content">
        ${lightsMarkup}
        <span class="paddock-placeholder__label">${escapeHtml(label)}</span>
        ${detailMarkup}
      </div>
    </div>
  `;
}
