import { DEFAULT_MODULES } from './ruleDefaults.js';

export const RULESET_MODULES = {
  paddock: DEFAULT_MODULES,
  custom: DEFAULT_MODULES,
  grandPrix2025: {
    ...DEFAULT_MODULES,
    pitStops: {
      ...DEFAULT_MODULES.pitStops,
      enabled: true,
      pitLaneSpeedLimitKph: 80,
    },
    tireStrategy: {
      ...DEFAULT_MODULES.tireStrategy,
      enabled: true,
      mandatoryDistinctDryCompounds: 2,
    },
    penalties: {
      ...DEFAULT_MODULES.penalties,
      enabled: true,
      stewardStrictness: 0.85,
      trackLimits: {
        ...DEFAULT_MODULES.penalties.trackLimits,
        strictness: 0.85,
      },
      collision: {
        ...DEFAULT_MODULES.penalties.collision,
        strictness: 0.65,
      },
      tireRequirement: {
        ...DEFAULT_MODULES.penalties.tireRequirement,
        strictness: 1,
      },
      pitLaneSpeeding: {
        ...DEFAULT_MODULES.penalties.pitLaneSpeeding,
        strictness: 1,
        speedLimitKph: 80,
      },
    },
    fuelLoad: {
      enabled: false,
      reserved: true,
    },
  },
};

RULESET_MODULES.fia2025 = RULESET_MODULES.grandPrix2025;
