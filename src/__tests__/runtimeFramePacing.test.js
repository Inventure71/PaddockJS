import { afterEach, describe, expect, test, vi } from 'vitest';
import { Ticker, UPDATE_PRIORITY } from 'pixi.js';
import { runFrameLoopTick } from '../app/runtime/frameLoop.js';
import { configureRuntimeTicker, TARGET_FRAME_MS } from '../app/runtime/runtimeTiming.js';
import { FIXED_STEP } from '../simulation/raceSimulation.js';
import { CameraController } from '../app/camera/cameraController.js';
import { CAMERA_ROTATION_LERP, CAMERA_SCALE_LERP, CAMERA_TARGET_LERP } from '../app/camera/cameraConstants.js';

afterEach(() => vi.restoreAllMocks());

// Exercise the production clock, Pixi's real frame cap and render interpolation
// together. Average FPS and total simulation time do not reveal uneven motion.
describe('rendered motion follows elapsed time', () => {
  test.each([30, 60, 90, 120, 144].flatMap((rate) => [1, 10].map((speed) => [rate, speed])))('keeps constant velocity on a %i Hz display at %ix playback', (refreshRate, speed) => {
    const ticker = new Ticker();
    configureRuntimeTicker(ticker);
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const car = { id: 'alpha', previousX: 0, x: 0, y: 0, heading: 0 };
    const source = { cars: [car], track: {}, safetyCar: null };
    const frames = [];
    const app = {
      lastTime: 0, accumulator: 0,
      simulationSpeed: speed, lastDomUpdateTime: 0,
      sim: {
        events: [], step(dt) { car.previousX = car.x; car.x += 100 * dt; },
        snapshot: () => source, snapshotRenderInto: () => source,
      },
      sampleFps() {}, emitSnapshotLifecycle() {}, applyCamera() {},
      renderDrsTrails() {}, renderPitLaneStatus() {}, updateDom() {},
      renderCars(snapshot) { frames.push({ now, x: snapshot.cars[0].x }); },
    };
    let draws = 0;
    ticker.add(() => runFrameLoopTick(app));
    ticker.add(() => { draws += 1; }, undefined, UPDATE_PRIORITY.LOW);
    try {
      // Small scheduling jitter exercises cap boundaries.
      for (let frame = 1; frame <= refreshRate * 2; frame += 1) {
        now = frame * 1000 / refreshRate + 0.3 * Math.sin(frame * 1.7);
        ticker.update(now);
      }
      expect(frames).toHaveLength(draws);
      for (const frame of frames.filter(({ now: time }) => time > TARGET_FRAME_MS * 2)) {
        expect(frame.x).toBeCloseTo(100 * (frame.now / 1000 * speed - FIXED_STEP), 7);
      }
    } finally {
      ticker.destroy();
    }
  });

  test('bounds long-frame catch-up without carrying the stall into subsequent frames', () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const step = vi.fn();
    const app = {
      lastTime: 0, accumulator: 0, simulationSpeed: 10, lastDomUpdateTime: 0,
      sim: { step, events: [], snapshot: () => ({ cars: [] }) },
      sampleFps() {}, emitSnapshotLifecycle() {}, applyCamera: vi.fn(),
      renderDrsTrails() {}, renderPitLaneStatus() {}, renderCars() {}, updateDom() {},
    };
    runFrameLoopTick(app);
    expect(step).toHaveBeenCalledTimes(40);
    expect(app.accumulator).toBeLessThan(FIXED_STEP);
    expect(app.applyCamera.mock.calls[0][1].elapsedMs).toBeCloseTo(TARGET_FRAME_MS * 4);
    now += TARGET_FRAME_MS;
    runFrameLoopTick(app);
    expect(step).toHaveBeenCalledTimes(50);
  });

  test.each([30, 60, 144])('camera damping has the same wall-time response at %i Hz', (refreshRate) => {
    const controller = new CameraController({ canvasHost: { clientWidth: 900, clientHeight: 640 }, initialMode: 'leader' });
    const world = { scale: { set() {} }, position: { set() {} } };
    // Use the real transform path, isolate its frame from unrelated track fit.
    vi.spyOn(controller, 'getFrame').mockReturnValue({ target: { x: 100, y: 200 }, scale: 2, rotation: 1, screenX: 450, screenY: 320 });
    Object.assign(controller.camera, { initialized: true, x: 0, y: 0, scale: 1, rotation: 0 });
    let previous = 0;
    for (let index = 1; index <= refreshRate; index += 1) {
      const now = index * 1000 / refreshRate;
      controller.applyToWorldLayer(world, {}, { elapsedMs: now - previous });
      previous = now;
    }
    expect(controller.camera.x).toBeCloseTo(100 * (1 - (1 - CAMERA_TARGET_LERP) ** 60), 9);
    expect(controller.camera.y).toBeCloseTo(200 * (1 - (1 - CAMERA_TARGET_LERP) ** 60), 9);
    expect(controller.camera.scale).toBeCloseTo(2 - (1 - CAMERA_SCALE_LERP) ** 60, 9);
    expect(controller.camera.rotation).toBeCloseTo(1 - (1 - CAMERA_ROTATION_LERP) ** 60, 9);
  });
});
