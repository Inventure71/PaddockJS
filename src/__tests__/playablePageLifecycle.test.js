import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ create: vi.fn(), loop: vi.fn(), detach: vi.fn() }));
vi.mock('@inventure71/paddockjs', () => ({
  DEMO_PROJECT_DRIVERS: [{ id: 'alpha' }], createPaddockSimulator: mocks.create,
  createPaddockDriverControllerLoop: mocks.loop, mountRaceTelemetryDrawer: vi.fn(),
}));
vi.mock('../../site/src/showcase/playableKeyboardController.js', () => ({
  createPlayableKeyboardState: () => ({ attach: () => mocks.detach, clear: vi.fn(), releaseKeys: vi.fn(), action: () => ({}), keys: () => [] }),
  createPlayableKeyboardController: () => ({}), createPlayableFrameScheduler: () => ({}),
}));
import { mountPlayablePage } from '../../site/src/showcase/playablePage.js';
const options = () => ({ requiredElement: () => new EventTarget(), commonOptions: () => ({}), previewPhysicsMode: () => 'arcade',
  previewUi: (value) => value, raceStrategyRules: () => ({ modules: {} }), addController: vi.fn(), trackSeed: 71 });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', { querySelector: () => null, querySelectorAll: () => [] });
});
afterEach(() => vi.unstubAllGlobals());

test('playable startup failure releases keyboard input and its allocated simulator', async () => {
  const failure = new Error('Renderer unavailable');
  const simulator = { start: vi.fn().mockRejectedValue(failure), destroy: vi.fn() };
  mocks.create.mockReturnValue(simulator);
  await expect(mountPlayablePage(options())).rejects.toBe(failure);
  expect(mocks.detach).toHaveBeenCalledOnce();
  expect(simulator.destroy).toHaveBeenCalledOnce();
});

test('unloading while playable startup is pending prevents a late controller loop', async () => {
  let finish;
  const simulator = { start: vi.fn(() => new Promise((resolve) => { finish = resolve; })), destroy: vi.fn() };
  mocks.create.mockReturnValue(simulator);
  const mounting = mountPlayablePage(options());
  window.dispatchEvent(new Event('beforeunload'));
  finish();
  const mounted = await mounting;
  expect(mocks.loop).not.toHaveBeenCalled();
  mounted.destroy();
  expect(mocks.detach).toHaveBeenCalledOnce();
  expect(simulator.destroy).toHaveBeenCalledOnce();
});

test('playable loop initialization failure releases an already initialized renderer', async () => {
  const simulator = { start: vi.fn().mockResolvedValue(), destroy: vi.fn() };
  mocks.create.mockReturnValue(simulator);
  mocks.loop.mockImplementation(() => { throw new Error('Loop unavailable'); });
  await expect(mountPlayablePage(options())).rejects.toThrow('Loop unavailable');
  expect(mocks.detach).toHaveBeenCalledOnce();
  expect(simulator.destroy).toHaveBeenCalledOnce();
});
