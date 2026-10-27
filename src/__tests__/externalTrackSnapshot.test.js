import { expect, test, vi } from 'vitest';
import { createExternalTrackSnapshotDecoder } from '../app/ExternalTrackSnapshot.js';
import { createBrowserExpertExternalRendererBridge } from '../app/BrowserExpertExternalRenderer.js';
import { buildTrackModel, nearestTrackState, pointAt } from '../simulation/track/trackModel.js';

const model = buildTrackModel();
const wireSnapshot = () => JSON.parse(JSON.stringify({ track: model, cars: [{ id: 'remote' }], time: 1 }));

test('JSON track samples and omitted pit bounds become queryable without changing supplied geometry', () => {
  const decoder = createExternalTrackSnapshotDecoder();
  const wire = wireSnapshot();
  const before = JSON.stringify(wire);
  const decoded = decoder.decode(wire);
  const expected = Object.fromEntries(wire.track.sampleSchema.map((field, index) => [field, wire.track.samples[1][index]]));
  expect(decoded.track.samples[1]).toEqual(expected);
  expect(decoded.track.pitLane.bounds.minX).toEqual(expect.any(Number));
  expect(decoded.track.pitLane.connectorBounds.entry.minX).toEqual(expect.any(Number));
  const position = pointAt(decoded.track, 100);
  expect(Number.isFinite(position.x)).toBe(true);
  expect(Number.isFinite(nearestTrackState(decoded.track, position).distance)).toBe(true);
  expect(Object.keys(decoded.track)).not.toContain('queryIndex');
  expect(JSON.stringify(wire)).toBe(before);
  expect(wire.track.queryIndex).toBeUndefined();
});

test('repeated transport geometry reuses display infrastructure and interior geometry changes invalidate it', () => {
  const decoder = createExternalTrackSnapshotDecoder();
  const first = decoder.decode(wireSnapshot());
  const next = wireSnapshot(); next.time = 2;
  expect(decoder.decode(next)).toMatchObject({ time: 2 });
  expect(decoder.decode(next).track).toBe(first.track);
  next.track.samples[10][0] += 1;
  expect(decoder.decode(next).track).not.toBe(first.track);
  decoder.reset();
  expect(decoder.decode(wireSnapshot()).track).not.toBe(first.track);
});

test('legacy object samples and already indexed tracks retain their contracts', () => {
  const decoder = createExternalTrackSnapshotDecoder();
  const rich = { track: { ...model } }; // Spread intentionally drops its non-enumerable index.
  expect(decoder.decode(rich).track.samples).toEqual(model.samples);
  expect(rich.track.queryIndex).toBeUndefined();
  const local = { track: model };
  expect(decoder.decode(local)).toBe(local);
});

test('a malformed geometry packet reports an error and the next valid packet recovers', () => {
  let deliver;
  const rendered = [];
  const bridge = createBrowserExpertExternalRendererBridge({ drivers: [{ id: 'local' }],
    renderExpertFrame(snapshot, options) { rendered.push({ snapshot, options }); } });
  bridge.attach({ subscribe(handler) { deliver = handler; return () => {}; } });
  const bad = wireSnapshot(); bad.track.samples[0][0] = null;
  deliver({ snapshot: bad });
  expect(bridge.getState().lastError).toContain('finite sample geometry');
  const observation = { object: { self: { speedKph: 123 } } };
  deliver({ snapshot: wireSnapshot(), observation: { remote: observation } });
  expect(bridge.getState().lastError).toBeNull();
  expect(rendered).toHaveLength(1);
  expect(rendered[0].snapshot.cars[0].id).toBe('local');
  expect(rendered[0].snapshot.track.queryIndex).toBeDefined();
  expect(rendered[0].options.observation.local).toBe(observation);
  bridge.detach();
});

function surfaceApp() {
  return { drivers: [{ id: 'local' }], renderExpertFrame: vi.fn(), renderTrack: vi.fn(),
    trackAsset: { render: vi.fn() }, drsLayer: { removeChildren: () => [], addChild: vi.fn() },
    sensorLayer: { clear: vi.fn() }, pitLaneStatusLayer: { clear: vi.fn() },
    cameraController: { invalidateTrackCaches: vi.fn() } };
}

test('bridge redraws interior and pit geometry changes while reusing unchanged transport geometry', () => {
  const app = surfaceApp();
  const bridge = createBrowserExpertExternalRendererBridge(app);
  let deliver;
  bridge.attach({ subscribe(handler) { deliver = handler; return () => {}; } });
  const snapshot = wireSnapshot(); snapshot.track.drsZones = [];
  deliver({ snapshot });
  deliver({ snapshot: structuredClone(snapshot) });
  expect(app.trackAsset.render).toHaveBeenCalledTimes(1);
  snapshot.track.samples[10][0] += 1;
  deliver({ snapshot });
  expect(app.trackAsset.render.mock.calls.at(-1)[0].samples[10].x).toBe(snapshot.track.samples[10][0]);
  snapshot.track.pitLane.mainLane.points[0].x += 1;
  deliver({ snapshot });
  expect(app.trackAsset.render.mock.calls.at(-1)[0].pitLane.mainLane.points[0].x).toBe(snapshot.track.pitLane.mainLane.points[0].x);
  expect(app.trackAsset.render).toHaveBeenCalledTimes(3);
  expect(app.cameraController.invalidateTrackCaches).toHaveBeenCalledTimes(3);
  bridge.detach();
});

test('detach restores the local surface after a first external draw fails midway', () => {
  const app = surfaceApp();
  app.trackAsset.render.mockImplementationOnce(() => { throw new Error('Draw failed'); });
  const bridge = createBrowserExpertExternalRendererBridge(app);
  let deliver;
  bridge.attach({ subscribe(handler) { deliver = handler; return () => {}; } });
  deliver({ snapshot: wireSnapshot() });
  expect(app.sensorLayer.clear).toHaveBeenCalledOnce();
  expect(bridge.getState().lastError).toBe('Draw failed');
  bridge.detach();
  expect(app.renderTrack).toHaveBeenCalledOnce();
});
