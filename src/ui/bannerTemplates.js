import { createLoadingMarkup } from './templateUtils.js';

export function createStewardMessageMarkup() {
  return `
      <div class="steward-message is-hidden" data-paddock-component="steward-message" data-steward-message aria-live="polite">
        <span class="steward-message__kicker" data-steward-message-kicker>Race control</span>
        <strong data-steward-message-title>--</strong>
        <span data-steward-message-detail>--</span>
      </div>
  `;
}

export function createRaceDataPanelMarkup({ ui = {} } = {}) {
  const sizeMode = ui.raceDataBannerSize === 'auto' ? 'auto' : 'custom';
  const telemetryDetail = Boolean(ui.raceDataTelemetryDetail);
  const classNames = ['race-data-panel', `race-data-panel--${sizeMode}`];
  if (telemetryDetail) classNames.push('race-data-panel--with-telemetry');
  return `
    <div class="${classNames.join(' ')}" data-paddock-component="race-data-panel" data-race-data-panel aria-live="polite">
      <button class="race-data-dismiss" type="button" data-race-data-dismiss aria-label="Close race data pill">x</button>
      <div class="race-data-copy">
        <span class="race-data-kicker" data-race-data-kicker>Project</span>
        <strong data-race-data-title>Select driver</strong>
        <span class="race-data-subtitle" data-race-data-subtitle>Race entry</span>
      </div>
      ${telemetryDetail ? createRaceDataTelemetryMarkup() : ''}
      <strong class="race-data-number" data-race-data-number>--</strong>
      <button class="race-data-link" type="button" data-race-data-open>Open project</button>
      ${createLoadingMarkup('Race data')}
    </div>
  `;
}

function createRaceDataTelemetryMarkup() {
  return `
      <div class="race-data-telemetry" data-race-data-telemetry aria-label="Project sector telemetry">
        <span class="race-data-telemetry__label">Sectors</span>
        <div class="race-data-telemetry__bars">
          ${[1, 2, 3].map((sector) => `
          <div class="telemetry-sector-bar race-data-sector-bar" data-telemetry-sector-bar="${sector}" style="--sector-fill: 0%">
            <span>S${sector}</span>
            <strong data-telemetry-sector-time="${sector}">--</strong>
          </div>
          `).join('')}
        </div>
      </div>
  `;
}

export function createTelemetrySectorBannerMarkup() {
  return `
      <section class="telemetry-sector-banner" data-paddock-component="telemetry-sector-banner" data-telemetry-sector-banner aria-label="Broadcast sector telemetry">
        <div class="telemetry-sector-banner__copy">
          <span><b data-selected-code>--</b> sector telemetry</span>
          <strong data-selected-name>Select driver</strong>
          <em data-telemetry-current-sector>S1</em>
        </div>
        <div class="telemetry-sector-banner__bars">
          ${[1, 2, 3].map((sector) => `
          <div class="telemetry-sector-bar" data-telemetry-sector-bar="${sector}" style="--sector-fill: 0%">
            <span>S${sector}</span>
            <strong data-telemetry-sector-time="${sector}">--</strong>
          </div>
          `).join('')}
        </div>
        ${createLoadingMarkup('Sector banner')}
      </section>
  `;
}
