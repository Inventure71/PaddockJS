import { createComponentSurfaceMarkup, escapeHtml } from './templateUtils.js';

export function createCarDriverOverviewMarkup({ assets }) {
  const cells = Array.from({ length: 7 }, (_, index) => `
          <div class="car-overview-cell car-overview-cell--slot-${index + 1}" data-overview-field data-overview-slot="${index}">
            <span data-overview-field-label>--</span>
            <strong data-overview-field-value>--</strong>
          </div>
  `).join('');

  const body = `
        <div class="car-overview-header">
          <span data-car-overview-title>Car overview</span>
          <strong data-car-overview-code>---</strong>
        </div>
        <div class="car-overview-toggle" role="group" aria-label="Overview mode">
          <button type="button" data-overview-mode="vehicle" aria-pressed="true">Car</button>
          <button type="button" data-overview-mode="driver" aria-pressed="false">Driver</button>
        </div>
        <div class="car-overview-diagram" style="--driver-color: #e10600">
          ${cells}
          <div class="car-overview-car" aria-hidden="true">
            <img class="car-overview-car-image" data-car-overview-image src="${escapeHtml(assets.carOverview)}" alt="" />
            <span class="car-overview-icon" data-car-overview-icon>--</span>
            <span class="car-overview-number" data-car-overview-number>00</span>
            <span class="car-overview-core-stat" data-car-overview-core-stat>Car</span>
          </div>
        </div>
  `;

  return createComponentSurfaceMarkup({
    tagName: 'section',
    className: 'car-overview',
    componentName: 'car-driver-overview',
    ariaLabel: 'Selected car and driver overview',
    body,
    unsupportedLabel: 'Car and driver overview',
    loadingLabel: 'Car and driver overview',
  });
}
