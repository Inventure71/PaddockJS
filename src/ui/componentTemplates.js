function buttonHiddenAttribute(isVisible) {
  return isVisible ? '' : ' hidden';
}

let telemetryDrawerIdSequence = 0;

function createTelemetryDrawerId() {
  telemetryDrawerIdSequence += 1;
  return `paddock-telemetry-drawer-${telemetryDrawerIdSequence}`;
}

function createLoadingMarkup(label = 'Loading') {
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

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function createRaceControlsMarkup({
  title,
  kicker,
  backLinkHref,
  backLinkLabel,
  showBackLink,
}) {
  return `
    <header class="sim-topbar" data-paddock-component="race-controls">
      <a class="sim-backlink" href="${escapeHtml(backLinkHref)}"${buttonHiddenAttribute(showBackLink)}>${escapeHtml(backLinkLabel)}</a>
      <div class="sim-title-block">
        <p class="sim-kicker">${escapeHtml(kicker)}</p>
        <h1>${escapeHtml(title)}</h1>
      </div>
      <div class="sim-controls" aria-label="Race controls">
        ${createSafetyCarControlMarkup({ compact: true })}
        <button class="sim-control" type="button" data-restart-race>Restart</button>
      </div>
      ${createLoadingMarkup('Race controls')}
    </header>
  `;
}

export function createSafetyCarControlMarkup({ compact = false } = {}) {
  const className = compact
    ? 'sim-control sim-control--safety'
    : 'sim-control sim-control--safety standalone-control';
  const componentAttribute = compact ? '' : ' data-paddock-component="safety-car-control"';
  return `<button class="${className}" type="button" data-safety-car aria-pressed="false"${componentAttribute}>Safety Car</button>`;
}

export function createTimingTowerMarkup({ totalLaps, assets }) {
  return `
    <aside class="sim-timing broadcast-tower" data-paddock-component="timing-tower" data-timing-tower aria-label="Timing tower">
      <div class="broadcast-tower-frame">
        <div class="broadcast-brand">
          <img class="broadcast-f1-logo" src="${escapeHtml(assets.f1Logo)}" alt="F1" />
        </div>
        <div class="broadcast-lap">
          <span>Lap</span>
          <strong data-tower-lap-readout>1</strong>
          <span>/</span>
          <span data-tower-total-laps>${escapeHtml(totalLaps)}</span>
        </div>
        <div class="broadcast-gap-mode" role="group" aria-label="Timing gap mode">
          <button type="button" data-timing-gap-mode="interval" aria-pressed="true">Int</button>
          <button type="button" data-timing-gap-mode="leader" aria-pressed="false">Gap</button>
        </div>
        <div class="broadcast-safety-banner" data-tower-safety-banner>
          <span>FIA</span>
          <strong>Safety Car</strong>
        </div>
        <div class="broadcast-column-head" aria-hidden="true">
          <span>Pos</span>
          <span>Team</span>
          <span>Project</span>
          <span data-timing-gap-label>Int</span>
          <span>Tyre</span>
        </div>
        <ol class="timing-list" data-timing-list></ol>
      </div>
      ${createLoadingMarkup('Timing tower')}
    </aside>
  `;
}

export function createCameraControlsMarkup({ embedded = false } = {}) {
  const className = embedded ? 'camera-controls' : 'camera-controls camera-controls--external';
  return `
      <div class="${className}" data-paddock-component="camera-controls" aria-label="Camera controls">
        <button type="button" data-camera-mode="overview" aria-pressed="false">Overview</button>
        <button type="button" data-camera-mode="leader" aria-pressed="true">Leader</button>
        <button type="button" data-camera-mode="selected" aria-pressed="false">Selected</button>
        <button type="button" data-camera-mode="show-all" aria-pressed="false">Show all</button>
        <button type="button" data-zoom-out aria-label="Zoom out">-</button>
        <button type="button" data-zoom-in aria-label="Zoom in">+</button>
        ${createLoadingMarkup('Camera controls')}
      </div>
  `;
}

export function createRaceCanvasMarkup({
  includeRaceDataPanel = false,
  includeTimingTower = false,
  includeTelemetrySectorBanner = false,
  timingTowerVerticalFit,
  assets,
  totalLaps,
  ui = {},
} = {}) {
  const showFps = ui.showFps !== false;
  const showEmbeddedCameraControls = ui.cameraControls !== 'external' && ui.cameraControls !== false;
  const timingFit = (timingTowerVerticalFit ?? ui.timingTowerVerticalFit) === 'scroll'
    ? 'scroll'
    : 'expand-race-view';
  const classNames = ['sim-canvas-panel'];
  if (includeTimingTower) {
    classNames.push('sim-canvas-panel--with-timing-tower', `sim-canvas-panel--timing-${timingFit}`);
  }

  return `
    <section class="${classNames.join(' ')}" data-paddock-component="race-canvas" aria-label="Track view">
      <div class="track-canvas" data-track-canvas></div>
      ${includeTimingTower ? createTimingTowerMarkup({ totalLaps, assets }) : ''}
      ${showFps ? `
      <div class="fps-counter" aria-label="Frames per second">
        <span>FPS</span>
        <strong data-fps-readout>--</strong>
      </div>
      ` : ''}
      <div class="start-lights" data-start-lights aria-live="polite">
        <div class="start-lights__label" data-start-lights-label>Race start</div>
        <div class="start-lights__gantry" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
      ${showEmbeddedCameraControls ? createCameraControlsMarkup({ embedded: true }) : ''}
      ${includeRaceDataPanel ? createRaceDataPanelMarkup({ assets, ui }) : ''}
      ${includeTelemetrySectorBanner ? createTelemetrySectorBannerMarkup({ ui }) : ''}
      <div class="race-finish-panel" data-race-finish-panel hidden aria-live="polite">
        <span>Race winner</span>
        <strong data-race-finish-winner>--</strong>
        <ol data-race-finish-classification></ol>
      </div>
      ${createLoadingMarkup('Race view')}
    </section>
  `;
}

export function createRaceDataPanelMarkup({ ui = {} } = {}) {
  const sizeMode = ui.raceDataBannerSize === 'auto' ? 'auto' : 'custom';
  const telemetryDetail = Boolean(ui.raceDataTelemetryDetail);
  const classNames = ['race-data-panel', `race-data-panel--${sizeMode}`];
  if (telemetryDetail) classNames.push('race-data-panel--with-telemetry');
  return `
    <div class="${classNames.join(' ')}" data-paddock-component="race-data-panel" data-race-data-panel aria-live="polite">
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

export function createCarDriverOverviewMarkup({ assets }) {
  const cells = Array.from({ length: 7 }, (_, index) => `
          <div class="car-overview-cell car-overview-cell--slot-${index + 1}" data-overview-field data-overview-slot="${index}">
            <span data-overview-field-label>--</span>
            <strong data-overview-field-value>--</strong>
          </div>
  `).join('');

  return `
      <section class="car-overview" data-paddock-component="car-driver-overview" aria-label="Selected car and driver overview">
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
        ${createLoadingMarkup('Car and driver overview')}
      </section>
  `;
}

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

export function createRaceTelemetryDrawerMarkup(options, {
  timingTowerVerticalFit,
  drawerInitiallyOpen = false,
  raceDataTelemetryDetail = options.ui?.raceDataTelemetryDetail,
} = {}) {
  const openClass = drawerInitiallyOpen ? ' is-telemetry-open' : '';
  const drawerId = createTelemetryDrawerId();
  const drawerOptions = {
    ...options,
    ui: {
      ...(options.ui ?? {}),
      raceDataTelemetryDetail: Boolean(raceDataTelemetryDetail),
    },
  };
  return `
    <section class="race-telemetry-drawer${openClass}" data-paddock-component="race-telemetry-drawer" data-race-telemetry-drawer aria-label="Race view with telemetry drawer">
      <div class="race-telemetry-drawer__race">
        ${createRaceCanvasMarkup({
          ...drawerOptions,
          includeRaceDataPanel: true,
          includeTimingTower: true,
          timingTowerVerticalFit,
        })}
      </div>
      <div class="race-telemetry-drawer__controls" aria-label="Race workbench controls">
        ${createSafetyCarControlMarkup({ compact: true })}
        <button class="telemetry-drawer-toggle" type="button" data-telemetry-drawer-toggle aria-expanded="${drawerInitiallyOpen ? 'true' : 'false'}" aria-controls="${drawerId}">
          ${drawerInitiallyOpen ? 'Close telemetry' : 'Telemetry'}
        </button>
      </div>
      <aside id="${drawerId}" class="telemetry-drawer" data-telemetry-drawer aria-label="Telemetry drawer" aria-hidden="${drawerInitiallyOpen ? 'false' : 'true'}"${drawerInitiallyOpen ? '' : ' inert'}>
        <div class="telemetry-drawer__header" aria-hidden="true"></div>
        <div class="telemetry-drawer__content">
          ${createTelemetryComponentMarkup(options)}
        </div>
      </aside>
    </section>
  `;
}
