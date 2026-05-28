import {
  createComponentSurfaceMarkup,
  createTelemetrySectorBarsMarkup,
} from './templateUtils.js';

export function createStewardMessageMarkup() {
  return `
      <div class="steward-message is-hidden" data-paddock-component="steward-message" data-steward-message aria-live="polite">
        <span class="steward-message__kicker" data-steward-message-kicker>Race control</span>
        <strong data-steward-message-title>--</strong>
        <span data-steward-message-detail>--</span>
      </div>
  `;
}

export function createRaceDataPanelMarkup({ ui = {}, standalone = false } = {}) {
  const sizeMode = ui.raceDataBannerSize === 'auto' ? 'auto' : 'custom';
  const telemetryDetail = Boolean(ui.raceDataTelemetryDetail);
  const classNames = ['race-data-panel', `race-data-panel--${sizeMode}`];
  if (standalone) classNames.push('race-data-panel--standalone');
  if (telemetryDetail) classNames.push('race-data-panel--with-telemetry');
  const body = `
      <button class="race-data-dismiss" type="button" data-race-data-dismiss aria-label="Close race data pill">x</button>
      <div class="race-data-copy">
        <span class="race-data-kicker" data-race-data-kicker>Project</span>
        <strong data-race-data-title>Select driver</strong>
        <span class="race-data-subtitle" data-race-data-subtitle>Race entry</span>
      </div>
      ${telemetryDetail ? createRaceDataTelemetryMarkup() : ''}
      <strong class="race-data-number" data-race-data-number>--</strong>
      <button class="race-data-link" type="button" data-race-data-open>Open project</button>
  `;

  return createComponentSurfaceMarkup({
    tagName: 'div',
    className: classNames.join(' '),
    componentName: 'race-data-panel',
    ariaLabel: 'Race data panel',
    attributes: 'data-race-data-panel aria-live="polite"',
    body,
    unsupportedLabel: 'Race data panel',
    loadingLabel: 'Race data',
  });
}

function createRaceDataTelemetryMarkup() {
  return `
      <div class="race-data-telemetry" data-race-data-telemetry aria-label="Project telemetry">
        ${createTelemetrySectorBarsMarkup({
          wrapperClassName: 'race-data-telemetry__bars',
          barClassName: 'telemetry-sector-bar race-data-sector-bar',
        })}
      </div>
  `;
}

export function createTelemetrySectorBannerMarkup() {
  const body = `
        <div class="telemetry-sector-banner__copy">
          <span><b data-selected-code>--</b> sector telemetry</span>
          <strong data-selected-name>Select driver</strong>
          <em data-telemetry-current-sector>S1</em>
        </div>
        ${createTelemetrySectorBarsMarkup({
          wrapperClassName: 'telemetry-sector-banner__bars',
        })}
  `;

  return createComponentSurfaceMarkup({
    tagName: 'section',
    className: 'telemetry-sector-banner',
    componentName: 'telemetry-sector-banner',
    ariaLabel: 'Broadcast sector telemetry',
    attributes: 'data-telemetry-sector-banner',
    body,
    unsupportedLabel: 'Sector banner',
    loadingLabel: 'Sector banner',
  });
}
