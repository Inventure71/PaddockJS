import { DEMO_DRIVERS, DEMO_ENTRIES } from '../data/demoOptions.js';

export function installHeadlessLab({ button, status, metrics, output }) {
  let running = false;

  button.addEventListener('click', async () => {
    if (running) return;
    running = true;
    button.disabled = true;
    status.textContent = 'Importing the browser-free environment…';
    let env = null;

    try {
      const {
        DEFAULT_EVALUATION_CASES,
        ENVIRONMENT_SCENARIO_PRESETS,
        createEnvironmentWorkerProtocol,
        createPaddockEnvironment,
        createProgressReward,
        createRolloutRecorder,
        createRolloutTransition,
        runEnvironmentEvaluation,
      } = await import('@inventure71/paddockjs/environment');

      let externalFrames = 0;
      const playerId = DEMO_DRIVERS[0].id;
      const baseOptions = {
        drivers: DEMO_DRIVERS.slice(0, 4),
        entries: DEMO_ENTRIES.slice(0, 4),
        controlledDrivers: [playerId],
        seed: 271,
        trackSeed: 7401,
        trackGeneration: { profile: 'training-short' },
        totalLaps: 1,
        frameSkip: 2,
        physicsMode: 'arcade',
        warmup: false,
        rules: { ruleset: 'paddock', standingStart: false },
        scenario: { preset: 'cornering', participants: 'all', nonControlled: 'ai' },
        sensors: {
          rays: { layout: 'driver-front-heavy', channels: ['roadEdge', 'kerb', 'illegalSurface', 'car'] },
          nearbyCars: { enabled: true, maxCars: 4 },
        },
        observation: { profile: 'physical-driver', output: 'full', includeSchema: false },
        result: { stateOutput: 'minimal' },
        episode: { maxSteps: 80, endOnRaceFinish: true },
        reward: createProgressReward(),
        externalRenderer: () => { externalFrames += 1; },
      };

      env = createPaddockEnvironment(baseOptions);
      const recorder = createRolloutRecorder();
      const protocol = createEnvironmentWorkerProtocol(env);
      let previous = env.reset();
      let firstTransition = null;
      let latest = previous;

      for (let index = 0; index < 12; index += 1) {
        const action = {
          [playerId]: {
            steering: Math.sin(index / 5) * 0.12,
            throttle: 0.72,
            brake: 0,
          },
        };
        latest = env.step(action);
        recorder.recordStep(previous, action, latest);
        firstTransition ??= createRolloutTransition(previous, action, latest);
        previous = latest;
        if (latest.done) break;
      }

      const workerReply = protocol.handle({ id: 'demo-spec', type: 'getObservationSpec' });
      const evaluation = runEnvironmentEvaluation({
        baseOptions: { ...baseOptions, externalRenderer: undefined, result: { stateOutput: 'minimal' } },
        cases: [{ name: 'demo-corner', seed: 272, trackSeed: 7402, maxSteps: 6, scenario: { preset: 'cornering' } }],
        policy: () => ({ steering: 0.04, throttle: 0.7, brake: 0 }),
      });
      const observation = latest.observation?.[playerId];
      const self = observation?.object?.self;
      const actionSpec = env.getActionSpec();
      const observationSpec = env.getObservationSpec();
      const values = [
        observation?.vector?.length ?? 0,
        latest.info?.step ?? 0,
        `${Number(self?.speedKph ?? 0).toFixed(0)} km/h`,
        Number(latest.reward?.[playerId] ?? 0).toFixed(3),
        latest.events?.length ?? 0,
        workerReply.ok ? 'OK' : 'Error',
      ];
      metrics.querySelectorAll('dd').forEach((node, index) => { node.textContent = String(values[index]); });

      output.textContent = JSON.stringify({
        controlledDrivers: latest.info?.controlledDrivers,
        actionFields: Object.keys(actionSpec.action.perDriver),
        vectorLength: observation?.vector?.length,
        observationProfile: observationSpec.object.profile,
        surface: self?.trackRelation?.surface ?? self?.surface,
        appliedControls: self?.appliedControls,
        nearbyCars: observation?.object?.nearbyCars?.length,
        rolloutTransitions: recorder.toJSON().length,
        transitionKeys: Object.keys(firstTransition ?? {}),
        externalFrames,
        workerReply: { ok: workerReply.ok, type: workerReply.type },
        scenarioPresets: ENVIRONMENT_SCENARIO_PRESETS,
        evaluationCasesAvailable: DEFAULT_EVALUATION_CASES.map((item) => item.name),
        demoEvaluation: evaluation.cases[0],
      }, null, 2);
      status.textContent = '12 deterministic steps, rollout recording, worker protocol, and evaluation complete.';
    } catch (error) {
      status.textContent = `Headless lab failed: ${error.message}`;
      output.textContent = error.stack ?? String(error);
    } finally {
      env?.destroy();
      running = false;
      button.disabled = false;
    }
  });
}
