import { normalizeTelemetryModules } from '../config/telemetryModules.js';
import { createCarDriverOverviewMarkup } from './carOverviewTemplate.js';
import {
  createComponentSurfaceMarkup,
  createTelemetrySectorBarsMarkup,
} from './templateUtils.js';

function getTelemetryModuleClass(componentName) {
  return `sim-telemetry telemetry-component telemetry-component--${componentName}`;
}

export function createTelemetryCoreMarkup() {
  return createComponentSurfaceMarkup({
    tagName: 'section',
    className: getTelemetryModuleClass('core'),
    componentName: 'telemetry-core',
    ariaLabel: 'Selected car core telemetry',
    unsupportedLabel: 'Core telemetry',
    loadingLabel: 'Core telemetry',
    body: `
      <div class="telemetry-header">
        <span data-selected-code>---</span>
        <strong data-selected-name>Select car</strong>
      </div>
      <dl class="telemetry-grid">
        <div><dt>Speed</dt><dd data-telemetry-speed>0 km/h</dd></div>
        <div><dt>Throttle</dt><dd data-telemetry-throttle>0%</dd></div>
        <div><dt>Brake</dt><dd data-telemetry-brake>0%</dd></div>
        <div><dt>Tyres</dt><dd data-telemetry-tyres>0%</dd></div>
        <div><dt>DRS</dt><dd data-telemetry-drs>OFF</dd></div>
        <div><dt>Surface</dt><dd data-telemetry-surface>TRACK</dd></div>
        <div><dt>Grip</dt><dd data-telemetry-grip>0%</dd></div>
        <div><dt>Lat G</dt><dd data-telemetry-lateral-g>0.0g</dd></div>
        <div><dt>Slip</dt><dd data-telemetry-slip-angle>0.0 deg</dd></div>
        <div><dt>Stability</dt><dd data-telemetry-stability>STABLE</dd></div>
        <div><dt>Interval</dt><dd data-telemetry-gap>--</dd></div>
        <div><dt>Leader</dt><dd data-telemetry-leader-gap>--</dd></div>
      </dl>
    `,
  });
}

export function createTelemetrySectorsMarkup() {
  return createComponentSurfaceMarkup({
    tagName: 'section',
    className: `${getTelemetryModuleClass('sectors')} telemetry-sector-strip`,
    componentName: 'telemetry-sectors',
    ariaLabel: 'Sector progress',
    attributes: 'data-telemetry-sector-strip',
    unsupportedLabel: 'Sector telemetry',
    loadingLabel: 'Sector telemetry',
    body: `
        <div class="telemetry-module-header">
          <span>Sector map</span>
          <strong data-telemetry-current-sector>S1</strong>
        </div>
        ${createTelemetrySectorBarsMarkup({
          wrapperClassName: 'telemetry-sector-bars',
        })}
    `,
  });
}

export function createTelemetryLapTimesMarkup() {
  return createComponentSurfaceMarkup({
    tagName: 'section',
    className: `${getTelemetryModuleClass('lap-times')} telemetry-lap-module`,
    componentName: 'telemetry-lap-times',
    ariaLabel: 'Lap timing',
    unsupportedLabel: 'Lap telemetry',
    loadingLabel: 'Lap telemetry',
    body: `
        <div class="telemetry-module-header">
          <span>Lap timing</span>
          <strong data-telemetry-completed-laps>0 laps</strong>
        </div>
        <table class="telemetry-lap-table" data-telemetry-lap-table>
          <tbody>
            <tr><th scope="row">Current</th><td data-telemetry-current-lap-time>--</td></tr>
            <tr><th scope="row">Last</th><td data-telemetry-last-lap-time>--</td></tr>
            <tr><th scope="row">Best</th><td data-telemetry-best-lap-time>--</td></tr>
          </tbody>
        </table>
    `,
  });
}

export function createTelemetrySectorTimesMarkup() {
  return createComponentSurfaceMarkup({
    tagName: 'section',
    className: `${getTelemetryModuleClass('sector-times')} telemetry-sector-table-module`,
    componentName: 'telemetry-sector-times',
    ariaLabel: 'Sector timing table',
    unsupportedLabel: 'Sector table',
    loadingLabel: 'Sector table',
    body: `
        <div class="telemetry-module-header">
          <span>Sector timing</span>
          <strong>Last / Best</strong>
        </div>
        <table class="telemetry-sector-table" data-telemetry-sector-table>
          <thead>
            <tr><th scope="col">Sector</th><th scope="col">Last</th><th scope="col">Best</th></tr>
          </thead>
          <tbody>
            ${[1, 2, 3].map((sector) => `
            <tr data-telemetry-sector-row="${sector}">
              <th scope="row">S${sector}</th>
              <td data-telemetry-sector-last="${sector}">--</td>
              <td data-telemetry-sector-best="${sector}">--</td>
            </tr>
            `).join('')}
          </tbody>
        </table>
    `,
  });
}

function createTelemetryComponentMarkup(options, modules = normalizeTelemetryModules(options.ui?.telemetryModules)) {
  return `
      ${modules.core ? createTelemetryCoreMarkup(options) : ''}
      ${modules.sectors ? createTelemetrySectorsMarkup(options) : ''}
      ${modules.lapTimes ? createTelemetryLapTimesMarkup(options) : ''}
      ${modules.sectorTimes ? createTelemetrySectorTimesMarkup(options) : ''}
  `;
}

export function createTelemetryPanelMarkup(options, { includeOverview = options.ui?.telemetryIncludesOverview !== false } = {}) {
  const modules = normalizeTelemetryModules(options.ui?.telemetryModules);
  const body = `
      ${createTelemetryComponentMarkup(options, modules)}
      ${includeOverview ? createCarDriverOverviewMarkup(options) : ''}
  `;

  return createComponentSurfaceMarkup({
    tagName: 'aside',
    className: 'telemetry-stack',
    componentName: 'telemetry-stack',
    ariaLabel: 'Selected car telemetry stack',
    body,
    unsupportedLabel: 'Telemetry stack',
    loadingLabel: 'Telemetry stack',
  });
}
