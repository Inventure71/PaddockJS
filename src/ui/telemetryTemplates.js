import { createCarDriverOverviewMarkup } from './carOverviewTemplate.js';
import { createLoadingMarkup } from './templateUtils.js';

function getTelemetryModules(ui = {}) {
  const defaults = {
    core: true,
    sectors: true,
    lapTimes: true,
    sectorTimes: true,
  };
  const modules = ui.telemetryModules;
  if (modules === false) return Object.fromEntries(Object.keys(defaults).map((name) => [name, false]));
  if (Array.isArray(modules)) {
    const requested = new Set(modules);
    return Object.fromEntries(Object.keys(defaults).map((name) => [name, requested.has(name)]));
  }
  if (!modules || typeof modules !== 'object') return defaults;
  return Object.fromEntries(Object.entries(defaults).map(([name, fallback]) => [
    name,
    modules[name] == null ? fallback : Boolean(modules[name]),
  ]));
}

function getTelemetryModuleClass(componentName) {
  return `sim-telemetry telemetry-component telemetry-component--${componentName}`;
}

export function createTelemetryCoreMarkup() {
  return `
    <section class="${getTelemetryModuleClass('core')}" data-paddock-component="telemetry-core" aria-label="Selected car core telemetry">
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
        <div><dt>Interval</dt><dd data-telemetry-gap>--</dd></div>
        <div><dt>Leader</dt><dd data-telemetry-leader-gap>--</dd></div>
      </dl>
      ${createLoadingMarkup('Core telemetry')}
    </section>
  `;
}

export function createTelemetrySectorsMarkup() {
  return `
      <section class="${getTelemetryModuleClass('sectors')} telemetry-sector-strip" data-paddock-component="telemetry-sectors" data-telemetry-sector-strip aria-label="Sector progress">
        <div class="telemetry-module-header">
          <span>Sector map</span>
          <strong data-telemetry-current-sector>S1</strong>
        </div>
        <div class="telemetry-sector-bars">
          ${[1, 2, 3].map((sector) => `
          <div class="telemetry-sector-bar" data-telemetry-sector-bar="${sector}" style="--sector-fill: 0%">
            <span>S${sector}</span>
            <strong data-telemetry-sector-time="${sector}">--</strong>
          </div>
          `).join('')}
        </div>
        ${createLoadingMarkup('Sector telemetry')}
      </section>
  `;
}

export function createTelemetryLapTimesMarkup() {
  return `
      <section class="${getTelemetryModuleClass('lap-times')} telemetry-lap-module" data-paddock-component="telemetry-lap-times" aria-label="Lap timing">
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
        ${createLoadingMarkup('Lap telemetry')}
      </section>
  `;
}

export function createTelemetrySectorTimesMarkup() {
  return `
      <section class="${getTelemetryModuleClass('sector-times')} telemetry-sector-table-module" data-paddock-component="telemetry-sector-times" aria-label="Sector timing table">
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
        ${createLoadingMarkup('Sector table')}
      </section>
  `;
}

function createTelemetryComponentMarkup(options, modules = getTelemetryModules(options.ui)) {
  return `
      ${modules.core ? createTelemetryCoreMarkup(options) : ''}
      ${modules.sectors ? createTelemetrySectorsMarkup(options) : ''}
      ${modules.lapTimes ? createTelemetryLapTimesMarkup(options) : ''}
      ${modules.sectorTimes ? createTelemetrySectorTimesMarkup(options) : ''}
  `;
}

export function createTelemetryPanelMarkup(options, { includeOverview = options.ui?.telemetryIncludesOverview !== false } = {}) {
  const modules = getTelemetryModules(options.ui);
  return `
    <aside class="telemetry-stack" data-paddock-component="telemetry-stack" aria-label="Selected car telemetry stack">
      ${createTelemetryComponentMarkup(options, modules)}
      ${includeOverview ? createCarDriverOverviewMarkup(options) : ''}
    </aside>
  `;
}
