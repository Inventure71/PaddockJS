import { createCameraControlsMarkup } from './cameraControlsTemplate.js';
import { createRaceCanvasMarkup } from './raceCanvasTemplate.js';
import { createSafetyCarControlMarkup } from './raceControlsTemplate.js';
import { createTelemetryPanelMarkup } from './telemetryTemplates.js';
import { createComponentSurfaceMarkup } from './templateUtils.js';

let telemetryDrawerIdSequence = 0;

function createTelemetryDrawerId() {
  telemetryDrawerIdSequence += 1;
  return `paddock-telemetry-drawer-${telemetryDrawerIdSequence}`;
}

export function createRaceTelemetryDrawerMarkup(options, {
  timingTowerVerticalFit,
  drawerInitiallyOpen = false,
  raceDataTelemetryDetail = options.ui?.raceDataTelemetryDetail,
  responsiveNarrowLayout,
} = {}) {
  const openClass = drawerInitiallyOpen ? ' is-telemetry-open' : '';
  const enableResponsiveNarrowLayout = responsiveNarrowLayout ?? options.ui?.responsiveNarrowLayout ?? true;
  const responsiveClass = enableResponsiveNarrowLayout ? ' race-telemetry-drawer--responsive-narrow' : '';
  const drawerId = createTelemetryDrawerId();
  const drawerOptions = {
    ...options,
    ui: {
      ...(options.ui ?? {}),
      cameraControls: false,
      raceDataTelemetryDetail: Boolean(raceDataTelemetryDetail),
      responsiveNarrowLayout: enableResponsiveNarrowLayout,
    },
  };
  const showCameraControls = options.ui?.cameraControls !== false;
  const body = `
      <div class="race-telemetry-drawer__toolbar" aria-label="Race workbench controls">
        ${showCameraControls ? createCameraControlsMarkup({ showSimulationSpeed: true, ui: options.ui }) : ''}
        <div class="race-telemetry-drawer__controls">
          ${createSafetyCarControlMarkup({ compact: true })}
          <button class="telemetry-drawer-toggle" type="button" data-telemetry-drawer-toggle aria-expanded="${drawerInitiallyOpen ? 'true' : 'false'}" aria-controls="${drawerId}" aria-label="${drawerInitiallyOpen ? 'Close telemetry' : 'Open telemetry'}">
            ${drawerInitiallyOpen ? 'Close' : 'Telemetry'}
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
        <aside id="${drawerId}" class="telemetry-drawer" data-telemetry-drawer aria-label="Telemetry drawer" aria-hidden="${drawerInitiallyOpen ? 'false' : 'true'}"${drawerInitiallyOpen ? '' : ' inert'}>
          <div class="telemetry-drawer__content">
            ${createTelemetryPanelMarkup(options, { includeOverview: false })}
          </div>
        </aside>
      </div>
  `;

  return createComponentSurfaceMarkup({
    tagName: 'section',
    className: `race-telemetry-drawer${responsiveClass}${openClass}`,
    componentName: 'race-telemetry-drawer',
    ariaLabel: 'Race view with telemetry drawer',
    attributes: 'data-race-telemetry-drawer',
    body,
    unsupportedLabel: 'Race telemetry drawer',
  });
}
