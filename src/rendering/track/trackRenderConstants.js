import { metersToSimUnits } from '../../simulation/units.js';

export const MATERIAL_TILE_SCALE = {
  asphalt: { x: 0.66, y: 0.66 },
};
export const WORLD_BACKGROUND_PADDING_MULTIPLIER = 8;
export const GRASS_COLOR = 0x2e7d32;
export const GRAVEL_COLOR = 0xb49a68;
export const ASPHALT_COLOR = 0x4a4d52;
export const PIT_ASPHALT_COLOR = ASPHALT_COLOR;
export const PIT_BOX_COLOR = 0x242831;
export const PIT_LINE_COLOR = 0xf8fafc;
export const PIT_SPEED_LINE_COLOR = 0xffd166;
export const PIT_CONNECTOR_WIDTH = metersToSimUnits(12);
export const PIT_EDGE_WIDTH = metersToSimUnits(0.35);
export const EDGE_REVEAL_OFFSET = metersToSimUnits(0.35);
export const EDGE_REVEAL_WIDTH = metersToSimUnits(0.5);
export const OUTER_BOUNDARY_OFFSET = metersToSimUnits(1.1);
export const OUTER_BOUNDARY_WIDTH = metersToSimUnits(0.75);
export const KERB_OFFSET = metersToSimUnits(0.45);
export const KERB_WIDTH = metersToSimUnits(1.25);
export const FINISH_LINE_DEPTH = metersToSimUnits(8);
export const FINISH_LINE_COLUMNS = 10;
export const START_GRID_SLOT_COUNT = 20;
export const START_GRID_SLOT_SPACING = metersToSimUnits(8);
export const START_GRID_FIRST_DISTANCE = metersToSimUnits(-6);
export const START_GRID_LATERAL_OFFSET = metersToSimUnits(3.2);
export const START_GRID_BOX_LENGTH = metersToSimUnits(7);
export const START_GRID_BOX_WIDTH = metersToSimUnits(3.2);
export const SEGMENTED_STROKE_STEP = 2;
export const KERB_STEP = 4;
export const KERB_CURVATURE_THRESHOLD = 0.00038;
export const OFFSET_SEGMENT_SAMPLE_COUNT = 7;
export const NON_LOCAL_SAMPLE_STEP = 8;
export const OFFSET_GAP_SAMPLE_COUNT = 4;
