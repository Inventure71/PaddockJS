import { afterEach, expect, test, vi } from 'vitest';
import { createBrowserExpertExternalRendererBridge } from '../app/BrowserExpertExternalRenderer.js';
import { createLiveNodeConnection } from '../../site/src/showcase/policyRunner/liveConnection.js';
import { createLiveResult, policyRunnerPresentation } from '../../site/src/showcase/policyRunner/liveResult.js';
import { createPolicyRunnerView } from '../../site/src/showcase/policyRunner/view.js';
import { createThrottledJsonReadout } from '../../site/src/showcase/debugJsonReadout.js';

class Socket extends EventTarget {
  close = vi.fn();
  emit(type, payload) { const event = new Event(type); if (payload) event.data = JSON.stringify(payload); this.dispatchEvent(event); }
}
afterEach(() => vi.unstubAllGlobals());

test('live senses/readout use the bridge-mapped packet observation, and socket close clears them immediately', () => {
  const createElement = (tag) => ({ tag, textContent: '', children: [], append(...nodes) { this.children.push(...nodes); }, replaceChildren(...nodes) { this.children = nodes; } });
  vi.stubGlobal('document', { createElement });
  let clock = 0;
  vi.stubGlobal('performance', { now: () => clock });
  const sensesPanel = createElement('main'), readout = { textContent: '' };
  const text = (node) => [node.textContent, ...node.children.flatMap(text)].join(' ');
  const local = { observation: { alpha: { object: { self: { speedKph: 15 }, rays: [] } } }, info: { step: 1 } };
  let liveResult = null, live = false;
  const app = { drivers: [{ id: 'alpha' }], renderExpertFrame: vi.fn() };
  const bridge = createBrowserExpertExternalRendererBridge(app);
  const expert = { attachExternalRenderer: bridge.attach, detachExternalRenderer: bridge.detach, getExternalRendererState: bridge.getState };
  const view = createPolicyRunnerView({ sensesPanel, readout, status: null, frameCounter: { update() {} },
    policyJsonReadout: createThrottledJsonReadout({ now: () => clock }),
    getContext: () => ({ ...policyRunnerPresentation({ live, liveResult, result: local, snapshot: {} }),
      activePrimaryDriver: 'alpha', activeController: {}, activeControlledDrivers: ['alpha'], configuration: { id: 'test' },
      trackProfile: {}, controllerKind: live ? 'live-node-view' : 'distilled-policy', externalRenderer: bridge.getState(),
      metrics: {}, physicsMode: 'arcade', activePayload: null }),
  });
  view.render(null, { force: true, forceReadout: true, forceSenses: true });
  expect(text(sensesPanel)).toContain('15.0 kph');
  const socket = new Socket();
  const connection = createLiveNodeConnection({ getExpert: () => expert, createSocket: () => socket,
    onStatus({ connected }) {
      const changed = !connected && liveResult !== null;
      if (!connected) liveResult = null;
      if (changed) { view.reset(); view.render(null, { force: true, forceReadout: true, forceSenses: true }); }
    },
    onFrame(frame, state) {
      const sourceChanged = liveResult === null;
      if (frame) liveResult = createLiveResult(frame, state);
      view.render(null, { force: true, forceReadout: sourceChanged, forceSenses: sourceChanged });
    },
  });
  live = true;
  connection.connect('ws://test/stream'); socket.emit('open');
  // The first external observation arrives inside both local readout throttles.
  clock = 1;
  socket.emit('message', { snapshot: { cars: [{ id: 'remote-agent', speedKph: 10 }] },
    observation: { 'remote-agent': { object: { self: { speedKph: 123.456, throttle: 0.63 }, rays: [] } } }, meta: { step: 77 } });
  expect(text(sensesPanel)).toContain('123 kph');
  expect(text(sensesPanel)).not.toContain('15.0 kph');
  expect(JSON.parse(readout.textContent)).toMatchObject({ step: 77, self: { speedKph: 123.456 } });
  expect(liveResult.observation.alpha).toBe(app.renderExpertFrame.mock.calls.at(-1)[1].observation.alpha);
  socket.emit('close');
  expect(text(sensesPanel)).toContain('Select a controlled car');
  expect(text(sensesPanel)).not.toContain('123 kph');
  expect(JSON.parse(readout.textContent).self).toBe(null);
  expect(connection.active).toBe(false);
});
