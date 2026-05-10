import { CAMERA_PRESETS } from '../camera/cameraConstants.js';

export function updateCameraControlButtons({ camera, cameraButtons, snapshot, hasPitCamera, isCameraModeAvailable }) {
  if (camera.mode === 'pit' && !hasPitCamera(snapshot)) {
    camera.mode = 'leader';
    camera.zoom = CAMERA_PRESETS.leader;
  }

  cameraButtons.forEach((button) => {
    const mode = button.dataset.cameraMode;
    const isAvailable = isCameraModeAvailable(mode, snapshot);
    if (mode === 'pit') {
      button.hidden = !isAvailable;
      button.disabled = !isAvailable;
      button.setAttribute('aria-hidden', String(!isAvailable));
    }

    const isActive = !camera.free && isAvailable && mode === camera.mode;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
}

export function updateToggleButtons(buttons, active) {
  buttons?.forEach((button) => {
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

export function updateModeButtons(buttons, activeMode, datasetKey) {
  buttons.forEach((button) => {
    const isActive = button.dataset[datasetKey] === activeMode;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
}
