import { createEvaluationTracker } from './evaluationTracker.js';
export { createEvaluationTracker } from './evaluationTracker.js';
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
  lapScope = 'since-start',
  createEnvironment = createPaddockEnvironment,
} = {}) {
  if (!baseOptions || typeof baseOptions !== 'object') {
    throw new Error('PaddockJS environment evaluation requires baseOptions.');
  }
  if (!isEvaluationPolicy(policy)) {
    throw new Error('PaddockJS environment evaluation requires a policy function or object with predict().');
  }

  return {
    cases: cases.map((evaluationCase) => runEvaluationCase({
      baseOptions,
      policy,
      evaluationCase,
      createEnvironment,
      lapScope,
    })),
  };
}

function isEvaluationPolicy(policy) {
  return typeof policy === 'function' ||
    (policy != null && typeof policy.predict === 'function');
}

function runEvaluationCase({ baseOptions, policy, evaluationCase, createEnvironment, lapScope }) {
  const env = createEnvironment({
    ...baseOptions,
    result: {
      ...(baseOptions.result ?? {}),
      stateOutput: normalizeEvaluationStateOutput(baseOptions.result?.stateOutput),
    },
    seed: evaluationCase.seed ?? baseOptions.seed,
    trackSeed: evaluationCase.trackSeed ?? baseOptions.trackSeed,
    scenario: {
      ...(baseOptions.scenario ?? {}),
      ...(evaluationCase.scenario ?? {}),
    },
  });
  try {
    let result = env.reset();
    const tracker = createEvaluationTracker(result, { lapScope });
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
    return {
      name: evaluationCase.name,
      seed: evaluationCase.seed ?? baseOptions.seed,
      trackSeed: evaluationCase.trackSeed ?? baseOptions.trackSeed,
      steps,
      done: result.done,
      endReason: result.info.endReason,
      metrics: tracker.finish(),
    };
  } finally {
    env.destroy?.();
  }
}

function normalizeEvaluationStateOutput(stateOutput) {
  return stateOutput === 'none' ? 'minimal' : stateOutput;
}

function predictAction(policy, observation, context) {
  const action = typeof policy === 'function'
    ? policy(observation, context)
    : policy.predict(observation, context);
  return action ?? { steering: 0, throttle: 0, brake: 1 };
}
