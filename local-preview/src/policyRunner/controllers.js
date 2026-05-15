import { createCheckpointPolicy } from './checkpointPolicy.js';

const ZERO_ACTION = Object.freeze({ steering: 0, throttle: 0, brake: 0 });

export function createHeuristicController() {
  return {
    id: 'heuristic',
    label: 'Heuristic baseline',
    async decideBatch(context) {
      return Object.fromEntries(context.controlledDrivers.map((driverId) => {
        const observation = context.observation?.[driverId];
        return [driverId, observation ? decideHeuristicAction(observation) : ZERO_ACTION];
      }));
    },
  };
}

export function createHybridCheckpointController(payload) {
  const policy = createCheckpointPolicy(payload);
  return {
    id: 'hybrid-checkpoint',
    label: 'Hybrid checkpoint',
    payload,
    get debugState() {
      return policy.debugState;
    },
    debugStateFor(driverId) {
      return policy.debugStateFor?.(driverId);
    },
    reset(context = {}) {
      if (context.resetDriverIds?.length) {
        context.resetDriverIds.forEach((driverId) => policy.resetState?.(driverId));
        return;
      }
      policy.resetState?.();
    },
    async decideBatch(context) {
      return Object.fromEntries(context.controlledDrivers.map((driverId) => {
        const observation = context.observation?.[driverId];
        return [driverId, observation ? policy.predict(observation, driverId) : ZERO_ACTION];
      }));
    },
  };
}

export function createLabRemoteController({
  endpoint = 'http://127.0.0.1:8787',
  checkpoint = 'checkpoints/arcade-master-solo/heuristic-full-lap-imitation/self-learning-latest.pt',
  stage = 'basic-track-follow',
  seed = 71,
  maxSteps = 16836,
  frameSkip = 4,
} = {}) {
  let initialized = false;
  const debugState = {
    endpoint,
    connected: false,
    error: null,
    session: null,
    resets: {},
    memoryBin: [],
  };

  async function resetServer(context = {}) {
    const payload = await postJson(`${endpoint}/reset`, {
      checkpoint,
      stage,
      seed,
      maxSteps,
      frameSkip,
      driverIds: context.controlledDrivers ?? [],
      observationSpec: context.observationSpec,
    });
    debugState.connected = true;
    debugState.error = null;
    debugState.session = payload.session ?? null;
    debugState.resets = {};
    debugState.memoryBin = [];
    initialized = true;
  }

  async function resetDriverState(driverIds) {
    const payload = await postJson(`${endpoint}/reset-state`, { driverIds });
    debugState.connected = true;
    debugState.error = null;
    debugState.session = payload.session ?? debugState.session;
    debugState.resets = {};
  }

  return {
    id: 'lab-remote',
    label: 'Lab remote server',
    get debugState() {
      return debugState;
    },
    async reset(context = {}) {
      const resetIds = context.resetDriverIds ?? [];
      const controlled = context.controlledDrivers ?? [];
      if (initialized && resetIds.length > 0 && resetIds.length < controlled.length) {
        await resetDriverState(resetIds);
        return;
      }
      await resetServer(context);
    },
    async decideBatch(context) {
      if (!initialized) await resetServer(context);
      try {
        const payload = await postJson(`${endpoint}/predict`, {
          driverIds: context.controlledDrivers,
          observations: context.observation,
          previousActions: context.previousActions,
          metrics: context.metrics,
          events: context.events,
          actionSpec: context.actionSpec,
          observationSpec: context.observationSpec,
        });
        debugState.connected = true;
        debugState.error = null;
        debugState.session = payload.session ?? debugState.session;
        debugState.resets = payload.resetReasons ?? {};
        debugState.memoryBin = payload.memoryBin ?? [];
        return Object.fromEntries(context.controlledDrivers.map((driverId) => [
          driverId,
          payload.actions?.[driverId] ?? ZERO_ACTION,
        ]));
      } catch (error) {
        debugState.connected = false;
        debugState.error = error instanceof Error ? error.message : String(error);
        return Object.fromEntries(context.controlledDrivers.map((driverId) => [driverId, ZERO_ACTION]));
      }
    },
  };
}

export function createLiveNodeViewController() {
  return {
    id: 'live-node-view',
    label: 'Live node view',
    async decideBatch(context) {
      return Object.fromEntries(context.controlledDrivers.map((driverId) => [driverId, ZERO_ACTION]));
    },
  };
}

function decideHeuristicAction(observation) {
  const self = observation.object?.self;
  if (!self) return ZERO_ACTION;
  const rays = observation.object?.rays ?? [];
  const frontRay = rays.find((ray) => ray.angleDegrees === 0);
  const leftRay = rays.find((ray) => ray.angleDegrees === -60);
  const rightRay = rays.find((ray) => ray.angleDegrees === 60);
  const frontDistance = frontRay?.track?.distanceMeters ?? frontRay?.roadEdge?.distanceMeters ?? 120;
  const leftDistance = leftRay?.track?.distanceMeters ?? leftRay?.roadEdge?.distanceMeters ?? 120;
  const rightDistance = rightRay?.track?.distanceMeters ?? rightRay?.roadEdge?.distanceMeters ?? 120;
  const rayBalance = rightDistance - leftDistance;
  return {
    steering: clamp(-Number(self.trackHeadingErrorRadians ?? 0) * 1.4 - Number(self.trackOffsetMeters ?? 0) * 0.08 + rayBalance * 0.004, -1, 1),
    throttle: clamp(0.72 - Math.max(0, 35 - frontDistance) / 80, 0, 1),
    brake: clamp(Math.max(0, 28 - frontDistance) / 60, 0, 1),
  };
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok === false) {
    throw new Error(body?.error ?? `Lab server request failed: ${response.status}`);
  }
  return body;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));
}
