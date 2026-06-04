import { createCheckpointPolicy } from './checkpointPolicy.js';
import { ENVIRONMENT_METRIC_FIELDS } from '../../../src/environment/metrics.js';

const ZERO_ACTION = Object.freeze({ steering: 0, throttle: 0, brake: 0 });
const POLICY_SERVER_ERROR_THRESHOLD = 3;
export const POLICY_SERVER_PROTOCOL_VERSION = 2;
export const POLICY_SERVER_PREVIOUS_ACTION_FIELDS = Object.freeze(['steering', 'throttle', 'brake']);

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
  configuration = null,
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
    const payload = await postJson(
      `${normalizeEndpoint(endpoint)}/policy/reset`,
      buildPolicyServerResetPayload({
        ...context,
        configuration: context.configuration ?? configuration,
      }),
    );
    debugState.connected = true;
    debugState.error = null;
    debugState.session = payload.session ?? null;
    debugState.resets = {};
    debugState.memoryBin = [];
    debugState.consecutiveErrors = 0;
    initialized = true;
  }

  async function resetDriverState(driverIds) {
    const payload = await postJson(`${normalizeEndpoint(endpoint)}/policy/reset-state`, {
      protocolVersion: POLICY_SERVER_PROTOCOL_VERSION,
      driverIds,
    });
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
        const payload = await postJson(
          `${normalizeEndpoint(endpoint)}/policy/decide-batch`,
          buildPolicyServerDecidePayload(context),
        );
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

export function buildPolicyServerResetPayload(context = {}) {
  return {
    protocolVersion: POLICY_SERVER_PROTOCOL_VERSION,
    driverIds: context.controlledDrivers ?? [],
    actionSpec: context.actionSpec,
    observationSpec: context.observationSpec,
    previousActionFields: POLICY_SERVER_PREVIOUS_ACTION_FIELDS,
    metricFields: ENVIRONMENT_METRIC_FIELDS,
    configuration: context.configuration ?? null,
  };
}

export function buildPolicyServerDecidePayload(context = {}) {
  const driverIds = context.controlledDrivers ?? [];
  return {
    protocolVersion: POLICY_SERVER_PROTOCOL_VERSION,
    driverIds,
    vectors: normalizeObservationVectors(context.observation, driverIds),
    previousActions: normalizePreviousActions(context.previousActions, driverIds),
    metrics: normalizePerDriverValues(context.metrics, driverIds),
    events: context.events ?? [],
  };
}

function normalizeEndpoint(endpoint) {
  return String(endpoint || 'http://127.0.0.1:8787').replace(/\/+$/, '');
}

export function normalizeObservationVectors(observations, driverIds = null) {
  if (!observations || typeof observations !== 'object') return [];
  const ids = Array.isArray(driverIds) && driverIds.length ? driverIds : Object.keys(observations);
  return ids.map((driverId) => normalizeNumericVector(observations[driverId]?.vector ?? []));
}

function normalizePreviousActions(previousActions, driverIds = []) {
  if (!previousActions || typeof previousActions !== 'object') return [];
  return driverIds.map((driverId) => normalizeActionTuple(previousActions[driverId]));
}

function normalizePerDriverValues(values, driverIds = []) {
  if (!values || typeof values !== 'object') return [];
  return driverIds.map((driverId) => normalizeMetricTuple(values[driverId]));
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

function normalizeActionTuple(action) {
  if (!action || typeof action !== 'object') return null;
  return [
    toFiniteNumber(action.steering),
    toFiniteNumber(action.throttle),
    toFiniteNumber(action.brake),
  ];
}

function normalizeMetricTuple(metrics) {
  if (!metrics || typeof metrics !== 'object') return null;
  return ENVIRONMENT_METRIC_FIELDS.map((field) => encodeCompactMetricValue(metrics[field]));
}

function encodeCompactMetricValue(value) {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  return value;
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
