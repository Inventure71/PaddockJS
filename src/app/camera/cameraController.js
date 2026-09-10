import { WORLD } from '../../simulation/track/trackModel.js';
import { clamp, normalizeAngle } from '../../simulation/simMath.js';
import {
  CAMERA_PRESETS,
  CAMERA_ROTATION_LERP,
  CAMERA_SCALE_LERP,
  CAMERA_TARGET_LERP,
  CAMERA_ZOOM_STEP,
  CAMERA_MIN_ZOOM,
  CAMERA_MAX_ZOOM,
} from './cameraConstants.js';
import {
  clampCameraScale,
  getCameraBoundsFitScale,
  getPitCameraBounds,
  getPitCameraFrame,
  getPitCameraTarget,
  getShowAllCameraFrame,
  getTrackCameraBounds,
  getTrackCameraTarget,
} from './cameraGeometry.js';

export function createCameraState(initialCameraMode) {
  return {
    mode: initialCameraMode,
    zoom: CAMERA_PRESETS[initialCameraMode] ?? CAMERA_PRESETS.leader,
    scale: null,
    initialized: false,
    x: WORLD.width / 2,
    y: WORLD.height / 2,
    rotation: 0,
    free: false,
    freeTarget: null,
  };
}

function timingTowerCandidates(readouts) {
  const nodes = [];
  readouts?.timingTowers?.forEach?.((node) => {
    if (node && !nodes.includes(node)) nodes.push(node);
  });
  if (readouts?.timingTower && !nodes.includes(readouts.timingTower)) {
    nodes.push(readouts.timingTower);
  }
  return nodes;
}

function timingTowerFrameForCanvas(readouts, canvasRect, canvasWidth) {
  for (const timingTower of timingTowerCandidates(readouts)) {
    const towerRect = timingTower?.getBoundingClientRect?.();
    if (!towerRect) continue;
    const overlapsCanvasHorizontally = towerRect.right > canvasRect.left && towerRect.left < canvasRect.right;
    const hasVerticalBounds = Number.isFinite(canvasRect.top) &&
      Number.isFinite(canvasRect.bottom) &&
      Number.isFinite(towerRect.top) &&
      Number.isFinite(towerRect.bottom);
    const overlapsCanvasVertically = !hasVerticalBounds ||
      (towerRect.bottom > canvasRect.top && towerRect.top < canvasRect.bottom);
    const towerWidth = Math.max(0, towerRect.right - towerRect.left);
    const isSideGutter = towerWidth < canvasWidth * 0.6;
    if (overlapsCanvasHorizontally && overlapsCanvasVertically && isSideGutter) return towerRect;
  }
  return null;
}

export class CameraController {
  constructor({ canvasHost, readouts, initialMode, driverCamera = false }) {
    this.canvasHost = canvasHost;
    this.readouts = readouts;
    this.camera = createCameraState(initialMode);
    this.driverCamera = Boolean(driverCamera);
    this.safeAreaCache = null;
    this.pitBoundsCache = null;
    this.trackBoundsCache = null;
  }

  setMode(mode, snapshot) {
    if (!this.isModeAvailable(mode, snapshot)) return false;
    this.camera.mode = mode;
    this.camera.free = false;
    this.camera.freeTarget = null;
    if (CAMERA_PRESETS[this.camera.mode]) this.camera.zoom = CAMERA_PRESETS[this.camera.mode];
    return true;
  }

  adjustZoom(direction) {
    const steps = Number.isFinite(Number(direction)) ? Number(direction) : 0;
    this.camera.zoom = clamp(this.camera.zoom + steps * CAMERA_ZOOM_STEP, CAMERA_MIN_ZOOM, CAMERA_MAX_ZOOM);
    return this.camera.zoom;
  }

  invalidateSafeArea() {
    this.safeAreaCache = null;
  }

  invalidateTrackCaches() {
    this.pitBoundsCache = null;
    this.trackBoundsCache = null;
  }

  getSafeArea(width) {
    if (this.safeAreaCache?.width === width) {
      return this.safeAreaCache.safeArea;
    }

    const canvasRect = this.canvasHost?.getBoundingClientRect?.();
    if (!canvasRect) {
      const safeArea = { left: 0, width };
      this.safeAreaCache = { width, safeArea };
      return safeArea;
    }
    const canvasWidth = Math.max(1, canvasRect.right - canvasRect.left || width);
    const towerRect = timingTowerFrameForCanvas(this.readouts, canvasRect, canvasWidth);
    if (!towerRect) {
      const safeArea = { left: 0, width };
      this.safeAreaCache = { width, safeArea };
      return safeArea;
    }

    const overlayGap = 16;
    const reservedLeft = clamp(towerRect.right - canvasRect.left + overlayGap, 0, width * 0.48);
    const safeArea = {
      left: reservedLeft,
      width: Math.max(1, width - reservedLeft),
    };
    this.safeAreaCache = { width, safeArea };
    return safeArea;
  }

  getTrackBounds(track) {
    if (this.trackBoundsCache && this.trackBoundsCache.track === track) {
      return this.trackBoundsCache.bounds;
    }
    const bounds = getTrackCameraBounds(track);
    this.trackBoundsCache = { track, bounds };
    return bounds;
  }

  getTrackTarget(track) {
    return getTrackCameraTarget(this.getTrackBounds(track));
  }

  getBoundsFitScale(bounds, height, safeArea) {
    return getCameraBoundsFitScale(bounds, height, safeArea);
  }

  getPitBounds(pitLane) {
    if (this.pitBoundsCache && this.pitBoundsCache.pitLane === pitLane) return this.pitBoundsCache.bounds;
    const bounds = getPitCameraBounds(pitLane);
    this.pitBoundsCache = { pitLane, bounds };
    return bounds;
  }

  getPitTarget(pitLane) {
    return getPitCameraTarget(this.getPitBounds(pitLane));
  }

  getPitFrame(pitLane, height, baseScale, safeArea, screenCenterX, minimumScale = null) {
    return getPitCameraFrame({
      pitBounds: this.getPitBounds(pitLane),
      cameraZoom: this.camera.zoom,
      height,
      baseScale,
      safeArea,
      screenCenterX,
      minimumScale,
    });
  }

  hasPitCamera(snapshot) {
    return Boolean(snapshot?.track?.pitLane?.enabled);
  }

  isModeAvailable(mode, snapshot) {
    if (!Object.hasOwn(CAMERA_PRESETS, mode)) return false;
    if (mode === 'pit') return this.hasPitCamera(snapshot);
    if (mode === 'driver') return this.driverCamera && Boolean(this.getFollowTarget(snapshot));
    return true;
  }

  getFrame(snapshot, width, height, baseScale, safeArea = { left: 0, width }, selectedId = null) {
    const activeSnapshot = snapshot ?? {};
    const screenCenterX = safeArea.left + safeArea.width / 2;
    const trackBounds = this.getTrackBounds(activeSnapshot.track);
    const trackFitScale = this.getBoundsFitScale(trackBounds, height, safeArea);

    if (this.camera.mode === 'overview') {
      const target = trackBounds
        ? {
            x: (trackBounds.minX + trackBounds.maxX) / 2,
            y: (trackBounds.minY + trackBounds.maxY) / 2,
          }
        : { x: WORLD.width / 2, y: WORLD.height / 2 };

      const scale = trackFitScale
        ? clampCameraScale(trackFitScale * this.camera.zoom, trackFitScale, trackFitScale)
        : clampCameraScale(baseScale * this.camera.zoom, baseScale);

      return this.applyFreeFrame({
        target,
        scale,
        screenX: screenCenterX,
        screenY: height / 2,
      });
    }

    if (this.camera.mode === 'show-all') {
      return this.applyFreeFrame(getShowAllCameraFrame({
        cars: activeSnapshot.cars ?? [],
        cameraZoom: this.camera.zoom,
        height,
        safeArea,
        screenCenterX,
        trackFitScale,
      }));
    }

    if (this.camera.mode === 'pit' && this.hasPitCamera(activeSnapshot)) {
      return this.applyFreeFrame(
        this.getPitFrame(activeSnapshot.track.pitLane, height, baseScale, safeArea, screenCenterX, trackFitScale),
      );
    }

    if (this.camera.mode === 'driver' && this.driverCamera) {
      const target = this.getFollowTarget(activeSnapshot, selectedId);
      return this.applyFreeFrame({
        target,
        scale: clampCameraScale(baseScale * this.camera.zoom, baseScale, trackFitScale),
        screenX: screenCenterX,
        screenY: height * 0.68,
        rotation: Number.isFinite(target?.heading) ? normalizeAngle(-Math.PI / 2 - target.heading) : 0,
      });
    }

    return this.applyFreeFrame({
      target: this.getTarget(activeSnapshot, selectedId),
      scale: clampCameraScale(baseScale * this.camera.zoom, baseScale, trackFitScale),
      screenX: screenCenterX,
      screenY: height / 2,
      rotation: 0,
    });
  }

  applyFreeFrame(frame) {
    if (!this.camera.free || !this.camera.freeTarget) return frame;
    return {
      ...frame,
      target: this.camera.freeTarget,
    };
  }

  getTarget(snapshot, selectedId = null) {
    const activeSnapshot = snapshot ?? {};
    if (this.camera.free && this.camera.freeTarget) return this.camera.freeTarget;
    if (this.camera.mode === 'overview') return this.getTrackTarget(activeSnapshot.track);

    if (this.camera.mode === 'pit' && this.hasPitCamera(activeSnapshot)) {
      return this.getPitTarget(activeSnapshot.track.pitLane);
    }

    if (this.camera.mode === 'selected' || this.camera.mode === 'driver') {
      return this.getFollowTarget(activeSnapshot, selectedId);
    }

    return this.getFollowTarget(activeSnapshot);
  }

  getFollowTarget(snapshot, selectedId = null) {
    if (selectedId != null) {
      const selected = snapshot?.cars?.find((car) => car.id === selectedId);
      if (selected) return selected;
    }
    const leader = snapshot?.cars?.[0];
    return leader ? { x: leader.x, y: leader.y } : { x: WORLD.width / 2, y: WORLD.height / 2 };
  }

  applyToWorldLayer(worldLayer, snapshot, { immediate = false, selectedId = null } = {}) {
    if (!worldLayer) return;

    const width = this.canvasHost.clientWidth || 900;
    const height = this.canvasHost.clientHeight || 640;
    const safeArea = this.getSafeArea(width);
    const baseScale = Math.min(safeArea.width / (WORLD.width + 260), height / (WORLD.height + 220));
    const frame = this.getFrame(snapshot, width, height, baseScale, safeArea, selectedId);
    const scale = frame.scale;
    const target = frame.target;
    const targetRotation = Number.isFinite(frame.rotation) ? frame.rotation : 0;
    const snapCamera = immediate || !this.camera.initialized;
    this.camera.x = snapCamera
      ? target.x
      : this.camera.x + (target.x - this.camera.x) * CAMERA_TARGET_LERP;
    this.camera.y = snapCamera
      ? target.y
      : this.camera.y + (target.y - this.camera.y) * CAMERA_TARGET_LERP;
    const activeScale = snapCamera || this.camera.scale === null
      ? scale
      : this.camera.scale + (scale - this.camera.scale) * CAMERA_SCALE_LERP;
    const activeRotation = snapCamera
      ? targetRotation
      : this.camera.rotation + normalizeAngle(targetRotation - this.camera.rotation) * CAMERA_ROTATION_LERP;
    this.camera.initialized = true;
    this.camera.scale = activeScale;
    this.camera.rotation = activeRotation;
    worldLayer.scale.set(activeScale);
    worldLayer.rotation = activeRotation;
    const cos = Math.cos(activeRotation);
    const sin = Math.sin(activeRotation);
    const transformedX = this.camera.x * cos - this.camera.y * sin;
    const transformedY = this.camera.x * sin + this.camera.y * cos;
    worldLayer.position.set(
      frame.screenX - transformedX * activeScale,
      frame.screenY - transformedY * activeScale,
    );
  }
}
