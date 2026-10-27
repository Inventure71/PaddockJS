import { describe, expect, test } from 'vitest';
import { createEvaluationTracker, runEnvironmentEvaluation } from '../environment/evaluation.js';

function result(completedLaps, lastLapTime, elapsedSeconds = 100) {
  return {
    state: { snapshot: { cars: [{
      id: 'driver', surface: 'track', rank: 1, distanceMeters: 100, progressMeters: 10,
      lapTelemetry: { completedLaps, lastLapTime, bestLapTime: 35 },
    }] } },
    info: { controlledDrivers: ['driver'], elapsedSeconds },
    observation: { driver: { vector: [] } }, events: [], done: false,
  };
}

describe('evaluation lap scope', () => {
  test('default scope waits for a new completion and keeps its actual duration', () => {
    const tracker = createEvaluationTracker(result(2, 40));
    tracker.update(result(2, 40, 101));
    expect(tracker.finish().driver.lapTimeSeconds).toBeNull();
    tracker.update(result(3, 42, 142));
    expect(tracker.finish().driver.lapTimeSeconds).toBe(42);
    tracker.update(result(4, 38, 180));
    expect(tracker.finish().driver.lapTimeSeconds).toBe(42);
  });

  test('include-history starts from the most recent recorded duration', () => {
    const tracker = createEvaluationTracker(result(2, 40), { lapScope: 'include-history' });
    expect(tracker.finish().driver.lapTimeSeconds).toBe(40);
    tracker.update(result(3, 42, 142));
    expect(tracker.finish().driver.lapTimeSeconds).toBe(40);
  });

  test.each([null, undefined, NaN, Infinity, -1])('missing/invalid history %j never uses best lap or elapsed time', (lastLapTime) => {
    const tracker = createEvaluationTracker(result(2, lastLapTime), { lapScope: 'include-history' });
    tracker.update(result(2, lastLapTime, 101));
    expect(tracker.finish().driver.lapTimeSeconds).toBeNull();
    tracker.update(result(3, 42, 142));
    expect(tracker.finish().driver.lapTimeSeconds).toBe(42);
  });

  test('a new lap with no recorded duration stays unknown', () => {
    const tracker = createEvaluationTracker(result(0, null, 0));
    tracker.update(result(1, null, 40));
    expect(tracker.finish().driver.lapTimeSeconds).toBeNull();
  });

  test.each(['since-start', 'include-history'])('evaluation forwards %s to the tracker', (lapScope) => {
    const report = runEnvironmentEvaluation({
      baseOptions: {}, lapScope,
      cases: [{ name: 'history', maxSteps: 1 }],
      policy: () => ({ steering: 0, throttle: 0, brake: 1 }),
      createEnvironment: () => ({ reset: () => result(2, 40), step: () => result(2, 40, 101), destroy() {} }),
    });
    expect(report.cases[0].metrics.driver.lapTimeSeconds).toBe(lapScope === 'include-history' ? 40 : null);
  });
});
