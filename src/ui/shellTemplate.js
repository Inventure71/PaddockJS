import {
  createCameraControlsMarkup,
  createRaceCanvasMarkup,
  createRaceControlsMarkup,
  createTelemetryPanelMarkup,
  createTimingTowerMarkup,
} from './componentTemplates.js';

export function createF1SimulatorShell({
  title,
  kicker,
  backLinkHref,
  backLinkLabel,
  showBackLink,
  totalLaps,
  assets,
  ui = {},
}) {
  const layoutPreset = ui.layoutPreset === 'left-tower-overlay' ? 'left-tower-overlay' : 'standard';
  const timingFit = ui.timingTowerVerticalFit === 'scroll' ? 'scroll' : 'expand-race-view';
  const shellClasses = ['f1-sim-component', 'sim-shell'];
  if (layoutPreset === 'left-tower-overlay') shellClasses.push('sim-shell--left-tower-overlay');
  shellClasses.push(`sim-shell--timing-${timingFit}`);
  const cameraControls = ui.cameraControls === 'external'
    ? `<div class="sim-external-camera-controls">${createCameraControlsMarkup()}</div>`
    : '';

  return `
    <main class="${shellClasses.join(' ')}" data-f1-simulator-shell data-layout-preset="${layoutPreset}">
      <section class="sim-workspace" aria-label="F1 race simulator">
        ${createRaceControlsMarkup({ title, kicker, backLinkHref, backLinkLabel, showBackLink })}
        ${cameraControls}
        <div class="sim-grid">
          ${createTimingTowerMarkup({ totalLaps, assets })}
          ${createRaceCanvasMarkup({ includeRaceDataPanel: ui.showRaceDataPanel !== false, assets, ui })}
          ${createTelemetryPanelMarkup({ assets, ui })}
        </div>
      </section>
    </main>
  `;
}
