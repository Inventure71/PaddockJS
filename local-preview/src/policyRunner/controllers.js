import { createCheckpointPolicy } from './checkpointPolicy.js';

const ZERO_ACTION = Object.freeze({ steering: 0, throttle: 0, brake: 0 });
const POLICY_SERVER_ERROR_THRESHOLD = 3;

export function createDistilledPolicyController(payload) {
  const policy = createCheckpointPolicy(payload);
  return {
    id: 'distilled-policy',
    label: 'Distilled policy',
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

export function createIdlePolicyController() {
  return {
    id: 'distilled-policy',
    label: 'Distilled policy',
    debugState: { loaded: false },
    async decideBatch(context) {
      return Object.fromEntries(context.controlledDrivers.map((driverId) => [driverId, ZERO_ACTION]));
    },
  };
}

export function createPolicyServerController({
  endpoint = 'http://127.0.0.1:8787',
} = {}) {
  let initialized = false;
  const debugState = {
    endpoint,
    connected: false,
    error: null,
    session: null,
    resets: {},
    memoryBin: [],
    consecutiveErrors: 0,
  };

  async function resetServer(context = {}) {
    const payload = await postJson(`${normalizeEndpoint(endpoint)}/policy/reset`, {
      driverIds: context.controlledDrivers ?? [],
      actionSpec: context.actionSpec,
      observationSpec: context.observationSpec,
      configuration: context.configuration ?? null,
    });
    debugState.connected = true;
    debugState.error = null;
    debugState.session = payload.session ?? null;
    debugState.resets = {};
    debugState.memoryBin = [];
    debugState.consecutiveErrors = 0;
    initialized = true;
  }

  async function resetDriverState(driverIds) {
    const payload = await postJson(`${normalizeEndpoint(endpoint)}/policy/reset-state`, { driverIds });
    debugState.connected = true;
    debugState.error = null;
    debugState.session = payload.session ?? debugState.session;
    debugState.resets = {};
    debugState.consecutiveErrors = 0;
  }

  return {
    id: 'policy-server',
    label: 'Policy server',
    get debugState() {
      return debugState;
    },
    async reset(context = {}) {
      const resetIds = context.resetDriverIds ?? [];
      const controlled = context.controlledDrivers ?? [];
      try {
        if (initialized && resetIds.length > 0 && resetIds.length < controlled.length) {
          await resetDriverState(resetIds);
          return;
        }
        await resetServer(context);
      } catch (error) {
        initialized = false;
        debugState.connected = false;
        debugState.error = error instanceof Error ? error.message : String(error);
      }
    },
    async decideBatch(context) {
      try {
        if (!initialized) await resetServer(context);
        const payload = await postJson(`${normalizeEndpoint(endpoint)}/policy/decide-batch`, {
          driverIds: context.controlledDrivers,
          observations: normalizeObservationMap(context.observation),
          previousActions: context.previousActions,
          metrics: context.metrics,
          events: context.events,
          actionSpec: context.actionSpec,
          observationSpec: context.observationSpec,
        });
        debugState.connected = true;
        debugState.error = null;
        debugState.consecutiveErrors = 0;
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
        debugState.consecutiveErrors = Number(debugState.consecutiveErrors || 0) + 1;
        if (debugState.consecutiveErrors >= POLICY_SERVER_ERROR_THRESHOLD) {
          throw new Error(
            `Policy server failed ${debugState.consecutiveErrors} times in a row: ${debugState.error}`,
          );
        }
        return Object.fromEntries(context.controlledDrivers.map((driverId) => [driverId, ZERO_ACTION]));
      }
    },
  };
}

export function createLiveNodeViewController() {
  return {
    id: 'live-node-view',
    label: 'Live preview stream',
    async decideBatch(context) {
      return Object.fromEntries(context.controlledDrivers.map((driverId) => [driverId, ZERO_ACTION]));
    },
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
    throw new Error(body?.error ?? `Policy server request failed: ${response.status}`);
  }
  return body;
}

function normalizeEndpoint(endpoint) {
  return String(endpoint || 'http://127.0.0.1:8787').replace(/\/+$/, '');
}

function normalizeObservationMap(observations) {
  if (!observations || typeof observations !== 'object') return {};
  return Object.fromEntries(Object.entries(observations).map(([driverId, observation]) => [
    driverId,
    normalizeObservation(observation),
  ]));
}

function normalizeObservation(observation) {
  if (!observation || typeof observation !== 'object') return observation;
  const normalized = { ...observation };
  if ('vector' in normalized) normalized.vector = normalizeNumericVector(normalized.vector);
  return normalized;
}

function normalizeNumericVector(vector) {
  if (Array.isArray(vector)) return vector.map(toFiniteNumber);
  if (ArrayBuffer.isView(vector)) return Array.from(vector, toFiniteNumber);
  if (!vector || typeof vector !== 'object') return vector;
  const keys = Object.keys(vector);
  if (!keys.length) return [];
  const numericKeys = keys.filter((key) => /^-?\d+$/.test(key));
  if (numericKeys.length !== keys.length) return vector;
  numericKeys.sort((a, b) => Number(a) - Number(b));
  return numericKeys.map((key) => toFiniteNumber(vector[key]));
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
