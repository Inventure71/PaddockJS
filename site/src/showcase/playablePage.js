import { DEMO_PROJECT_DRIVERS, createPaddockSimulator, createPaddockDriverControllerLoop, mountRaceTelemetryDrawer } from '@inventure71/paddockjs';
import { createAdvancedFrameCounter } from './advancedFrameCounter.js';
import { createPlayableFrameScheduler, createPlayableKeyboardController, createPlayableKeyboardState } from './playableKeyboardController.js';
import { visualFpsFromFrameGap } from './frameMetrics.js';

export async function mountPlayablePage({ requiredElement, commonOptions, previewPhysicsMode, previewUi, raceStrategyRules,
  addController, trackSeed }) {
  const COMPLETE_WORKBENCH_TRACK_SEED = trackSeed;
  const eventAbort = new AbortController();
  const eventOptions = { signal: eventAbort.signal };
  let disposed = false;
  const root = requiredElement('playable-root');
  const status = document.querySelector('[data-playable-status]');
  const readout = document.querySelector('[data-playable-readout]');
  const resetButton = document.querySelector('[data-playable-reset]');
  const pauseButton = document.querySelector('[data-playable-pause]');
  const pitIntentButtons = [...document.querySelectorAll('[data-playable-pit-intent]')];
  const compoundButtons = [...document.querySelectorAll('[data-playable-compound]')];
  const pitState = document.querySelector('[data-playable-pit-state]');
  const physicsSelect = document.querySelector('[data-playable-physics]');
  if (physicsSelect) {
    physicsSelect.value = previewPhysicsMode();
    physicsSelect.addEventListener('change', () => {
      const url = new URL(window.location.href);
      url.searchParams.set('physicsMode', physicsSelect.value);
      window.location.href = url.toString();
    }, eventOptions);
  }
  const keyNodes = new Map([...document.querySelectorAll('[data-playable-key]')].map((node) => [
    node.dataset.playableKey,
    node,
  ]));
  const playerId = DEMO_PROJECT_DRIVERS[0].id;
  const keyboard = createPlayableKeyboardState();
  const detachKeyboard = keyboard.attach();
  const keyboardController = createPlayableKeyboardController({ keyboard });
  let simulator = null;
  let controllerLoop = null;
  let result = null;
  let running = false;
  let visualFrame = 0;
  let lastPlayableFrameAt = 0;
  let lastPlayableFrameGapMs = 0;
  const frameCounter = createAdvancedFrameCounter(document.querySelector('[data-playable-frame-counter]'), {
    label: 'Player loop',
    metrics: [
      { key: 'visualFrame', label: 'Frame' },
      { key: 'simStep', label: 'Step' },
      { key: 'visualFps', label: 'fps', unit: 'fps' },
      { key: 'speedKph', label: 'Speed', unit: 'kph' },
      { key: 'steering', label: 'Steer' },
      { key: 'throttle', label: 'Thr' },
      { key: 'brake', label: 'Brake' },
      { key: 'pitIntent', label: 'Pit' },
    ],
  });

  const playableRules = raceStrategyRules();
  playableRules.standingStart = false;
  playableRules.modules = {
    ...playableRules.modules,
    stalledDnf: { enabled: false },
  };

  window.addEventListener('beforeunload', destroy, { once: true, signal: eventAbort.signal });
  try {
  simulator = createPaddockSimulator({
    ...commonOptions('playable'),
    title: 'Playable Complete Race Workbench',
    kicker: 'keyboard -> normalized controls',
    physicsMode: previewPhysicsMode(),
    seed: 71,
    trackSeed: COMPLETE_WORKBENCH_TRACK_SEED,
    totalLaps: 8,
    initialCameraMode: 'driver',
    rules: playableRules,
    theme: {
      tokens: {
        primary: '#f1c65b',
        pitLane: '#7c3aed',
      },
      timingTowerMaxWidth: '360px',
      raceViewMinHeight: '680px',
    },
    expert: {
      enabled: true,
      controlledDrivers: [playerId],
      frameSkip: 1,
    },
    ui: previewUi({
      penaltyBanners: true,
      timingPenaltyBadges: true,
      raceDataBannerSize: 'auto',
      timingTowerVerticalFit: 'expand-race-view',
      raceDataBanners: { initial: 'project', enabled: ['project', 'radio'] },
      driverCamera: true,
    }),
  });
  mountRaceTelemetryDrawer(root, simulator, {
    raceDataTelemetryDetail: true,
    timingTowerVerticalFit: 'expand-race-view',
  });
  await simulator.start();
  if (disposed) return { destroy };
  addController('playable', simulator);

  controllerLoop = createPaddockDriverControllerLoop({
    runtime: simulator.expert,
    controller: {
      ...keyboardController,
      onStep(context) {
        const now = performance.now();
        lastPlayableFrameGapMs = lastPlayableFrameAt > 0 ? now - lastPlayableFrameAt : 0;
        lastPlayableFrameAt = now;
        result = context.result;
        visualFrame += 1;
        if (result?.done) running = false;
        renderPlayableState();
      },
    },
    actionRepeat: 1,
    mode: 'keyboard-playable',
    scheduler: createPlayableFrameScheduler(),
  });

  await resetPlayable({ resume: true });

  function startPlayable() {
    if (running) return;
    running = true;
    controllerLoop.start();
    renderPlayableState();
  }

  function pausePlayable() {
    running = false;
    controllerLoop.stop();
    renderPlayableState();
  }

  async function resetPlayable({ resume = running } = {}) {
    keyboard.clear();
    controllerLoop.stop();
    result = await controllerLoop.reset();
    visualFrame = result?.info?.step ?? 0;
    lastPlayableFrameAt = 0;
    lastPlayableFrameGapMs = 0;
    running = false;
    renderPlayableState();
    if (resume) startPlayable();
  }

  function renderPlayableState() {
    const snapshot = result?.state?.snapshot ?? simulator.getSnapshot?.();
    const player = snapshot?.cars?.find((car) => car.id === playerId) ?? null;
    const action = keyboard.action();
    const pressedKeys = [...keyboard.keys()];
    const appliedControls = player?.appliedControls ?? null;
    const speedKph = Number(player?.speedKph ?? 0);
    const pitStop = player?.pitStop ?? null;
    const pitStopPhase = pitStop?.phase ?? pitStop?.status ?? 'none';
    const pitIntent = action.pitIntent ?? player?.pitIntent ?? pitStop?.intent ?? 0;
    const pitTargetCompound = action.pitCompound ?? pitStop?.targetTire ?? null;
    const pitStopsCompleted = pitStop?.stopsCompleted ?? 0;
    const done = Boolean(result?.done);
    const endReason = result?.info?.endReason ?? null;
    const readoutPayload = {
      playerId,
      running,
      done,
      endReason,
      pressedKeys,
      action,
      appliedControls,
      pitIntent,
      pitTargetCompound,
      pitStopStatus: pitStop?.status ?? null,
      pitStopPhase,
      pitStopServiceRemainingSeconds: pitStop?.serviceRemainingSeconds ?? null,
      pitStopsCompleted,
      pitLaneOpen: snapshot?.raceControl?.pitLaneOpen ?? snapshot?.pitLaneStatus?.open ?? null,
      speedKph: Math.round(speedKph),
      lap: player?.lap ?? null,
      surface: player?.surface ?? player?.trackState?.surface ?? null,
      trackOffsetMeters: player?.trackOffsetMeters ?? null,
      step: result?.info?.step ?? 0,
    };

    if (readout) readout.textContent = JSON.stringify(readoutPayload, null, 2);
    if (status) {
      status.textContent = [
        done ? `Stopped: ${endReason ?? 'done'}` : running ? 'Driving' : 'Paused',
        player?.code ?? playerId,
        `${Math.round(speedKph)} kph`,
        `pit ${formatPitIntent(pitIntent)} / ${pitStopPhase}`,
        pressedKeys.length ? `keys ${pressedKeys.join(' + ')}` : 'neutral',
      ].join(' · ');
    }
    if (pauseButton) pauseButton.textContent = running ? 'Pause' : 'Resume';
    keyNodes.forEach((node, key) => {
      const active = pressedKeys.includes(key);
      node.classList.toggle('is-active', active);
      node.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    pitIntentButtons.forEach((node) => {
      const active = Number(node.dataset.playablePitIntent) === pitIntent;
      node.classList.toggle('is-active', active);
      node.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    compoundButtons.forEach((node) => {
      const active = node.dataset.playableCompound === pitTargetCompound;
      node.classList.toggle('is-active', active);
      node.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    if (pitState) {
      pitState.textContent = [
        `Intent: ${formatPitIntent(pitIntent)}`,
        `Target: ${pitTargetCompound ?? 'auto'}`,
        `Phase: ${pitStopPhase}`,
        `Completed: ${pitStopsCompleted}`,
      ].join(' · ');
    }
    frameCounter.update({
      visualFrame,
      simStep: result?.info?.step ?? 0,
      visualFps: visualFpsFromFrameGap(lastPlayableFrameGapMs),
      speedKph: Math.round(speedKph),
      steering: action.steering,
      throttle: action.throttle,
      brake: action.brake,
      pitIntent,
    });
  }

  resetButton?.addEventListener('click', () => {
    void resetPlayable({ resume: running }).catch((error) => {
      pausePlayable();
      if (status && !disposed) status.textContent = `Playable reset failed: ${error.message}`;
    });
  }, eventOptions);
  pauseButton?.addEventListener('click', () => {
    if (running) {
      pausePlayable();
      return;
    }
    startPlayable();
  }, eventOptions);
  pitIntentButtons.forEach((button) => {
    button.addEventListener('click', () => {
      keyboard.setPitIntent(Number(button.dataset.playablePitIntent));
      button.blur?.();
      renderPlayableState();
    }, eventOptions);
  });
  compoundButtons.forEach((button) => {
    button.addEventListener('click', () => {
      keyboard.setPitCompound(button.dataset.playableCompound);
      button.blur?.();
      renderPlayableState();
    }, eventOptions);
  });
  return { destroy };
  } catch (error) { destroy(); throw error; }

  function destroy() {
    if (disposed) return;
    disposed = true;
    eventAbort.abort();
    detachKeyboard();
    try { controllerLoop?.stop(); } finally { simulator?.destroy(); }
  }
}

function formatPitIntent(value) {
  if (value === 2) return 'commit';
  if (value === 1) return 'request';
  return 'clear';
}
