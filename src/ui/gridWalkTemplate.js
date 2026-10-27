import { createRaceDataPanelMarkup } from './bannerTemplates.js';
import { escapeHtml as html } from './htmlEscaping.js';

export function createGridWalkMarkup(drivers, cars, ui = {}) {
  const byId = new Map(drivers.map((driver) => [driver.id, driver]));
  return `<div class="grid-walk" data-grid-walk>
    <div class="grid-walk__toolbar" data-grid-header>
    <div class="camera-controls grid-walk__navigation" data-grid-navigation>
      <button type="button" data-grid-previous aria-label="Previous grid entry">←</button>
      <label><span class="grid-walk__sr-only">Explore the grid</span><select class="sim-control" data-grid-jump aria-label="Jump to grid entry">
        ${cars.map((car, index) => `<option value="${html(car.id)}">${index + 1}. ${html(byId.get(car.id).presentation.name)}</option>`).join('')}
      </select></label>
      <button type="button" data-grid-next aria-label="Next grid entry">→</button>
    </div>
    </div>
    <div class="grid-walk__labels" data-grid-labels role="group" aria-label="Starting grid">
      <svg class="grid-walk__connectors" aria-hidden="true">${cars.map((car) => `<line data-grid-connector="${html(car.id)}" />`).join('')}</svg>
      ${cars.map((car, index) => {
        const entry = byId.get(car.id).presentation;
        return `<button type="button" class="grid-walk__entry" data-grid-entry="${html(car.id)}" title="${html(entry.name)}" style="--driver-color: ${html(byId.get(car.id).color)}" aria-pressed="false">
          <span class="grid-walk__position">${String(index + 1).padStart(2, '0')}</span>
          <strong>${html(entry.name)}</strong>
        </button>`;
      }).join('')}
    </div>
    ${createRaceDataPanelMarkup({ ui: { ...ui, raceDataTelemetryDetail: false }, navigationLink: true })}
    <span class="grid-walk__status" data-grid-status role="status"></span>
  </div>`;
}
