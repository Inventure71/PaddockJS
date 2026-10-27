import { escapeHtml as html } from './htmlEscaping.js';

export function createGridWalkMarkup(drivers, cars) {
  const byId = new Map(drivers.map((driver) => [driver.id, driver]));
  return `<div class="grid-walk" data-grid-walk>
    <div class="grid-walk__toolbar">
      <div class="grid-walk__modes" role="group" aria-label="Simulator view">
        <button type="button" data-grid-view="grid-walk" aria-pressed="false">Grid Walk</button>
        <button type="button" data-grid-view="race" aria-pressed="false">Race</button>
      </div>
      <button type="button" data-grid-motion aria-pressed="false">Pause motion</button>
    </div>
    <div class="grid-walk__labels" data-grid-labels role="group" aria-label="Starting grid">
      ${cars.map((car, index) => {
        const entry = byId.get(car.id).presentation;
        return `<button type="button" class="grid-walk__entry" data-grid-entry="${html(car.id)}" data-grid-side="${index % 2}" aria-pressed="false">
          <span class="grid-walk__position">${String(index + 1).padStart(2, '0')}</span>
          <strong>${html(entry.name)}</strong><span class="grid-walk__summary">${html(entry.summary)}</span>
        </button>`;
      }).join('')}
    </div>
    <div class="grid-walk__navigation" data-grid-navigation>
      <button type="button" data-grid-previous aria-label="Previous grid entry">←</button>
      <label>Explore the grid<select data-grid-jump aria-label="Jump to grid entry">
        ${cars.map((car, index) => `<option value="${html(car.id)}">${index + 1}. ${html(byId.get(car.id).presentation.name)}</option>`).join('')}
      </select></label>
      <button type="button" data-grid-next aria-label="Next grid entry">→</button>
    </div>
    <section class="grid-walk__inspector" data-grid-inspector hidden aria-label="Entry inspection">
      <button type="button" class="grid-walk__close" data-grid-close aria-label="Close entry inspection">×</button>
      <div data-grid-detail></div>
    </section>
    <span class="grid-walk__status" data-grid-status role="status"></span>
  </div>`;
}

export function createGridWalkInspectionMarkup(entry) {
  return `<p class="grid-walk__eyebrow">On the grid</p>
    <h2 tabindex="-1" data-grid-heading>${html(entry.name)}</h2>
    <p>${html(entry.summary)}</p>
    ${entry.image ? `<img src="${html(entry.image.src)}" alt="${html(entry.image.alt)}" loading="lazy" decoding="async">` : ''}
    ${entry.technologies.length ? `<h3>Technologies</h3><p>${entry.technologies.map(html).join(' · ')}</p>` : ''}
    ${entry.details.length ? `<h3>Details</h3><ul>${entry.details.map((detail) => `<li>${html(detail)}</li>`).join('')}</ul>` : ''}
    ${entry.href ? `<a href="${html(entry.href)}">${html(entry.linkLabel)} <span aria-hidden="true">↗</span></a>` : ''}`;
}
