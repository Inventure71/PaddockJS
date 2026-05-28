import {
  createRaceDataPanelMarkup,
  createStewardMessageMarkup,
  createTelemetrySectorBannerMarkup,
} from './bannerTemplates.js';
import { createCameraControlsMarkup } from './cameraControlsTemplate.js';
import { createTimingTowerMarkup } from './timingTowerTemplate.js';
import { createComponentSurfaceMarkup } from './templateUtils.js';

let timingPanelIdSequence = 0;

function createTimingPanelId() {
  timingPanelIdSequence += 1;
  return `paddock-timing-panel-${timingPanelIdSequence}`;
}

export function createRaceCanvasMarkup({
  includeRaceDataPanel = false,
  includeTimingTower = false,
  includeTelemetrySectorBanner = false,
  timingTowerVerticalFit,
  assets,
  totalLaps,
  physicsMode = 'arcade',
  ui = {},
  debug = {},
  responsiveNarrowLayout,
} = {}) {
  const showFps = ui.showFps !== false;
  const showEmbeddedCameraControls = ui.cameraControls === 'embedded';
  const enableResponsiveNarrowLayout = responsiveNarrowLayout ?? ui.responsiveNarrowLayout ?? true;
  const timingFit = (timingTowerVerticalFit ?? ui.timingTowerVerticalFit) === 'scroll'
    ? 'scroll'
    : 'expand-race-view';
  const classNames = ['sim-canvas-panel'];
  if (includeTimingTower) {
    classNames.push('sim-canvas-panel--with-timing-tower', `sim-canvas-panel--timing-${timingFit}`);
    if (enableResponsiveNarrowLayout) classNames.push('sim-canvas-panel--responsive-narrow');
  }
  const timingPanelId = includeTimingTower ? createTimingPanelId() : '';
  const showPhysicsModeIndicator = debug.physicsModeIndicator === true;
  const physicsModeLabel = physicsMode === 'advanced' ? 'Advanced physics mode' : 'Arcade physics mode';
  const physicsModeClass = physicsMode === 'advanced' ? 'advanced' : 'arcade';

  const body = `
      <div class="track-canvas" data-track-canvas></div>
      ${showPhysicsModeIndicator ? `
      <div class="physics-mode-indicator physics-mode-indicator--${physicsModeClass}" data-physics-mode-indicator aria-label="${physicsModeLabel}" title="${physicsModeLabel}"></div>
      ` : ''}
      ${includeTimingTower ? `
      <button class="timing-panel-toggle" type="button" data-timing-panel-toggle aria-expanded="false" aria-controls="${timingPanelId}">
        Timing
      </button>
      ${createTimingTowerMarkup({ totalLaps, assets, id: timingPanelId, ui })}
      ` : ''}
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
      ${createStewardMessageMarkup()}
      ${showEmbeddedCameraControls ? createCameraControlsMarkup({ embedded: true, ui }) : ''}
      ${includeRaceDataPanel ? createRaceDataPanelMarkup({ assets, ui }) : ''}
      ${includeTelemetrySectorBanner ? createTelemetrySectorBannerMarkup({ ui }) : ''}
      <div class="race-finish-panel" data-race-finish-panel hidden aria-live="polite">
        <span>Race winner</span>
        <strong data-race-finish-winner>--</strong>
        <ol data-race-finish-classification></ol>
      </div>
  `;

  return createComponentSurfaceMarkup({
    tagName: 'section',
    className: classNames.join(' '),
    componentName: 'race-canvas',
    ariaLabel: 'Track view',
    body,
    unsupportedLabel: 'Race view',
    loadingLabel: 'Race view',
  });
}
