import { CHAMPIONSHIP_ENTRY_BLUEPRINTS, DEMO_PROJECT_DRIVERS } from '@inventure71/paddockjs';
import { POLICY_ACTION_HOLD_FRAMES } from './settings.js';
const POLICY_TRAINING_REPLAY_MAX_POLICY_STEPS = 420;
const POLICY_TRAINING_REPLAY_STALL_POLICY_STEPS = 32;
const POLICY_TRAINING_REPLAY_SPIN_POLICY_STEPS = 32;

export function createPolicyRunnerTrainingField(count = 20) {
  const drivers = Array.from({ length: count }, (_, index) => {
    const source = DEMO_PROJECT_DRIVERS[index % DEMO_PROJECT_DRIVERS.length];
    return {
      ...source,
      id: `policy-agent-${String(index + 1).padStart(2, '0')}`,
      code: `P${String(index + 1).padStart(2, '0')}`,
      icon: `${index + 1}`,
      raceName: `POLICY-${String(index + 1).padStart(2, '0')}`,
      name: `Policy Agent ${index + 1}`,
      color: colorForPolicyAgent(index),
      tire: 'M',
    };
  });
  const entries = drivers.map((driver, index) => {
    const source = CHAMPIONSHIP_ENTRY_BLUEPRINTS[index % CHAMPIONSHIP_ENTRY_BLUEPRINTS.length] ?? {};
    return {
      ...source,
      driverId: driver.id,
      driverNumber: 71 + index,
      timingName: driver.code,
      driver: {
        ...(source.driver ?? {}),
        pace: 75,
        racecraft: 75,
        aggression: 55,
        riskTolerance: 55,
        patience: 65,
        consistency: 70,
      },
      vehicle: {
        ...(source.vehicle ?? {}),
        id: `${driver.id}-car`,
        name: `Policy ${index + 1}`,
        power: 75,
        braking: 70,
        aero: 72,
        dragEfficiency: 68,
        mechanicalGrip: 74,
        weightControl: 70,
        tireCare: 100,
      },
    };
  });
  return { drivers, entries };
}

function colorForPolicyAgent(index) {
  const colors = ['#e10600', '#00a3ff', '#f1c65b', '#49d17d', '#ff7b00', '#a855f7', '#06b6d4', '#ef4444'];
  return colors[index % colors.length];
}

export function createPolicyRunnerConfigurations(trainingField, primaryControlledDriver, { previewPhysicsMode, previewRules }) {
  const controlledDrivers = trainingField.drivers.map((driver) => driver.id);
  return [
    {
      id: 'generation',
      label: `Generation - ${controlledDrivers.length} self-learning cars`,
      trackSeed: 2097,
      totalLaps: 5,
      controlledDrivers,
      options: {
        drivers: trainingField.drivers,
        entries: trainingField.entries,
        participantInteractions: {
          defaultProfile: 'batch-training',
        },
        scenario: {
          placements: policyRunnerTrainingPlacements(controlledDrivers, 'basic-track-follow'),
        },
        rules: trainingPolicyRules(previewRules),
      },
    },
    {
      id: 'training-batch',
      label: `Training Batch Replay - ${controlledDrivers.length} cars`,
      trackSeed: 2097,
      totalLaps: 5,
      controlledDrivers,
      trainingBatchReplay: true,
      trainingStage: 'basic-track-follow',
      options: {
        drivers: trainingField.drivers,
        entries: trainingField.entries,
        participantInteractions: {
          defaultProfile: 'batch-training',
        },
        scenario: {
          placements: policyRunnerTrainingPlacements(controlledDrivers, 'basic-track-follow'),
        },
        rules: trainingPolicyRules(previewRules),
      },
    },
    {
      id: 'race',
      label: 'Race - full real field',
      controlledDrivers: [primaryControlledDriver],
      options: {
        drivers: DEMO_PROJECT_DRIVERS,
        entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      },
    },
  ].map((configuration) => ({
    ...configuration,
    options: {
      ...configuration.options,
      controlledDrivers: configuration.controlledDrivers,
      physicsMode: previewPhysicsMode(),
      observation: {
        ...(configuration.options.observation ?? {}),
        profile: 'physical-driver',
        output: 'full',
        includeSchema: true,
      },
      sensors: {
        rays: {
          enabled: true,
          layout: 'driver-front-heavy',
          channels: ['roadEdge', 'kerb', 'illegalSurface', 'car'],
          precision: 'driver',
          ...(configuration.options.sensors?.rays ?? {}),
        },
        nearbyCars: {
          enabled: true,
          maxCars: 6,
          radiusMeters: 160,
          ...(configuration.options.sensors?.nearbyCars ?? {}),
        },
      },
    },
  }));
}

function policyRunnerTrainingPlacements(driverIds, stage = 'basic-track-follow') {
  return Object.fromEntries(driverIds.map((driverId, index) => [
    driverId,
    trainingReplayPlacement(index, { episodeId: 0 }, stage),
  ]));
}

export function createTrainingReplayDriverRuntime(episodeId = 0) {
  return {
    episodeId,
    policyStep: 0,
    visualFramesInEpisode: 0,
    consecutiveUnder30Frames: 0,
    consecutiveSpinFrames: 0,
    completedLaps: 0,
  };
}

export function updateTrainingReplayRuntime(runtime, metric) {
  runtime.visualFramesInEpisode += 1;
  if (runtime.visualFramesInEpisode % POLICY_ACTION_HOLD_FRAMES === 1) {
    runtime.policyStep += 1;
  }
  runtime.consecutiveUnder30Frames = metric.under30kph ? runtime.consecutiveUnder30Frames + 1 : 0;
  runtime.consecutiveSpinFrames = metric.spinOrBackwards ? runtime.consecutiveSpinFrames + 1 : 0;
  if (metric.completedLap) runtime.completedLaps += 1;
}

export function trainingReplayResetReason(runtime, metric) {
  if (metric.destroyed) return 'destroyed';
  if (metric.fullyOutsideWhiteLine || metric.severeCut) return 'illegal';
  if (metric.offTrack && !metric.kerb) return 'illegal';
  if (runtime.consecutiveUnder30Frames >= POLICY_TRAINING_REPLAY_STALL_POLICY_STEPS * POLICY_ACTION_HOLD_FRAMES) return 'stall';
  if (runtime.consecutiveSpinFrames >= POLICY_TRAINING_REPLAY_SPIN_POLICY_STEPS * POLICY_ACTION_HOLD_FRAMES) return 'spin';
  if (runtime.policyStep >= POLICY_TRAINING_REPLAY_MAX_POLICY_STEPS) return 'episode-cap';
  return null;
}

export function recordTrainingReplayReset(stats, driverId, reason) {
  stats.resetCount += 1;
  stats.resetReasons[reason] = (stats.resetReasons[reason] ?? 0) + 1;
  stats.lastResetDrivers = [
    `${driverId}:${reason}`,
    ...stats.lastResetDrivers,
  ].slice(0, 8);
}

export function trainingReplayPlacement(index, runtime, stage = 'basic-track-follow') {
  const lane = index % 4;
  const group = Math.floor(index / 4);
  const basicOffset = [-0.45, -0.15, 0.15, 0.45][lane] ?? 0;
  const recoveryOffset = [-3.0, -1.0, 1.0, 3.0][lane] ?? 0;
  const jitter = policyRunnerSeededJitter(71 + runtime.episodeId, index);
  if (stage === 'recovery') {
    return {
      distanceMeters: 2250 + group * 16 + lane * 3,
      offsetMeters: recoveryOffset + (index % 2 === 0 ? 12 : -12),
      speedKph: 55,
      headingErrorRadians: (index % 2 === 0 ? -0.55 : 0.55) + jitter * 0.12,
    };
  }
  if (stage === 'cornering') {
    return {
      distanceMeters: 1050 + group * 16 + lane * 3,
      offsetMeters: basicOffset,
      speedKph: 145,
      headingErrorRadians: jitter * 0.08,
    };
  }
  return {
    distanceMeters: group * 16 + lane * 3,
    offsetMeters: basicOffset,
    speedKph: 80,
    headingErrorRadians: jitter * 0.05,
  };
}

function policyRunnerSeededJitter(seed, index) {
  const x = Math.sin((Number(seed) + 1) * 12.9898 + (index + 1) * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

function trainingPolicyRules(previewRules) {
  return previewRules({
    standingStart: false,
    modules: {
      pitStops: { enabled: false },
      tireDegradation: { enabled: false },
      penalties: {
        trackLimits: { strictness: 0 },
        collision: { strictness: 0 },
      },
    },
  });
}
