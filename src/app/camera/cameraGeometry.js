import { WORLD } from '../../simulation/trackModel.js';
import { clamp } from '../../simulation/simMath.js';
import {
  CAMERA_MAX_ZOOM,
  CAMERA_MIN_ZOOM,
  CAR_WORLD_LENGTH,
  PIT_CAMERA_PADDING,
  SHOW_ALL_BOTTOM_RESERVED,
  SHOW_ALL_PADDING,
  SHOW_ALL_TOP_RESERVED,
  TRACK_CAMERA_PADDING,
} from './cameraConstants.js';

export function clampCameraScale(scale, anchorScale, minimumScale = null) {
  const safeAnchor = Number.isFinite(anchorScale) && anchorScale > 0 ? anchorScale : 1;
  const safeMinimum = Number.isFinite(minimumScale) && minimumScale > 0
    ? minimumScale
    : safeAnchor * CAMERA_MIN_ZOOM;
  return clamp(scale, safeMinimum, safeAnchor * CAMERA_MAX_ZOOM);
}

export function getCameraBoundsFitScale(bounds, height, safeArea) {
  if (!bounds) return null;
  const fitWidth = Math.max(CAR_WORLD_LENGTH * 3, bounds.maxX - bounds.minX);
  const fitHeight = Math.max(CAR_WORLD_LENGTH * 3, bounds.maxY - bounds.minY);
  const scale = Math.min(safeArea.width / fitWidth, height / fitHeight);
  return Number.isFinite(scale) && scale > 0 ? scale : null;
}

export function getTrackCameraBounds(track) {
  const bounds = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
  const includePoint = (point) => {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    bounds.minX = Math.min(bounds.minX, point.x);
    bounds.minY = Math.min(bounds.minY, point.y);
    bounds.maxX = Math.max(bounds.maxX, point.x);
    bounds.maxY = Math.max(bounds.maxY, point.y);
  };
  const includeBounds = (box) => {
    if (!box) return;
    includePoint({ x: box.minX, y: box.minY });
    includePoint({ x: box.maxX, y: box.maxY });
  };

  (track?.samples ?? []).forEach(includePoint);
  includeBounds(track?.pitLane?.bounds);

  const trackEdgePadding = Math.max(
    TRACK_CAMERA_PADDING,
    ((track?.width ?? 0) / 2) + (track?.kerbWidth ?? 0) + (track?.runoffWidth ?? 0),
  );
  return Number.isFinite(bounds.minX)
    ? {
        minX: bounds.minX - trackEdgePadding,
        minY: bounds.minY - trackEdgePadding,
        maxX: bounds.maxX + trackEdgePadding,
        maxY: bounds.maxY + trackEdgePadding,
      }
    : null;
}

export function getTrackCameraTarget(trackBounds) {
  if (!trackBounds) return { x: WORLD.width / 2, y: WORLD.height / 2 };

  return {
    x: (trackBounds.minX + trackBounds.maxX) / 2,
    y: (trackBounds.minY + trackBounds.maxY) / 2,
  };
}

export function getShowAllCameraFrame({ cars, cameraZoom, height, safeArea, screenCenterX, trackFitScale }) {
  const bounds = cars.reduce((box, car) => ({
    minX: Math.min(box.minX, car.x),
    minY: Math.min(box.minY, car.y),
    maxX: Math.max(box.maxX, car.x),
    maxY: Math.max(box.maxY, car.y),
  }), {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  });
  const target = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
  const fitWidth = Math.max(CAR_WORLD_LENGTH * 3, bounds.maxX - bounds.minX + SHOW_ALL_PADDING);
  const fitHeight = Math.max(CAR_WORLD_LENGTH * 3, bounds.maxY - bounds.minY + SHOW_ALL_PADDING);
  const safeHeight = Math.max(height * 0.48, height - SHOW_ALL_TOP_RESERVED - SHOW_ALL_BOTTOM_RESERVED);
  const fitScale = Math.min(safeArea.width / fitWidth, safeHeight / fitHeight);
  const scale = clampCameraScale(fitScale * cameraZoom, fitScale, trackFitScale);
  return {
    target,
    scale,
    screenX: screenCenterX,
    screenY: height / 2,
  };
}

export function getPitCameraBounds(pitLane) {
  const bounds = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
  const includePoint = (point) => {
    if (!point) return;
    bounds.minX = Math.min(bounds.minX, point.x);
    bounds.minY = Math.min(bounds.minY, point.y);
    bounds.maxX = Math.max(bounds.maxX, point.x);
    bounds.maxY = Math.max(bounds.maxY, point.y);
  };
  const includePoints = (points = []) => {
    points.forEach(includePoint);
  };

  includePoint(pitLane?.entry?.lanePoint);
  includePoints(pitLane?.mainLane?.points);
  includePoints(pitLane?.workingLane?.points);
  includePoint(pitLane?.exit?.lanePoint);
  (pitLane?.boxes ?? []).forEach((box) => includePoints(box.corners));
  (pitLane?.serviceAreas ?? []).forEach((area) => {
    includePoints(area.corners);
    includePoints(area.queueCorners);
  });

  return Number.isFinite(bounds.minX) ? bounds : null;
}

export function getPitCameraTarget(pitBounds) {
  if (!pitBounds) return { x: WORLD.width / 2, y: WORLD.height / 2 };

  return {
    x: (pitBounds.minX + pitBounds.maxX) / 2,
    y: (pitBounds.minY + pitBounds.maxY) / 2,
  };
}

export function getPitCameraFrame({
  pitBounds,
  cameraZoom,
  height,
  baseScale,
  safeArea,
  screenCenterX,
  minimumScale = null,
}) {
  const target = getPitCameraTarget(pitBounds);
  const presetScale = clampCameraScale(baseScale * cameraZoom, baseScale, minimumScale);
  if (!pitBounds) {
    return {
      target,
      scale: presetScale,
      screenX: screenCenterX,
      screenY: height / 2,
    };
  }

  const fitWidth = Math.max(CAR_WORLD_LENGTH * 3, pitBounds.maxX - pitBounds.minX + PIT_CAMERA_PADDING);
  const fitHeight = Math.max(CAR_WORLD_LENGTH * 3, pitBounds.maxY - pitBounds.minY + PIT_CAMERA_PADDING);
  const fitScale = Math.min(safeArea.width / fitWidth, height / fitHeight);
  const scale = clampCameraScale(fitScale * cameraZoom, fitScale, minimumScale);

  return {
    target,
    scale: Number.isFinite(scale) && scale > 0 ? scale : presetScale,
    screenX: screenCenterX,
    screenY: height / 2,
  };
}
