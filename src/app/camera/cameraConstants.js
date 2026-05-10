import { metersToSimUnits } from '../../simulation/units.js';
import { VEHICLE_GEOMETRY } from '../../simulation/vehicleGeometry.js';

export const CAMERA_TARGET_LERP = 0.12;
export const CAMERA_SCALE_LERP = 0.12;
export const CAMERA_PRESETS = {
  overview: 1,
  leader: 18,
  selected: 24,
  'show-all': 1,
  pit: 2.35,
};
export const CAMERA_MIN_ZOOM = 0.55;
export const CAMERA_MAX_ZOOM = 120;
export const CAMERA_ZOOM_STEP = 1.4;
export const TRACK_CAMERA_PADDING = metersToSimUnits(120);
export const SHOW_ALL_PADDING = 520;
export const SHOW_ALL_TOP_RESERVED = 92;
export const SHOW_ALL_BOTTOM_RESERVED = 132;
export const PIT_CAMERA_PADDING = metersToSimUnits(34);
export const CAR_WORLD_LENGTH = VEHICLE_GEOMETRY.visualLength;
