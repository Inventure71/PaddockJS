import { afterEach, describe, expect, test, vi } from 'vitest';
import { createPolicyServerController } from '../../local-preview/src/policyRunner/controllers.js';
import { ENVIRONMENT_METRIC_FIELDS } from '../environment/metrics.js';

function okJson(body) {
  return {
    ok: true,
    json: async () => body,
  };
}

function errorJson(status, body) {
  return {
    ok: false,
    status,
    json: async () => body,
  };
}

function createContext(overrides = {}) {
  return {
    controlledDrivers: ['alpha', 'beta'],
    actionSpec: { controlledDrivers: ['alpha', 'beta'] },
    observationSpec: { version: 1 },
    observation: {
      alpha: { vector: [0.25, 0.5] },
      beta: { vector: [0.75, 1] },
    },
    previousActions: {},
    metrics: {},
    events: [],
    resetDriverIds: [],
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('policy server controller', () => {
  test('sends compact vector-only payloads to POST /policy/decide-batch', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okJson({ ok: true, session: 'session-1' }))
      .mockResolvedValueOnce(okJson({
        ok: true,
        session: 'session-1',
        actions: {
          alpha: { steering: 0.1, throttle: 0.2, brake: 0 },
          beta: { steering: -0.1, throttle: 0.3, brake: 0 },
        },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const controller = createPolicyServerController();
    await controller.decideBatch(createContext({
      observation: {
        alpha: {
          vector: new Float32Array([1.25, Number.NaN, Number.POSITIVE_INFINITY]),
          object: { self: { id: 'alpha' }, rays: [{ distanceMeters: 10 }] },
          schema: [{ name: 'self.speed' }],
        },
        beta: {
          vector: new Float32Array([-2, 4, 8]),
          object: { self: { id: 'beta' }, rays: [{ distanceMeters: 12 }] },
          schema: [{ name: 'self.speed' }],
        },
      },
    }));

    const decidePayload = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(decidePayload).toEqual(expect.objectContaining({
      protocolVersion: 2,
      driverIds: ['alpha', 'beta'],
      vectors: [
        [1.25, 0, 0],
        [-2, 4, 8],
      ],
    }));
    expect(decidePayload.previousActions).toEqual([null, null]);
    expect(decidePayload.metrics).toEqual([null, null]);
    expect(decidePayload).not.toHaveProperty('observations');
    expect(decidePayload).not.toHaveProperty('observationSpec');
    expect(decidePayload).not.toHaveProperty('actionSpec');
    expect(decidePayload).not.toHaveProperty('state');
    expect(decidePayload).not.toHaveProperty('snapshot');
    expect(JSON.stringify(decidePayload)).not.toContain('"object"');
    expect(JSON.stringify(decidePayload)).not.toContain('"schema"');
  });

  test('sends static metadata only on POST /policy/reset', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okJson({ ok: true, session: 'session-1' }))
      .mockResolvedValueOnce(okJson({
        ok: true,
        session: 'session-1',
        actions: {
          alpha: { steering: 0.1, throttle: 0.2, brake: 0 },
          beta: { steering: -0.1, throttle: 0.3, brake: 0 },
        },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const controller = createPolicyServerController();
    await controller.reset(createContext({
      actionSpec: { controlledDrivers: ['alpha', 'beta'], actions: ['steering'] },
      observationSpec: { version: 3, entries: [{ name: 'self.speed' }] },
      configuration: { stage: 'policy-runner' },
    }));
    await controller.decideBatch(createContext());

    const resetPayload = JSON.parse(fetchMock.mock.calls[0][1].body);
    const decidePayload = JSON.parse(fetchMock.mock.calls[1][1].body);

    expect(resetPayload).toEqual(expect.objectContaining({
      protocolVersion: 2,
      driverIds: ['alpha', 'beta'],
      actionSpec: { controlledDrivers: ['alpha', 'beta'], actions: ['steering'] },
      observationSpec: { version: 3, entries: [{ name: 'self.speed' }] },
      previousActionFields: ['steering', 'throttle', 'brake'],
      metricFields: ENVIRONMENT_METRIC_FIELDS,
      configuration: { stage: 'policy-runner' },
    }));
    expect(decidePayload).not.toHaveProperty('actionSpec');
    expect(decidePayload).not.toHaveProperty('observationSpec');
    expect(decidePayload).not.toHaveProperty('configuration');
  });

  test('sends controller-owned configuration on reset when context does not override it', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okJson({ ok: true, session: 'session-1' }));
    vi.stubGlobal('fetch', fetchMock);

    const controller = createPolicyServerController({
      configuration: { id: 'training-grid', physicsMode: 'arcade' },
    });
    await controller.reset(createContext());

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(expect.objectContaining({
      protocolVersion: 2,
      configuration: { id: 'training-grid', physicsMode: 'arcade' },
    }));
  });

  test('uses POST /policy/reset-state for partial driver resets after initialization', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okJson({ ok: true, session: 'session-1' }))
      .mockResolvedValueOnce(okJson({ ok: true, session: 'session-1', resetDrivers: ['alpha'] }));
    vi.stubGlobal('fetch', fetchMock);

    const controller = createPolicyServerController();
    await controller.reset(createContext());
    await controller.reset(createContext({ resetDriverIds: ['alpha'] }));

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:8787/policy/reset',
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:8787/policy/reset-state',
      expect.any(Object),
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      protocolVersion: 2,
      driverIds: ['alpha'],
    });
  });

  test('returns zero actions on the first two consecutive policy-server failures', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okJson({ ok: true, session: 'session-1' }))
      .mockResolvedValueOnce(errorJson(503, { ok: false, error: 'server offline' }))
      .mockResolvedValueOnce(errorJson(503, { ok: false, error: 'server offline' }));
    vi.stubGlobal('fetch', fetchMock);

    const controller = createPolicyServerController();
    const first = await controller.decideBatch(createContext());
    const second = await controller.decideBatch(createContext());

    expect(first).toEqual({
      alpha: { steering: 0, throttle: 0, brake: 0 },
      beta: { steering: 0, throttle: 0, brake: 0 },
    });
    expect(second).toEqual(first);
    expect(controller.debugState.consecutiveErrors).toBe(2);
  });

  test('throws after three consecutive policy-server failures', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okJson({ ok: true, session: 'session-1' }))
      .mockResolvedValueOnce(errorJson(503, { ok: false, error: 'server offline' }))
      .mockResolvedValueOnce(errorJson(503, { ok: false, error: 'server offline' }))
      .mockResolvedValueOnce(errorJson(503, { ok: false, error: 'server offline' }));
    vi.stubGlobal('fetch', fetchMock);

    const controller = createPolicyServerController();

    await controller.decideBatch(createContext());
    await controller.decideBatch(createContext());
    await expect(controller.decideBatch(createContext())).rejects.toThrow(
      'Policy server failed 3 times in a row: server offline',
    );
  });

  test('resets consecutive error count after a successful policy-server response', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okJson({ ok: true, session: 'session-1' }))
      .mockResolvedValueOnce(errorJson(503, { ok: false, error: 'server offline' }))
      .mockResolvedValueOnce(errorJson(503, { ok: false, error: 'server offline' }))
      .mockResolvedValueOnce(okJson({
        ok: true,
        session: 'session-1',
        actions: {
          alpha: { steering: 0.4, throttle: 0.6, brake: 0 },
          beta: { steering: -0.2, throttle: 0.5, brake: 0 },
        },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const controller = createPolicyServerController();

    await controller.decideBatch(createContext());
    await controller.decideBatch(createContext());
    const recovered = await controller.decideBatch(createContext());

    expect(recovered.alpha).toEqual({ steering: 0.4, throttle: 0.6, brake: 0 });
    expect(recovered.beta).toEqual({ steering: -0.2, throttle: 0.5, brake: 0 });
    expect(controller.debugState.consecutiveErrors).toBe(0);
    expect(controller.debugState.connected).toBe(true);
    expect(controller.debugState.error).toBeNull();
  });
});
