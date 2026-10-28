import { NativeScrollSurface } from './NativeScrollSurface.js';
import { CAMERA_MIN_ZOOM, CAMERA_MAX_ZOOM, CAMERA_ZOOM_STEP } from '../camera/cameraConstants.js';

const ZOOM_STEP_PIXELS = 100;

// Maps browser-owned scroll coordinates onto one existing camera, never onto
// world geometry or simulation state. Buttons, selection and drags sync back.
export class SceneScrollController {
  constructor(app, signal) {
    this.app = app;
    this.surface = new NativeScrollSurface(app.canvasHost, ({ dx, dy }) => {
      const grid = app.gridWalk;
      if (grid?.active) {
        if (grid.session.clearing) return;
        const horizontal = grid.orientation === 'horizontal';
        const delta = horizontal ? Math.abs(dx) > Math.abs(dy) ? -dx : dy : -dy;
        if (grid.camera.pan(delta)) grid.render();
      } else if (dy) app.adjustCameraZoom(-dy / ZOOM_STEP_PIXELS);
    }, signal);
  }

  sync() {
    const { app, surface } = this;
    const grid = app.gridWalk;
    if (grid?.active) {
      const frame = grid.frame;
      if (!frame || grid.session.clearing) { surface.sync({ enabled: false }); return; }
      const max = (frame.maxPosition - frame.minPosition) * frame.scale;
      const horizontal = grid.orientation === 'horizontal';
      surface.sync({ maxX: horizontal ? max : 0, maxY: max,
        x: horizontal ? (frame.position - frame.minPosition) * frame.scale : 0,
        y: (frame.maxPosition - frame.position) * frame.scale });
    } else {
      surface.sync({ maxY: (CAMERA_MAX_ZOOM - CAMERA_MIN_ZOOM) / CAMERA_ZOOM_STEP * ZOOM_STEP_PIXELS,
        y: (CAMERA_MAX_ZOOM - app.camera.zoom) / CAMERA_ZOOM_STEP * ZOOM_STEP_PIXELS });
    }
  }
}
