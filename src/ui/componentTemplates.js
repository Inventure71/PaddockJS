function buttonHiddenAttribute(isVisible) {
  return isVisible ? '' : ' hidden';
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
        <div class="broadcast-safety-banner" data-tower-safety-banner>
          <span>FIA</span>
          <strong>Safety Car</strong>
        </div>
        <div class="broadcast-column-head" aria-hidden="true">
          <span>Pos</span>
          <span>Car</span>
          <span>Project</span>
          <span>Gap</span>
          <span>Tyre</span>
        </div>
        <ol class="timing-list" data-timing-list></ol>
      </div>
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
      </div>
  `;
}

export function createRaceCanvasMarkup({ includeRaceDataPanel = false, assets, ui = {} } = {}) {
  const showFps = ui.showFps !== false;
  const showEmbeddedCameraControls = ui.cameraControls !== 'external' && ui.cameraControls !== false;

  return `
    <section class="sim-canvas-panel" data-paddock-component="race-canvas" aria-label="Track view">
      <div class="track-canvas" data-track-canvas></div>
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
    </section>
  `;
}

export function createRaceDataPanelMarkup({ ui = {} } = {}) {
  const sizeMode = ui.raceDataBannerSize === 'auto' ? 'auto' : 'custom';
  return `
    <div class="race-data-panel race-data-panel--${sizeMode}" data-paddock-component="race-data-panel" data-race-data-panel aria-live="polite">
      <div class="race-data-copy">
        <span class="race-data-kicker" data-race-data-kicker>Project</span>
        <strong data-race-data-title>Select driver</strong>
        <span class="race-data-subtitle" data-race-data-subtitle>Race entry</span>
      </div>
      <strong class="race-data-number" data-race-data-number>--</strong>
      <button class="race-data-link" type="button" data-race-data-open>Open project</button>
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
      </section>
  `;
}

export function createTelemetryPanelMarkup(options, { includeOverview = options.ui?.telemetryIncludesOverview !== false } = {}) {
  return `
    <aside class="sim-telemetry" data-paddock-component="telemetry-panel" aria-label="Selected car telemetry">
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
        <div><dt>Gap</dt><dd data-telemetry-gap>--</dd></div>
      </dl>
      ${includeOverview ? createCarDriverOverviewMarkup(options) : ''}
    </aside>
  `;
}
