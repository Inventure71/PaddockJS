export type PaddockProceduralTrackProfile = 'race' | 'training-short' | 'training-medium' | 'training-technical';

export interface PaddockProceduralTrackOptions {
  profile?: PaddockProceduralTrackProfile;
  minLengthMeters?: number;
  maxLengthMeters?: number;
  startStraightMeters?: number;
  includePitLane?: boolean;
  length?: {
    minMeters?: number;
    maxMeters?: number;
  };
  startStraight?: {
    gridMeters?: number;
    exitMeters?: number;
    blendMeters?: number;
    lockExtraMeters?: number;
  };
  pitLane?: {
    enabled?: boolean;
  };
  shape?: {
    scale?: number;
    cornerDensity?: number;
    variation?: number;
  };
  validation?: {
    minClearanceMultiplier?: number;
    minShapeVariation?: number;
    minNonAdjacentArcMeters?: number;
    maxLocalTurnRadians?: number;
    maxSampleHeadingDeltaRadians?: number;
  };
  attempts?: {
    primary?: number;
    fallback?: number;
  };
}

export interface PaddockTrackPoint {
  x: number;
  y: number;
}

export interface PaddockDrsZone {
  id: string;
  startRatio: number;
  endRatio: number;
}

export interface PaddockResolvedProceduralTrackOptions {
  profile: PaddockProceduralTrackProfile;
  length: {
    min: number;
    max: number;
  };
  startStraight: {
    grid: number;
    exit: number;
    blend: number;
    lockExtra: number;
  };
  pitLane: {
    enabled: boolean;
  };
  shape: {
    scale: number;
    cornerDensity: number;
    variation: number;
  };
  validation: {
    minClearanceMultiplier: number;
    minShapeVariation: number;
    minNonAdjacentArcDistance: number;
    maxLocalTurnRadians: number;
    maxSampleHeadingDeltaRadians: number;
  };
  attempts: {
    primary: number;
    fallback: number;
  };
  cacheKey: string;
  [key: string]: unknown;
}

export interface PaddockProceduralTrack {
  name: string;
  width: number;
  kerbWidth: number;
  gravelWidth: number;
  runoffWidth: number;
  barrierWidth: number;
  sampleCount: number;
  seed?: number;
  curveInterpolation?: string;
  centerlineControls?: readonly PaddockTrackPoint[];
  drsZones?: readonly PaddockDrsZone[] | null;
  pitLane?: { enabled?: boolean } | null;
  generationOptions?: PaddockResolvedProceduralTrackOptions;
  [key: string]: unknown;
}
