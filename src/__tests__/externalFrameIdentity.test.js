import { expect, test, vi } from 'vitest';
import { createBrowserExpertExternalRendererBridge } from '../app/BrowserExpertExternalRenderer.js';

test('unknown external cars cannot steal an exact local identity and event driver IDs follow the mapped car', () => {
  const app = { drivers: [{ id: 'alpha' }, { id: 'beta' }], renderExpertFrame: vi.fn() };
  const bridge = createBrowserExpertExternalRendererBridge(app);
  let deliver;
  bridge.attach({ subscribe(handler) { deliver = handler; return () => {}; } });
  deliver({ snapshot: { cars: [{ id: 'remote' }, { id: 'alpha' }],
    events: [{ type: 'penalty-served', driverId: 'remote', carId: 'remote' }] },
    observation: { remote: { vector: [1, 2] }, alpha: { vector: [3, 4] } } });
  const [snapshot, options] = app.renderExpertFrame.mock.calls.at(-1);
  expect(snapshot.cars.map((car) => car.id)).toEqual(['beta', 'alpha']);
  expect(snapshot.events[0]).toMatchObject({ driverId: 'beta', carId: 'beta' });
  expect(options.observation.beta.vector).toEqual([1, 2]);
  expect(options.observation.alpha.vector).toEqual([3, 4]);
  bridge.detach();
});

test('detached/replaced sources cannot render queued packets, restore old tracks or overwrite metadata', () => {
  const app = { drivers: [{ id: 'alpha' }], renderExpertFrame: vi.fn(), renderTrack: vi.fn(),
    trackAsset: { render: vi.fn() }, drsLayer: { removeChildren: () => [] }, sensorLayer: { clear: vi.fn() },
    pitLaneStatusLayer: { clear: vi.fn() } };
  const bridge = createBrowserExpertExternalRendererBridge(app);
  const frame = (step) => ({ snapshot: { cars: [{ id: 'alpha' }], track: { name: `Track ${step}`, drsZones: [] } }, meta: { step } });
  let oldPacket;
  bridge.attach({ subscribe(handler) { oldPacket = handler; return () => oldPacket(frame(99)); } });
  oldPacket(frame(1));
  bridge.detach();
  const detached = bridge.getState();
  oldPacket(frame(2));
  expect(bridge.getState()).toEqual(detached);
  expect(app.renderExpertFrame).toHaveBeenCalledTimes(1);
  expect(app.trackAsset.render).toHaveBeenCalledTimes(1);
  expect(app.renderTrack).toHaveBeenCalledOnce();
  let currentPacket;
  bridge.attach({ subscribe(handler) { currentPacket = handler; return () => {}; } });
  currentPacket(frame(3));
  const current = bridge.getState();
  oldPacket(frame(4)); oldPacket(null);
  expect(bridge.getState()).toEqual(current);
  expect(app.renderExpertFrame).toHaveBeenCalledTimes(2);
  expect(app.trackAsset.render).toHaveBeenCalledTimes(2);
  expect(current.lastMeta.step).toBe(3);
});

test('an initial synchronous subscription frame is accepted but reentrant detach prevents its metadata commit', () => {
  const app = { drivers: [{ id: 'alpha' }], renderExpertFrame: vi.fn() };
  const bridge = createBrowserExpertExternalRendererBridge(app);
  bridge.attach({ subscribe(deliver) { deliver({ snapshot: { cars: [{ id: 'alpha' }] }, meta: { step: 1 } }); return () => {}; } });
  expect(app.renderExpertFrame).toHaveBeenCalledOnce();
  expect(bridge.getState()).toMatchObject({ attached: true, lastMeta: { step: 1 } });
  app.renderExpertFrame.mockImplementation(() => bridge.detach());
  const unsubscribe = vi.fn();
  bridge.attach({ subscribe(deliver) { deliver({ snapshot: { cars: [{ id: 'alpha' }] }, meta: { step: 2 } }); return unsubscribe; } });
  expect(bridge.getState()).toMatchObject({ attached: false, lastMeta: { step: 1 } });
  expect(unsubscribe).toHaveBeenCalledOnce();
});
