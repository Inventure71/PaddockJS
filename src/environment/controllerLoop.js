import { cancelScheduled, defaultScheduler, now } from './controllerScheduler.js';

export function createPaddockDriverControllerLoop({
  runtime,
  controller,
  actionRepeat = 4,
  mode = 'manual',
  scheduler = null,
} = {}) {
  if (!runtime || typeof runtime.step !== 'function' || typeof runtime.reset !== 'function') {
    throw new Error('createPaddockDriverControllerLoop requires a runtime with reset() and step(actions).');
  }
  if (!controller || typeof controller.decideBatch !== 'function') {
    throw new Error('createPaddockDriverControllerLoop requires a controller with decideBatch(context).');
  }

  const repeat = Math.max(1, Math.floor(Number(actionRepeat) || 1));
  let actionSpec = null;
  let observationSpec = null;
  let initialized = false;
  let result = null;
  let previousResult = null;
  let heldActions = null;
  let heldFramesRemaining = 0;
  let policyStep = 0;
  let runtimeStep = 0;
  let observationCache = {};
  let running = false;
  let scheduled = null;
  let previousActions = {};
  let lastDecisionMs = 0;
  let lastError = null;
  let generation = 0;
  let generationController = new AbortController();

  async function ensureSpecs() {
    if (!actionSpec) actionSpec = runtime.getActionSpec();
    if (!observationSpec) observationSpec = runtime.getObservationSpec();
  }

  async function refreshSpecs() {
    actionSpec = runtime.getActionSpec();
    observationSpec = runtime.getObservationSpec();
  }

  async function runControllerHook(name, context) {
    try {
      return await controller[name]?.(context);
    } catch (error) {
      if (context.signal.aborted) return;
      throw error;
    }
  }

  async function ensureInitialized(context) {
    if (initialized) return;
    await runControllerHook('init', context);
    if (!context.signal.aborted) initialized = true;
  }

  async function resetRuntime(options = {}, { stopPlayback = true } = {}) {
    if (stopPlayback) stop();
    const resetGeneration = generation;
    result = runtime.reset(options);
    previousResult = null;
    heldActions = null;
    heldFramesRemaining = 0;
    policyStep = 0;
    runtimeStep = Number(result?.info?.step ?? 0);
    observationCache = { ...(result?.observation ?? {}) };
    previousActions = {};
    lastError = null;
    await refreshSpecs();
    if (generation !== resetGeneration) return result;
    const context = buildContext({ resetDriverIds: controlledDrivers() });
    await ensureInitialized(context);
    if (generation !== resetGeneration) return result;
    await runControllerHook('reset', context);
    return result;
  }

  async function reset(options = {}) {
    return resetRuntime(options, { stopPlayback: true });
  }

  async function ensureResult() {
    if (!result) await resetRuntime({}, { stopPlayback: false });
  }

  async function resetDrivers(placements = {}, resultOptions = {}) {
    if (typeof runtime.resetDrivers !== 'function') {
      throw new Error('The supplied Paddock runtime does not support resetDrivers().');
    }
    const resumePlayback = running;
    stop();
    const resetGeneration = generation;
    const resetDriverIds = Object.keys(placements);
    previousResult = result;
    result = runtime.resetDrivers(placements, resultOptions);
    observationCache = {
      ...observationCache,
      ...(result?.observation ?? {}),
    };
    heldActions = null;
    heldFramesRemaining = 0;
    lastError = null;
    resetDriverIds.forEach((driverId) => {
      delete previousActions[driverId];
    });
    await ensureSpecs();
    if (generation !== resetGeneration) return result;
    const context = buildContext({ resetDriverIds });
    await ensureInitialized(context);
    if (generation !== resetGeneration) return result;
    await runControllerHook('reset', context);
    if (resumePlayback && generation === resetGeneration) start();
    return result;
  }

  async function beginDecision(expectedGeneration) {
    await ensureResult();
    if (generation !== expectedGeneration) return false;
    const context = buildContext();
    await ensureInitialized(context);
    if (generation !== expectedGeneration) return false;
    const startedAt = now();
    const actions = await runControllerHook('decideBatch', context);
    if (generation !== expectedGeneration) return false;
    lastDecisionMs = now() - startedAt;
    heldActions = actions && typeof actions === 'object' ? actions : {};
    heldFramesRemaining = repeat;
    policyStep += 1;
    return true;
  }

  async function stepFrame(expectedGeneration = generation) {
    await ensureResult();
    if (generation !== expectedGeneration) return result;
    if (!heldActions || heldFramesRemaining <= 0) {
      const decisionReady = await beginDecision(expectedGeneration);
      if (!decisionReady) return result;
    }
    if (generation !== expectedGeneration) return result;
    const actionIndex = repeat - heldFramesRemaining;
    const actions = heldActions;
    const previousActionsForStep = previousActions;
    previousResult = result;
    result = runtime.step(actions);
    observationCache = { ...(result?.observation ?? {}) };
    heldFramesRemaining -= 1;
    runtimeStep = Number(result?.info?.step ?? runtimeStep + 1);
    previousActions = actions;
    if (generation !== expectedGeneration) return result;
    await runControllerHook('onStep', buildContext({
      actionIndex,
      actions,
      previousActions: previousActionsForStep,
      previousResult,
    }));
    return result;
  }

  async function step() {
    let latest = result;
    const targetPolicyStep = policyStep + 1;
    const expectedGeneration = generation;
    while (policyStep < targetPolicyStep || heldFramesRemaining > 0) {
      latest = await stepFrame(expectedGeneration);
      if (generation !== expectedGeneration) break;
      if (latest?.done) break;
      if (policyStep >= targetPolicyStep && heldFramesRemaining <= 0) break;
    }
    return latest;
  }

  function start() {
    if (running) return;
    lastError = null;
    running = true;
    const expectedGeneration = generation;
    const schedule = scheduler ?? defaultScheduler();
    const tick = async () => {
      if (!running || generation !== expectedGeneration) return;
      scheduled = null;
      try {
        await stepFrame(expectedGeneration);
      } catch (error) {
        if (generation !== expectedGeneration) return;
        lastError = error;
        running = false;
        scheduled = null;
        return;
      }
      if (generation !== expectedGeneration) return;
      if (!running || result?.done) {
        running = false;
        return;
      }
      scheduled = schedule(tick);
    };
    scheduled = schedule(tick);
  }

  function stop() {
    const previousController = generationController;
    const previousSchedule = scheduled;
    running = false;
    generation += 1;
    generationController = new AbortController();
    scheduled = null;
    try {
      cancelScheduled(previousSchedule);
    } finally {
      previousController.abort();
    }
  }

  function controlledDrivers() {
    return actionSpec?.controlledDrivers ?? result?.info?.controlledDrivers ?? [];
  }

  function buildContext(extra = {}) {
    const drivers = controlledDrivers();
    const observation = {
      ...observationCache,
      ...(result?.observation ?? runtime.getObservation?.() ?? {}),
    };
    return {
      runtime,
      signal: generationController.signal,
      mode,
      actionRepeat: repeat,
      controlledDrivers: drivers,
      actionSpec,
      observationSpec,
      result,
      previousResult: extra.previousResult ?? previousResult,
      observation,
      orderedObservations: drivers.map((driverId, index) => ({
        driverId,
        index,
        observation: observation?.[driverId] ?? null,
        vector: observation?.[driverId]?.vector ?? null,
      })),
      metrics: result?.metrics ?? {},
      events: result?.events ?? [],
      info: result?.info ?? null,
      previousActions: extra.previousActions ?? previousActions,
      orderedPreviousActions: drivers.map((driverId) => (extra.previousActions ?? previousActions)?.[driverId] ?? null),
      actions: extra.actions ?? heldActions,
      policyStep,
      runtimeStep,
      heldFramesRemaining,
      actionIndex: extra.actionIndex ?? 0,
      resetDriverIds: extra.resetDriverIds ?? [],
    };
  }

  return {
    reset,
    resetDrivers,
    step,
    stepFrame,
    start,
    stop,
    get result() {
      return result;
    },
    get actionSpec() {
      return actionSpec;
    },
    get observationSpec() {
      return observationSpec;
    },
    get stats() {
      return {
        policyStep,
        runtimeStep,
        heldFramesRemaining,
        actions: heldActions,
        actionRepeat: repeat,
        lastDecisionMs,
        running,
        lastError,
      };
    },
  };
}
