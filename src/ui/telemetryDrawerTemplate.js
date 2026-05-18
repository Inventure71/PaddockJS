import { createCameraControlsMarkup } from './cameraControlsTemplate.js';
import { createRaceCanvasMarkup } from './raceCanvasTemplate.js';
import { createSafetyCarControlMarkup } from './raceControlsTemplate.js';
import { createTelemetryPanelMarkup } from './telemetryTemplates.js';

let telemetryDrawerIdSequence = 0;

function createTelemetryDrawerId() {
  telemetryDrawerIdSequence += 1;
  return `paddock-telemetry-drawer-${telemetryDrawerIdSequence}`;
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
      cameraControls: false,
      raceDataTelemetryDetail: Boolean(raceDataTelemetryDetail),
    },
  };
  const showCameraControls = options.ui?.cameraControls !== false;
  return `
    <section class="race-telemetry-drawer${openClass}" data-paddock-component="race-telemetry-drawer" data-race-telemetry-drawer aria-label="Race view with telemetry drawer">
      <div class="race-telemetry-drawer__toolbar" aria-label="Race workbench controls">
        ${showCameraControls ? createCameraControlsMarkup({ showSimulationSpeed: true, ui: options.ui }) : ''}
        <div class="race-telemetry-drawer__controls">
          ${createSafetyCarControlMarkup({ compact: true })}
          <button class="telemetry-drawer-toggle" type="button" data-telemetry-drawer-toggle aria-expanded="${drawerInitiallyOpen ? 'true' : 'false'}" aria-controls="${drawerId}">
            ${drawerInitiallyOpen ? 'Close telemetry' : 'Telemetry'}
          </button>
        </div>
      </div>
      <div class="race-telemetry-drawer__race">
        ${createRaceCanvasMarkup({
          ...drawerOptions,
          includeRaceDataPanel: true,
          includeTimingTower: true,
          timingTowerVerticalFit,
        })}
      </div>
      <aside id="${drawerId}" class="telemetry-drawer" data-telemetry-drawer aria-label="Telemetry drawer" aria-hidden="${drawerInitiallyOpen ? 'false' : 'true'}"${drawerInitiallyOpen ? '' : ' inert'}>
        <div class="telemetry-drawer__content">
          ${createTelemetryPanelMarkup(options, { includeOverview: false })}
        </div>
      </aside>
    </section>
  `;
}
