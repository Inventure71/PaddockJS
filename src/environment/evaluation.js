import { simUnitsToMeters } from '../simulation/units.js';
import { createPaddockEnvironment } from './runtime.js';

export const DEFAULT_EVALUATION_CASES = Object.freeze([
  {
    name: 'cornering',
    seed: 7101,
    trackSeed: 2601,
    maxSteps: 420,
    scenario: { preset: 'cornering' },
  },
  {
    name: 'off-track-recovery',
    seed: 7102,
    trackSeed: 2602,
    maxSteps: 360,
    scenario: { preset: 'off-track-recovery' },
  },
  {
    name: 'overtaking-pack',
    seed: 7103,
    trackSeed: 2603,
    maxSteps: 600,
    scenario: { preset: 'overtaking-pack' },
  },
  {
    name: 'pit-entry',
    seed: 7104,
    trackSeed: 2604,
    maxSteps: 480,
    scenario: { preset: 'pit-entry' },
  },
]);

export function runEnvironmentEvaluation({
  baseOptions,
  policy,
  cases = DEFAULT_EVALUATION_CASES,
  createEnvironment = createPaddockEnvironment,
} = {}) {
  if (!baseOptions || typeof baseOptions !== 'object') {
    throw new Error('PaddockJS environment evaluation requires baseOptions.');
  }
  if (!policy) {
    throw new Error('PaddockJS environment evaluation requires a policy function or object with predict().');
  }

  return {
    cases: cases.map((evaluationCase) => runEvaluationCase({
      baseOptions,
      policy,
      evaluationCase,
      createEnvironment,
    })),
  };
}

export function createEvaluationTracker(initialResult) {
  const initialCars = carsById(initialResult.state.snapshot);
  const metrics = Object.fromEntries(initialResult.info.controlledDrivers.map((driverId) => {
    const car = initialCars.get(driverId);
    return [driverId, {
      distanceMeters: 0,
      lapProgressMeters: lapProgressMetersFromSnapshotCar(car),
      offTrackSteps: car && car.surface !== 'track' ? 1 : 0,
      contactCount: 0,
      recoverySuccess: false,
      passCount: 0,
      lapTimeSeconds: null,
      startedOffTrack: Boolean(car && car.surface !== 'track'),
      startPosition: car?.rank ?? null,
      bestPosition: car?.rank ?? null,
      startDistanceMeters: cumulativeDistanceMetersFromSnapshotCar(car),
    }];
  }));

  return {
    update(result) {
      const currentCars = carsById(result.state.snapshot);
      result.info.controlledDrivers.forEach((driverId) => {
        const car = currentCars.get(driverId);
        const entry = metrics[driverId];
        if (!car || !entry) return;
        entry.distanceMeters = Math.max(0, cumulativeDistanceMetersFromSnapshotCar(car) - entry.startDistanceMeters);
        entry.lapProgressMeters = lapProgressMetersFromSnapshotCar(car);
        if (car.surface !== 'track') entry.offTrackSteps += 1;
        if (entry.startedOffTrack && car.surface === 'track') entry.recoverySuccess = true;
        if (Number.isFinite(car.rank)) {
          entry.bestPosition = entry.bestPosition == null ? car.rank : Math.min(entry.bestPosition, car.rank);
          entry.passCount = entry.startPosition == null ? 0 : Math.max(0, entry.startPosition - entry.bestPosition);
        }
        const completedLaps = car.lapTelemetry?.completedLaps ?? 0;
        if (completedLaps > 0 && entry.lapTimeSeconds == null) {
          entry.lapTimeSeconds = result.info.elapsedSeconds;
        }
      });
      result.events.forEach((event) => {
        if (event.type !== 'collision') return;
        Object.keys(metrics).forEach((driverId) => {
          if (event.driverId === driverId || event.carId === driverId || event.otherCarId === driverId || event.driverIds?.includes?.(driverId)) {
            metrics[driverId].contactCount += 1;
          }
        });
      });
    },
    finish() {
      return Object.fromEntries(Object.entries(metrics).map(([driverId, entry]) => [
        driverId,
        {
          distanceMeters: entry.distanceMeters,
          lapProgressMeters: entry.lapProgressMeters,
          offTrackSteps: entry.offTrackSteps,
          contactCount: entry.contactCount,
          recoverySuccess: entry.recoverySuccess,
          passCount: entry.passCount,
          lapTimeSeconds: entry.lapTimeSeconds,
        },
      ]));
    },
  };
}

function cumulativeDistanceMetersFromSnapshotCar(car) {
  const distance = Number(car?.distanceMeters ?? car?.raceDistanceMeters);
  if (Number.isFinite(distance)) return distance;
  return simUnitsToMeters(car?.raceDistance ?? 0);
}

function lapProgressMetersFromSnapshotCar(car) {
  const progressMeters = Number(car?.lapProgressMeters ?? car?.progressMeters);
  if (Number.isFinite(progressMeters)) return progressMeters;
  return simUnitsToMeters(car?.progress ?? 0);
}

function runEvaluationCase({ baseOptions, policy, evaluationCase, createEnvironment }) {
  const env = createEnvironment({
    ...baseOptions,
    seed: evaluationCase.seed ?? baseOptions.seed,
    trackSeed: evaluationCase.trackSeed ?? baseOptions.trackSeed,
    scenario: {
      ...(baseOptions.scenario ?? {}),
      ...(evaluationCase.scenario ?? {}),
    },
  });
  let result = env.reset();
  const tracker = createEvaluationTracker(result);
  const maxSteps = Math.max(1, Math.floor(evaluationCase.maxSteps ?? baseOptions.episode?.maxSteps ?? 1000));
  let steps = 0;
  while (!result.done && steps < maxSteps) {
    const actions = Object.fromEntries(result.info.controlledDrivers.map((driverId) => [
      driverId,
      predictAction(policy, result.observation[driverId], {
        driverId,
        caseName: evaluationCase.name,
        step: steps,
        result,
      }),
    ]));
    result = env.step(actions);
    tracker.update(result);
    steps += 1;
  }
  env.destroy?.();
  return {
    name: evaluationCase.name,
    seed: evaluationCase.seed ?? baseOptions.seed,
    trackSeed: evaluationCase.trackSeed ?? baseOptions.trackSeed,
    steps,
    done: result.done,
    endReason: result.info.endReason,
    metrics: tracker.finish(),
  };
}

function predictAction(policy, observation, context) {
  const action = typeof policy === 'function'
    ? policy(observation, context)
    : policy.predict(observation, context);
  return action ?? { steering: 0, throttle: 0, brake: 1 };
}

function carsById(snapshot) {
  return new Map(snapshot.cars.map((car) => [car.id, car]));
}
