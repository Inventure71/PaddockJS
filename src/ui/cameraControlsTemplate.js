import { createLoadingMarkup } from './templateUtils.js';

export function createCameraControlsMarkup({ embedded = false, showSimulationSpeed = false, ui = {} } = {}) {
  const className = embedded ? 'camera-controls' : 'camera-controls camera-controls--external';
  const showSpeedControl = showSimulationSpeed || ui.simulationSpeedControl === true;
  return `
      <div class="${className}" data-paddock-component="camera-controls" aria-label="Camera controls">
        <button type="button" data-camera-mode="overview" aria-pressed="false">Overview</button>
        <button type="button" data-camera-mode="leader" aria-pressed="true">Leader</button>
        <button type="button" data-camera-mode="selected" aria-pressed="false">Selected</button>
        <button type="button" data-camera-mode="show-all" aria-pressed="false">Show all</button>
        <button type="button" data-camera-mode="pit" aria-pressed="false">Pits</button>
        <button type="button" data-zoom-out aria-label="Zoom out">-</button>
        <button type="button" data-zoom-in aria-label="Zoom in">+</button>
        ${showSpeedControl ? '<button type="button" data-simulation-speed aria-label="Simulation speed">1x</button>' : ''}
        <button type="button" data-race-data-banners-muted aria-pressed="false">Mute banners</button>
        ${createLoadingMarkup('Camera controls')}
      </div>
  `;
}
