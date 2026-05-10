import { kphToSimSpeed, metersToSimUnits } from '../units.js';

export const DEFAULT_RULES = {
  drsDetectionSeconds: 1,
  safetyCarSpeed: kphToSimSpeed(166),
  safetyCarLeadDistance: metersToSimUnits(55),
  safetyCarGap: metersToSimUnits(22),
  collisionRestitution: 0.18,
  standingStart: true,
  startLightCount: 5,
  startLightInterval: 0.72,
  startLightsOutHold: 0.78,
};

export const DEFAULT_MODULES = {
  pitStops: {
    enabled: false,
    pitLaneSpeedLimitKph: 80,
    defaultStopSeconds: 2.8,
    variability: {
      enabled: false,
      perfect: false,
      speedImpactSeconds: 1.2,
      consistencyJitterSeconds: 1.4,
      issueChance: 0.12,
      issueMaxDelaySeconds: 4,
    },
    maxConcurrentPitLaneCars: 3,
    minimumPitLaneGapMeters: 20,
    doubleStacking: false,
    tirePitRequestThresholdPercent: 50,
    tirePitCommitThresholdPercent: 30,
  },
  tireStrategy: {
    enabled: false,
    compounds: ['S', 'M', 'H'],
    mandatoryDistinctDryCompounds: null,
  },
  penalties: {
    enabled: false,
    stewardStrictness: 1,
    trackLimits: {
      strictness: 0,
      warningsBeforePenalty: 3,
      timePenaltySeconds: 5,
      relaxedMarginMeters: 3,
    },
    collision: {
      strictness: 0,
      timePenaltySeconds: 5,
      minimumSeverity: 2,
      relaxedSeverityMargin: 6,
      minimumImpactSpeedKph: 20,
      relaxedImpactSpeedKph: 20,
    },
    tireRequirement: {
      strictness: 0,
      timePenaltySeconds: 10,
    },
    pitLaneSpeeding: {
      strictness: 0,
      speedLimitKph: 80,
      marginKph: 0.5,
      relaxedMarginKph: 5,
      timePenaltySeconds: 5,
    },
  },
  weather: {
    enabled: false,
  },
  reliability: {
    enabled: false,
  },
  fuelLoad: {
    enabled: false,
  },
};
