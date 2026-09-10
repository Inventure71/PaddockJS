import { metersToSimUnits } from '../units.js';

export const WORLD = {
  width: metersToSimUnits(3550),
  height: metersToSimUnits(2148),
};

export const TRACK = {
  name: 'Apex Harbor GP',
  width: metersToSimUnits(15),
  kerbWidth: metersToSimUnits(1.5),
  gravelWidth: metersToSimUnits(12),
  runoffWidth: metersToSimUnits(20),
  barrierWidth: metersToSimUnits(0.55),
  sampleCount: 3600,
  drsZones: [
    { id: 'main-straight', startRatio: 0.02, endRatio: 0.18 },
    { id: 'back-straight', startRatio: 0.43, endRatio: 0.60 },
    { id: 'harbor-straight', startRatio: 0.82, endRatio: 0.96 },
  ],
};

export const GENERATED_TRACK_MIN_LENGTH = metersToSimUnits(3600);
export const GENERATED_TRACK_MAX_LENGTH = metersToSimUnits(9000);
export const GENERATED_TRACK_ATTEMPTS = 24;
export const GENERATED_FALLBACK_ATTEMPTS = 8;
export const TRACK_BOUNDARY_PADDING = metersToSimUnits(248);
export const MIN_NON_ADJACENT_ARC_DISTANCE = metersToSimUnits(700);
export const MIN_TRACK_CLEARANCE_MULTIPLIER = 1.55;
export const MIN_TRACK_SHAPE_VARIATION = 0.28;
export const MAX_LOCAL_TURN_RADIANS = 1.42;
export const MAX_SAMPLE_HEADING_DELTA_RADIANS = 0.08;
export const START_STRAIGHT_GRID_LENGTH = metersToSimUnits(496);
export const START_STRAIGHT_EXIT_LENGTH = metersToSimUnits(500);
export const START_STRAIGHT_LOCK_EXTRA = metersToSimUnits(43);
export const START_STRAIGHT_BLEND_LENGTH = metersToSimUnits(320);
export const PIT_LANE_WIDTH = metersToSimUnits(12);
export const PIT_LANE_EDGE_GAP = metersToSimUnits(16);
export const PIT_ACCESS_MIN_LENGTH = metersToSimUnits(70);
export const PIT_ACCESS_MAX_LENGTH = metersToSimUnits(150);
export const PIT_ACCESS_TANGENT_RATIO = 0.72;
export const PIT_ACCESS_SAMPLE_STEPS = 24;
export const PIT_ACCESS_TRACK_OVERLAP = PIT_LANE_WIDTH * 0.52;
export const PIT_ACCESS_SEARCH_STEP = metersToSimUnits(8);
export const PIT_ENTRY_SEARCH_BEFORE = metersToSimUnits(230);
export const PIT_ENTRY_SEARCH_AFTER = metersToSimUnits(250);
export const PIT_EXIT_SEARCH_BEFORE = metersToSimUnits(60);
export const PIT_EXIT_SEARCH_AFTER = metersToSimUnits(560);
export const PIT_TEAM_COUNT = 10;
export const PIT_BOXES_PER_TEAM = 2;
export const PIT_BOX_COUNT = PIT_TEAM_COUNT * PIT_BOXES_PER_TEAM;
export const PIT_BOX_LENGTH = metersToSimUnits(9);
export const PIT_BOX_DEPTH = metersToSimUnits(4.5);
export const PIT_BOX_PAIR_GAP = metersToSimUnits(4);
export const PIT_TEAM_GAP = metersToSimUnits(14);
export const PIT_BOX_TO_LANE_GAP = metersToSimUnits(1.5);
export const PIT_WORKING_LANE_GAP = metersToSimUnits(1.5);
export const PIT_WORKING_LANE_WIDTH = metersToSimUnits(8);
export const PIT_SERVICE_AREA_LENGTH = metersToSimUnits(11);
export const PIT_SERVICE_AREA_DEPTH = metersToSimUnits(5);
export const PIT_SERVICE_QUEUE_GAP = metersToSimUnits(12);
export const PIT_LANE_ENTRY_BUFFER = metersToSimUnits(44);
export const PIT_LANE_EXIT_BUFFER = metersToSimUnits(44);
export const PIT_LANE_FINISH_RATIO = 0.64;
export const PIT_WORLD_PADDING = metersToSimUnits(24);
export const PIT_TRACK_CLEARANCE_MARGIN = metersToSimUnits(5);
export const PIT_LANE_OFFSET_SEARCH_STEP = metersToSimUnits(12);
export const CENTERLINE_CONTROLS = [
  { x: WORLD.width * 0.05, y: WORLD.height * 0.56 },
  { x: WORLD.width * 0.10, y: WORLD.height * 0.81 },
  { x: WORLD.width * 0.23, y: WORLD.height * 0.91 },
  { x: WORLD.width * 0.35, y: WORLD.height * 0.80 },
  { x: WORLD.width * 0.48, y: WORLD.height * 0.90 },
  { x: WORLD.width * 0.59, y: WORLD.height * 0.75 },
  { x: WORLD.width * 0.71, y: WORLD.height * 0.87 },
  { x: WORLD.width * 0.82, y: WORLD.height * 0.72 },
  { x: WORLD.width * 0.94, y: WORLD.height * 0.66 },
  { x: WORLD.width * 0.96, y: WORLD.height * 0.47 },
  { x: WORLD.width * 0.88, y: WORLD.height * 0.33 },
  { x: WORLD.width * 0.74, y: WORLD.height * 0.31 },
  { x: WORLD.width * 0.64, y: WORLD.height * 0.18 },
  { x: WORLD.width * 0.54, y: WORLD.height * 0.31 },
  { x: WORLD.width * 0.43, y: WORLD.height * 0.13 },
  { x: WORLD.width * 0.29, y: WORLD.height * 0.18 },
  { x: WORLD.width * 0.17, y: WORLD.height * 0.31 },
  { x: WORLD.width * 0.08, y: WORLD.height * 0.43 },
];
