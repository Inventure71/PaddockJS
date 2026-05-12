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
  let running = false;
  let scheduled = null;
  let previousActions = {};
  let lastDecisionMs = 0;

  async function ensureSpecs() {
    if (!actionSpec) actionSpec = runtime.getActionSpec();
    if (!observationSpec) observationSpec = runtime.getObservationSpec();
  }

  async function ensureInitialized(context) {
    if (initialized) return;
    await controller.init?.(context);
    initialized = true;
  }

  async function reset(options = {}) {
    stop();
    result = runtime.reset(options);
    previousResult = null;
    heldActions = null;
    heldFramesRemaining = 0;
    policyStep = 0;
    runtimeStep = Number(result?.info?.step ?? 0);
    previousActions = {};
    await ensureSpecs();
    const context = buildContext({ resetDriverIds: controlledDrivers() });
    await ensureInitialized(context);
    await controller.reset?.(context);
    return result;
  }

  async function resetDrivers(placements = {}, resultOptions = {}) {
    if (typeof runtime.resetDrivers !== 'function') {
      throw new Error('The supplied Paddock runtime does not support resetDrivers().');
    }
    const resetDriverIds = Object.keys(placements);
    previousResult = result;
    result = runtime.resetDrivers(placements, resultOptions);
    heldActions = null;
    heldFramesRemaining = 0;
    resetDriverIds.forEach((driverId) => {
      delete previousActions[driverId];
    });
    await ensureSpecs();
    const context = buildContext({ resetDriverIds });
    await ensureInitialized(context);
    await controller.reset?.(context);
    return result;
  }

  async function beginDecision() {
    if (!result) await reset();
    const context = buildContext();
    await ensureInitialized(context);
    const startedAt = now();
    const actions = await controller.decideBatch(context);
    lastDecisionMs = now() - startedAt;
    heldActions = actions && typeof actions === 'object' ? actions : {};
    heldFramesRemaining = repeat;
    policyStep += 1;
    previousActions = heldActions;
  }

  async function stepFrame() {
    if (!result) await reset();
    if (!heldActions || heldFramesRemaining <= 0) {
      await beginDecision();
    }
    const actionIndex = repeat - heldFramesRemaining;
    previousResult = result;
    result = runtime.step(heldActions);
    heldFramesRemaining -= 1;
    runtimeStep = Number(result?.info?.step ?? runtimeStep + 1);
    await controller.onStep?.(buildContext({
      actionIndex,
      actions: heldActions,
      previousResult,
    }));
    return result;
  }

  async function step() {
    let latest = result;
    const targetPolicyStep = policyStep + 1;
    while (policyStep < targetPolicyStep || heldFramesRemaining > 0) {
      latest = await stepFrame();
      if (latest?.done) break;
      if (policyStep >= targetPolicyStep && heldFramesRemaining <= 0) break;
    }
    return latest;
  }

  function start() {
    if (running) return;
    running = true;
    const schedule = scheduler ?? defaultScheduler();
    const tick = async () => {
      if (!running) return;
      await stepFrame();
      if (!running || result?.done) {
        running = false;
        return;
      }
      scheduled = schedule(tick);
    };
    scheduled = schedule(tick);
  }

  function stop() {
    running = false;
    if (scheduled && typeof scheduled.cancel === 'function') scheduled.cancel();
    else if (typeof scheduled === 'number' && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(scheduled);
    scheduled = null;
  }

  function controlledDrivers() {
    return actionSpec?.controlledDrivers ?? result?.info?.controlledDrivers ?? [];
  }

  function buildContext(extra = {}) {
    const drivers = controlledDrivers();
    const observation = result?.observation ?? runtime.getObservation?.() ?? {};
    return {
      runtime,
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
      previousActions,
      orderedPreviousActions: drivers.map((driverId) => previousActions?.[driverId] ?? null),
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
      };
    },
  };
}

function now() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function defaultScheduler() {
  if (typeof requestAnimationFrame === 'function') {
    return (callback) => requestAnimationFrame(callback);
  }
  return (callback) => {
    const id = setTimeout(callback, 0);
    return { cancel: () => clearTimeout(id) };
  };
}
