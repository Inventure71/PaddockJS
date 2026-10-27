import { siteUrl } from '../../shared/routes.js';
import { stepPolicyRunner } from './stepResult.js';
import { createLiveResult, policyRunnerPresentation } from './liveResult.js';
import { roundMs, visualFpsFromFrameGap } from '../frameMetrics.js';
import { createPolicyRunnerSession, createPolicyRunnerPlayback } from './session.js';
import { createLiveNodeConnection } from './liveConnection.js';
import { DEMO_PROJECT_DRIVERS, mountF1Simulator, createPaddockDriverControllerLoop } from '@inventure71/paddockjs';
import { createPolicyRunnerView } from './view.js';
import { loadCheckpointPolicyPayload } from './checkpointPolicy.js';
import { createDistilledPolicyController, createIdlePolicyController, createLiveNodeViewController, createPolicyServerController } from './controllers.js';
import { compactPolicyServerRuntimeOptions } from './transportOptions.js';
import { createAdvancedFrameCounter } from '../advancedFrameCounter.js';
import { createThrottledJsonReadout } from '../debugJsonReadout.js';
import { createPolicyRunnerTrainingField, createPolicyRunnerConfigurations, createTrainingReplayDriverRuntime,
  updateTrainingReplayRuntime, trainingReplayResetReason, recordTrainingReplayReset, trainingReplayPlacement } from './trainingConfigurations.js';
import { POLICY_ACTION_HOLD_FRAMES, POLICY_TRACK_PROFILE_OPTIONS } from './settings.js';
const DISTILLED_POLICY_URLS = ['/local-checkpoints/latest-distilled-policy.json', '/local-checkpoints/latest-hybrid-policy.json'].map((path) => siteUrl(path));

export async function mountPolicyRunnerPage({ requiredElement, readStringQueryParam, commonOptions, previewUi,
  previewRules, previewPhysicsMode, explicitPreviewPhysicsMode, appendEvent, addController, trackSeed }) {
  const SHOWCASE_TRACK_SEED = trackSeed;
  const root = requiredElement('policy-runner-root');
  const status = document.querySelector('[data-policy-runner-status]');
  const readout = document.querySelector('[data-policy-runner-readout]');
  const sensesPanel = document.querySelector('[data-policy-senses]');
  const controllerSelect = document.querySelector('[data-policy-controller-select]');
  const configurationSelect = document.querySelector('[data-policy-configuration-select]');
  const trackProfileSelect = document.querySelector('[data-policy-track-profile-select]');
  const resetButton = document.querySelector('[data-policy-runner-reset]');
  const stepButton = document.querySelector('[data-policy-runner-step]');
  const autoInput = document.querySelector('[data-policy-runner-auto]');
  const policyServerUrlInput = document.querySelector('[data-policy-server-url]');
  const liveNodeUrlInput = document.querySelector('[data-policy-live-url]');
  const liveNodeConnectButton = document.querySelector('[data-policy-live-connect]');
  const liveNodeDisconnectButton = document.querySelector('[data-policy-live-disconnect]');
  const liveNodeStatus = document.querySelector('[data-policy-live-status]');
  const requestedController = readStringQueryParam('controller');
  const requestedServerUrl = readStringQueryParam('serverUrl');
  const requestedLiveUrl = readStringQueryParam('liveUrl');
  const frameCounter = createAdvancedFrameCounter(document.querySelector('[data-policy-frame-counter]'), {
    label: 'Policy loop',
    metrics: [
      { key: 'visualFrame', label: 'Visual frame' },
      { key: 'simStep', label: 'Sim step' },
      { key: 'policyStep', label: 'Policy' },
      { key: 'heldFramesRemaining', label: 'held' },
      { key: 'lastPolicyDecisionMs', label: 'policy', unit: 'ms' },
      { key: 'lastExpertStepMs', label: 'step', unit: 'ms' },
      { key: 'lastRenderMs', label: 'render', unit: 'ms' },
      { key: 'lastAutoFrameGapMs', label: 'raf', unit: 'ms' },
      { key: 'visualFps', label: 'fps', unit: 'fps' },
    ],
  });
  const trainingField = createPolicyRunnerTrainingField(8);
  const controlledDrivers = trainingField.drivers.map((driver) => driver.id);
  const primaryRaceDriver = DEMO_PROJECT_DRIVERS[0].id;
  let activeCheckpointUrl = null;
  let activePayload = null;
  for (const policyUrl of DISTILLED_POLICY_URLS) {
    activePayload = await loadCheckpointPolicyPayload(policyUrl);
    if (activePayload) {
      activeCheckpointUrl = policyUrl;
      break;
    }
  }
  if (requestedController && controllerSelect) {
    const allowedControllers = new Set(['distilled-policy', 'policy-server', 'live-node-view']);
    if (allowedControllers.has(requestedController)) controllerSelect.value = requestedController;
  }
  if (requestedServerUrl && policyServerUrlInput) policyServerUrlInput.value = requestedServerUrl;
  if (requestedLiveUrl && liveNodeUrlInput) liveNodeUrlInput.value = requestedLiveUrl;
  let activeController = null;
  let simulator = null;
  let controllerLoop = null;
  let result = null;
  let liveResult = null;
  let mounting = false;
  const session = createPolicyRunnerSession();
  let heldAction = null;
  let heldFramesRemaining = 0;
  let policyStep = 0;
  let visualFrame = 0;
  let lastPolicyDecisionMs = 0;
  let lastExpertStepMs = 0;
  let lastRenderMs = 0;
  let lastVisualFrameMs = 0;
  let lastAutoFrameGapMs = 0;
  let lastAutoTickAt = 0;
  const policyJsonReadout = createThrottledJsonReadout({ intervalMs: 500 });
  let activeControlledDrivers = [controlledDrivers[0]];
  let activePrimaryDriver = controlledDrivers[0];
  let trainingReplayRuntime = new Map();
  let trainingReplayStats = {
    enabled: false,
    resetCount: 0,
    resetReasons: {},
    lastResetDrivers: [],
  };
  let liveNodeConnectionError = null;
  let liveNodeStatusInfo = null;
  const liveConnection = createLiveNodeConnection({
    getExpert: () => simulator?.expert,
    onStatus: setLiveNodeStatus,
    onChange: updateLiveNodeControls,
    onFrame(frame, rendererState) {
      const sourceChanged = liveResult === null;
      if (frame) liveResult = createLiveResult(frame, rendererState);
      render(heldAction, { force: true, forceReadout: sourceChanged, forceSenses: sourceChanged });
    },
  });

  function activeLiveNodeUrl() { return (liveNodeUrlInput?.value ?? '').trim(); }
  function activePolicyServerUrl() { return policyServerUrlInput?.value?.trim() || 'http://127.0.0.1:8787'; }
  function setLiveNodeStatus({ connected = false, detail = null, error = null } = {}) {
    const clearedFrame = !connected && liveResult !== null;
    if (!connected) liveResult = null;
    liveNodeConnectionError = error ? String(error) : null;
    liveNodeStatusInfo = detail ?? null;
    if (liveNodeStatus) liveNodeStatus.textContent = `Live preview ${[connected ? 'connected' : 'disconnected', detail, error && `error ${error}`].filter(Boolean).join(' · ')}`;
    if (clearedFrame) {
      view.reset(); render(heldAction, { force: true, forceReadout: true, forceSenses: true });
    }
  }
  function currentExternalRendererState() {
    return simulator?.expert?.getExternalRendererState?.() ?? { attached: false, lastMeta: null, lastFrameAt: null, lastError: null };
  }
  function localSteppingBlocked() { return Boolean(currentExternalRendererState().attached); }
  function updateLiveNodeControls() {
    const hasConnection = liveConnection.active;
    if (policyServerUrlInput) policyServerUrlInput.disabled = activeControllerKind() !== 'policy-server';
    if (liveNodeUrlInput) liveNodeUrlInput.disabled = hasConnection;
    if (liveNodeConnectButton) liveNodeConnectButton.disabled = mounting || activeControllerKind() !== 'live-node-view' || hasConnection;
    if (liveNodeDisconnectButton) liveNodeDisconnectButton.disabled = !hasConnection;
    if (resetButton) resetButton.disabled = mounting;
    if (stepButton) stepButton.disabled = mounting || localSteppingBlocked();
    if (autoInput) autoInput.disabled = mounting || localSteppingBlocked();
  }
  function disconnectLiveNode() {
    stop(); liveConnection.disconnect(); liveResult = null;
    view.reset(); render(heldAction, { force: true, forceReadout: true });
  }
  function connectLiveNode() {
    stop();
    if (activeControllerKind() !== 'live-node-view') {
      setLiveNodeStatus({ error: 'Select "Live preview stream" controller first.' });
      return;
    }
    liveConnection.connect(activeLiveNodeUrl());
  }

  const configurationOptions = createPolicyRunnerConfigurations(trainingField, primaryRaceDriver, { previewPhysicsMode, previewRules });
  configurationSelect?.replaceChildren(
    ...configurationOptions.map((option) => new Option(option.label, option.id)),
  );
  trackProfileSelect?.replaceChildren(
    ...Object.entries(POLICY_TRACK_PROFILE_OPTIONS).map(([value, option]) => new Option(option.label, value)),
  );
  activeController = createSelectedController();

  const view = createPolicyRunnerView({ sensesPanel, readout, status, frameCounter, policyJsonReadout,
    getContext: () => ({
      activePrimaryDriver,
      ...policyRunnerPresentation({ live: activeControllerKind() === 'live-node-view', liveResult, result,
        snapshot: simulator?.getSnapshot?.() ?? result?.state?.snapshot ?? null }),
      activeController, activeCheckpointUrl, activePayload, activeControlledDrivers, trainingReplayStats,
      policyStep, visualFrame, heldFramesRemaining, liveNodeStatusInfo, liveNodeConnectionError,
      socketConnected: liveConnection.socketConnected, controllerLoop,
      configuration: getSelectedConfiguration(), trackProfileId: getSelectedTrackProfileId(), trackProfile: getSelectedTrackProfile(),
      controllerKind: activeControllerKind(), controllerMetadata: activeControllerMetadata(), liveUrl: activeLiveNodeUrl(),
      externalRenderer: currentExternalRendererState(), serverUrl: activePolicyServerUrl(),
      physicsMode: selectedPolicyRunnerPhysicsMode(getSelectedConfiguration()), playbackSpeed: activePlaybackSpeed(),
      rayLayout: activeRayLayout(), policyPhysicsMode: activePolicyPhysicsMode(),
      metrics: { simStep: result?.info?.step ?? 0, visualFrame, policyStep, heldFramesRemaining,
        lastPolicyDecisionMs: roundMs(lastPolicyDecisionMs), lastExpertStepMs: roundMs(lastExpertStepMs),
        lastRenderMs: roundMs(lastRenderMs), lastVisualFrameMs: roundMs(lastVisualFrameMs),
        lastAutoFrameGapMs: roundMs(lastAutoFrameGapMs), visualFps: visualFpsFromFrameGap(lastAutoFrameGapMs) },
    }),
  });
  const { render, shouldRenderPolicyDiagnostics } = view;

  function mountSelectedConfiguration() {
    mounting = true;
    stop();
    disconnectLiveNode();
    const pendingMount = session.replace(async ({ isCurrent }) => {
      let allocatedSimulator = null, allocatedLoop = null;
      try {
        root.replaceChildren();
        const selectedConfiguration = getSelectedConfiguration();
        const selectedTrackProfile = getSelectedTrackProfile();
        const policyServerMode = activeControllerKind() === 'policy-server';
        const selectedOptions = compactPolicyServerRuntimeOptions(activeControllerKind(), {
          ...selectedConfiguration.options,
          trackGeneration: selectedTrackProfile.trackGeneration,
          physicsMode: selectedPolicyRunnerPhysicsMode(selectedConfiguration),
          observation: {
            ...(selectedConfiguration.options.observation ?? {}),
            lookaheadMeters: activeLookaheadMeters(),
          },
          sensors: {
            ...(selectedConfiguration.options.sensors ?? {}),
            rays: {
              ...(selectedConfiguration.options.sensors?.rays ?? {}),
              layout: activeRayLayout(),
            },
          },
        });
        controllerLoop = null;
        simulator = null;
        activeControlledDrivers = selectedConfiguration.controlledDrivers;
        activePrimaryDriver = activeControlledDrivers[0];
        initializeTrainingReplayRuntime(selectedConfiguration);
        allocatedSimulator = await mountF1Simulator(root, {
          ...commonOptions('policy-runner'),
          ...selectedOptions,
          preset: 'compact-race',
          title: 'Policy Runner',
          kicker: 'controller.decideBatch(observations) -> actions',
          seed: 71,
          trackSeed: selectedTrackProfile.trackSeed ?? selectedConfiguration.trackSeed ?? SHOWCASE_TRACK_SEED,
          totalLaps: selectedConfiguration.totalLaps ?? 3,
          expert: {
            enabled: true,
            controlledDrivers: activeControlledDrivers,
            frameSkip: 1,
            visualizeSensors: policyServerMode ? false : { rays: true, drivers: 'selected' },
          },
          ui: previewUi({
            raceDataBanners: { initial: 'hidden', enabled: ['project', 'radio'] },
            simulationSpeedControl: true,
          }),
          onDriverSelect(driver) {
            appendEvent('policy-runner:select', driver.code ?? driver.id);
            activePrimaryDriver = activeControlledDrivers.includes(driver.id) ? driver.id : null;
            render(heldAction, { force: true, forceReadout: true });
          },
        });
        if (!isCurrent()) { allocatedSimulator.destroy(); return null; }
        simulator = allocatedSimulator;
        addController('policy-runner', simulator);
        activeController = createSelectedController({
          configuration: policyServerConfigurationPayload(selectedConfiguration, selectedTrackProfile),
        });
        allocatedLoop = controllerLoop = createPaddockDriverControllerLoop({
          runtime: simulator.expert,
          controller: activeController,
          actionRepeat: POLICY_ACTION_HOLD_FRAMES,
          mode: 'browser-policy-runner',
        });
        await resetSession();
        if (!isCurrent()) { allocatedLoop.stop(); allocatedSimulator.destroy(); return null; }
        updateLiveNodeControls();
        return { simulator: allocatedSimulator, loop: allocatedLoop };
      } catch (error) {
        allocatedLoop?.stop();
        allocatedSimulator?.destroy();
        if (isCurrent()) throw error;
        return null;
      }
    });
    const isCurrent = session.capture();
    return pendingMount.finally(() => {
      if (isCurrent()) { mounting = false; updateLiveNodeControls(); }
    });
  }

  function reset() { return session.run(resetSession); }
  async function resetSession() {
    if (localSteppingBlocked()) {
      throw new Error('Cannot reset while external renderer mode is attached. Disconnect live node view first.');
    }
    const isCurrent = session.captureAction();
    const nextResult = await controllerLoop.reset();
    if (!isCurrent()) return;
    result = nextResult;
    initializeTrainingReplayRuntime(getSelectedConfiguration());
    activePrimaryDriver = activeControlledDrivers[0] ?? null;
    if (activePrimaryDriver) simulator.selectDriver(activePrimaryDriver);
    heldAction = null;
    heldFramesRemaining = 0;
    policyStep = 0;
    visualFrame = 0;
    lastPolicyDecisionMs = 0;
    lastExpertStepMs = 0;
    lastRenderMs = 0;
    lastVisualFrameMs = 0;
    lastAutoFrameGapMs = 0;
    lastAutoTickAt = 0;
    view.reset();
    syncControllerLoopStats();
    render(null, { force: true, forceReadout: true });
  }

  function initializeTrainingReplayRuntime(configuration) {
    trainingReplayRuntime = new Map(activeControlledDrivers.map((driverId) => [
      driverId,
      createTrainingReplayDriverRuntime(),
    ]));
    trainingReplayStats = {
      enabled: Boolean(configuration?.trainingBatchReplay),
      resetCount: 0,
      resetReasons: {},
      lastResetDrivers: [],
    };
  }

  function stepVisualFrame() { return session.run(stepSessionFrame); }
  async function stepSessionFrame() {
    if (localSteppingBlocked()) {
      throw new Error('Cannot step while external renderer mode is attached.');
    }
    const frameStartedAt = performance.now();
    const stepStartedAt = performance.now();
    const isCurrent = session.captureAction();
    const nextResult = await stepPolicyRunner(controllerLoop, 'stepFrame', isCurrent);
    if (!nextResult) return false;
    result = nextResult;
    lastExpertStepMs = performance.now() - stepStartedAt;
    syncControllerLoopStats();
    visualFrame += 1;
    await applyTrainingReplayLimits();
    if (!isCurrent()) return false;
    const renderStartedAt = performance.now();
    render(heldAction, { force: shouldRenderPolicyDiagnostics() });
    lastRenderMs = performance.now() - renderStartedAt;
    lastVisualFrameMs = performance.now() - frameStartedAt;
    if (result.done) stop();
  }

  function step() { return session.run(stepSession); }
  async function stepSession() {
    if (localSteppingBlocked()) {
      throw new Error('Cannot step while external renderer mode is attached.');
    }
    const frameStartedAt = performance.now();
    const stepStartedAt = performance.now();
    const isCurrent = session.captureAction();
    const nextResult = await stepPolicyRunner(controllerLoop, 'step', isCurrent);
    if (!nextResult) return false;
    result = nextResult;
    lastExpertStepMs = performance.now() - stepStartedAt;
    syncControllerLoopStats();
    visualFrame = result?.info?.step ?? visualFrame;
    await applyTrainingReplayLimits();
    if (!isCurrent()) return false;
    const renderStartedAt = performance.now();
    render(heldAction, { force: true, forceReadout: true });
    lastRenderMs = performance.now() - renderStartedAt;
    lastVisualFrameMs = performance.now() - frameStartedAt;
    if (result?.done) stop();
  }

  function stop() { playback.stop(); }

  async function applyTrainingReplayLimits() {
    const configuration = getSelectedConfiguration();
    if (!configuration.trainingBatchReplay || !result?.metrics) return;
    const resetPlacements = {};
    const resetDrivers = [];
    activeControlledDrivers.forEach((driverId, index) => {
      const metric = result.metrics[driverId] ?? {};
      const runtime = trainingReplayRuntime.get(driverId) ?? createTrainingReplayDriverRuntime();
      trainingReplayRuntime.set(driverId, runtime);
      updateTrainingReplayRuntime(runtime, metric);
      const reason = trainingReplayResetReason(runtime, metric);
      if (!reason) return;
      runtime.episodeId += 1;
      recordTrainingReplayReset(trainingReplayStats, driverId, reason);
      resetDrivers.push(driverId);
      resetPlacements[driverId] = trainingReplayPlacement(index, runtime, configuration.trainingStage ?? 'basic-track-follow');
      trainingReplayRuntime.set(driverId, createTrainingReplayDriverRuntime(runtime.episodeId));
    });
    if (!resetDrivers.length) return;
    const isCurrent = session.captureAction();
    const nextResult = await controllerLoop.resetDrivers(resetPlacements, {
      observationScope: 'all',
      resetDriversObservationScope: 'all',
      stateOutput: 'minimal',
    });
    if (!isCurrent()) return;
    result = nextResult;
    syncControllerLoopStats();
  }

  const playback = createPolicyRunnerPlayback({
    onRunning(running) {
      autoInput.checked = running;
      if (!running) { lastAutoTickAt = 0; session.cancelActions(); controllerLoop?.stop(); }
      updateLiveNodeControls();
    },
    onError: reportError,
    async step() {
      const isCurrent = session.capture();
      const activeSimulator = simulator;
      const now = performance.now();
      lastAutoFrameGapMs = lastAutoTickAt > 0 ? now - lastAutoTickAt : 0;
      lastAutoTickAt = now;
      const framesThisTick = activePlaybackSpeed();
      try {
        for (let frame = 0; frame < framesThisTick; frame += 1) {
          activeSimulator.expert?.setFrameRenderSuppressed?.(frame < framesThisTick - 1);
          if (await stepVisualFrame() === false || !isCurrent() || result?.done || !autoInput.checked) break;
        }
      } finally { if (isCurrent()) activeSimulator.expert?.setFrameRenderSuppressed?.(false); }
      return isCurrent() && !result?.done && autoInput.checked;
    },
  });
  function startAutoRun() { if (!localSteppingBlocked()) playback.start(); }
  function reportError(error) { if (status) status.textContent = `Policy Runner failed: ${error.message}`; }
  const runAction = (action) => { Promise.resolve().then(action).catch(reportError); };

  function getSelectedConfiguration() {
    return configurationOptions.find((option) => option.id === configurationSelect?.value) ?? configurationOptions[0];
  }

  function getSelectedTrackProfileId() {
    const value = trackProfileSelect?.value ?? 'race';
    return Object.hasOwn(POLICY_TRACK_PROFILE_OPTIONS, value) ? value : 'race';
  }

  function getSelectedTrackProfile() {
    return POLICY_TRACK_PROFILE_OPTIONS[getSelectedTrackProfileId()] ?? POLICY_TRACK_PROFILE_OPTIONS.race;
  }

  function createSelectedController({ configuration = null } = {}) {
    if (activeControllerKind() === 'live-node-view') {
      return createLiveNodeViewController();
    }
    if (activeControllerKind() === 'policy-server') {
      return createPolicyServerController({
        endpoint: activePolicyServerUrl(),
        configuration, signal: session.signal,
      });
    }
    if (activeControllerKind() === 'distilled-policy' && activePayload) {
      return createDistilledPolicyController(activePayload);
    }
    return createIdlePolicyController();
  }

  function policyServerConfigurationPayload(configuration, trackProfile) {
    return {
      id: configuration?.id ?? null,
      label: configuration?.label ?? null,
      controlledDrivers: [...(configuration?.controlledDrivers ?? [])],
      physicsMode: selectedPolicyRunnerPhysicsMode(configuration),
      trackProfile: getSelectedTrackProfileId(),
      trackSeed: trackProfile?.trackSeed ?? configuration?.trackSeed ?? SHOWCASE_TRACK_SEED,
      trackGeneration: trackProfile?.trackGeneration ?? configuration?.options?.trackGeneration ?? {},
      totalLaps: configuration?.totalLaps ?? 3,
      trainingBatchReplay: Boolean(configuration?.trainingBatchReplay),
      trainingStage: configuration?.trainingStage ?? null,
    };
  }

  function activeControllerKind() {
    return controllerSelect?.value ?? 'distilled-policy';
  }

  function activeControllerMetadata() {
    return {
      id: activeController?.id ?? activeControllerKind(),
      label: activeController?.label ?? activeControllerKind(),
      batched: true,
      actionRepeat: POLICY_ACTION_HOLD_FRAMES,
    };
  }

  function syncControllerLoopStats() {
    const stats = controllerLoop?.stats;
    if (!stats) return;
    heldAction = stats.actions;
    heldFramesRemaining = stats.heldFramesRemaining;
    policyStep = stats.policyStep;
    lastPolicyDecisionMs = stats.lastDecisionMs;
  }

  function activePlaybackSpeed() {
    const speed = Number(simulator?.getSimulationSpeed?.());
    return Math.max(1, Math.floor(Number.isFinite(speed) ? speed : 1));
  }

  function activeRayLayout() {
    return activePayload?.model?.rayLayout ?? activePayload?.rayLayout ?? 'driver-front-heavy';
  }

  function activeLookaheadMeters() {
    const value = activePayload?.model?.lookaheadMeters ?? activePayload?.lookaheadMeters;
    return Array.isArray(value) ? value : [];
  }

  function activePolicyPhysicsMode() {
    const value = activePayload?.physicsMode
      ?? activePayload?.metadata?.physicsMode
      ?? activePayload?.model?.physicsMode;
    if (value === 'arcade') return 'arcade';
    if (value === 'advanced') return 'advanced';
    return 'arcade';
  }

  function selectedPolicyRunnerPhysicsMode(configuration) {
    const previewOverride = explicitPreviewPhysicsMode();
    if (previewOverride) return previewOverride;
    if (
      activeControllerKind() === 'distilled-policy'
      || activeControllerKind() === 'policy-server'
      || activeControllerKind() === 'live-node-view'
    ) {
      return activePolicyPhysicsMode();
    }
    return configuration?.options?.physicsMode === 'advanced' ? 'advanced' : 'arcade';
  }

  const eventAbort = new AbortController();
  const eventOptions = { signal: eventAbort.signal };
  for (const control of [controllerSelect, configurationSelect, trackProfileSelect]) {
    control?.addEventListener('change', () => runAction(mountSelectedConfiguration), eventOptions);
  }
  resetButton.addEventListener('click', () => runAction(async () => {
    stop();
    if (localSteppingBlocked()) disconnectLiveNode();
    await reset();
  }), eventOptions);
  stepButton.addEventListener('click', () => runAction(async () => {
    if (localSteppingBlocked()) return;
    stop();
    await step();
  }), eventOptions);
  autoInput.addEventListener('change', () => { if (autoInput.checked) startAutoRun(); else stop(); }, eventOptions);
  liveNodeConnectButton?.addEventListener('click', connectLiveNode, eventOptions);
  liveNodeDisconnectButton?.addEventListener('click', disconnectLiveNode, eventOptions);
  function destroy() {
    eventAbort.abort();
    try { stop(); disconnectLiveNode(); } finally { session.destroy(); }
  }
  window.addEventListener('beforeunload', destroy, { once: true, signal: eventAbort.signal });
  setLiveNodeStatus({ connected: false, detail: null, error: null });
  try {
    await mountSelectedConfiguration();
    if (controllerSelect?.value === 'live-node-view' && activeLiveNodeUrl()) connectLiveNode();
    return { destroy };
  } catch (error) { destroy(); throw error; }
}
