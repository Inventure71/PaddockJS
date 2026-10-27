import {
  createPaddockDriverControllerLoop,
  mountF1Simulator,
} from '@inventure71/paddockjs';
import { createDemoOptions, DEMO_DRIVERS } from '../data/demoOptions.js';
import { createExpertKeyboardController } from './expertKeyboard.js';
import { createExpertFrameScheduler } from './expertFrameScheduler.js';

export function installExpertLab({ button, workspace, root, status }) {
  let mounted = null;
  let loop = null;
  let launchPromise = null;
  let disposed = false;
  let keyboard = null;

  const syncKeys = ({ pressed }) => {
    workspace.querySelectorAll?.('[data-key]').forEach((key) => {
      key.classList.toggle('is-active', pressed.has(key.dataset.key));
    });
  };

  async function launch() {
    if (disposed) return;
    if (launchPromise) return launchPromise;
    launchPromise = (async () => {
      button.disabled = true;
      button.textContent = 'Loading advanced lab…';
      workspace.hidden = false;
      status.textContent = 'Creating expert runtime…';
      root.focus({ preventScroll: true });
      const playerId = DEMO_DRIVERS[0].id;
      const nextMounted = await mountF1Simulator(root, createDemoOptions({
        preset: 'compact-race',
        seed: 171,
        trackSeed: 7301,
        warmup: false,
        totalLaps: 2,
        physicsMode: 'advanced',
        rules: {
          ruleset: 'grandPrix2025',
          standingStart: false,
        },
        expert: {
          enabled: true,
          controlledDrivers: [playerId],
          frameSkip: 1,
          episode: { maxSteps: 100000, endOnRaceFinish: true },
          visualizeSensors: { rays: true, drivers: 'selected' },
        },
        initialCameraMode: 'driver',
        title: 'Advanced physics lab',
        kicker: 'Experimental physics · keyboard controls',
      }));

      if (disposed) {
        nextMounted.destroy();
        return;
      }
      mounted = nextMounted;
      keyboard = createExpertKeyboardController({ root, workspace, onInputChange: syncKeys });

      const hostController = {
        reset: keyboard.reset,
        decideBatch: keyboard.decideBatch,
        onStep(context) {
          const observation = context.observation?.[playerId]?.object;
          const speed = observation?.self?.speedKph ?? 0;
          const surface = observation?.self?.trackRelation?.surface ?? observation?.self?.surface ?? 'track';
          status.textContent = `${speed.toFixed(0)} km/h · ${surface} · ${context.observationSpec?.vectorLength ?? context.orderedObservations[0]?.vector?.length ?? 0} vector fields${keyboard.pitRequested ? ' · pit committed' : ''}`;
        },
      };

      loop = createPaddockDriverControllerLoop({
        runtime: mounted.expert,
        controller: hostController,
        actionRepeat: 2,
        mode: 'keyboard-demo',
        scheduler: createExpertFrameScheduler(),
      });
      loop.start();
      status.textContent = 'Expert mode ready · focus the race and drive';
      button.textContent = 'Advanced lab running';
    })().catch((error) => {
      releaseRuntime();
      if (disposed) return;
      status.textContent = `Expert mode failed: ${error.message}`;
      button.disabled = false;
      button.textContent = 'Try advanced lab again';
      launchPromise = null;
    });
    return launchPromise;
  }

  function releaseRuntime() {
    keyboard?.destroy();
    keyboard = null;
    loop?.stop();
    loop = null;
    mounted?.destroy();
    mounted = null;
  }

  button.addEventListener('click', launch);

  return () => {
    disposed = true;
    button.removeEventListener('click', launch);
    releaseRuntime();
  };
}
