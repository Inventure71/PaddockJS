import {
  createRaceDataPanelMarkup,
  createStewardMessageMarkup,
  createTelemetrySectorBannerMarkup,
} from './bannerTemplates.js';
import { createCameraControlsMarkup } from './cameraControlsTemplate.js';
import { createTimingTowerMarkup } from './timingTowerTemplate.js';
import { createLoadingMarkup } from './templateUtils.js';

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
  const showEmbeddedCameraControls = ui.cameraControls === 'embedded';
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
      ${createStewardMessageMarkup()}
      ${showEmbeddedCameraControls ? createCameraControlsMarkup({ embedded: true, ui }) : ''}
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
