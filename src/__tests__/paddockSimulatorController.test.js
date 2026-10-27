import { describe, expect, test, vi } from 'vitest';
import { PaddockSimulatorController } from '../api/PaddockSimulatorController.js';
import { F1SimulatorApp } from '../app/F1SimulatorApp.js';

const OPTIONS = {
  drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
};

describe('PaddockSimulatorController lifecycle', () => {
  test('concurrent start calls await initialization before publishing the app', async () => {
    let finishInitialization;
    const init = vi.spyOn(F1SimulatorApp.prototype, 'init').mockImplementation(() => (
      new Promise((resolve) => {
        finishInitialization = resolve;
      })
    ));
    const controller = new PaddockSimulatorController(OPTIONS);

    try {
      let secondResolved = false;
      const first = controller.start();
      const second = controller.start().then((value) => {
        secondResolved = true;
        return value;
      });
      await Promise.resolve();

      expect(init).toHaveBeenCalledTimes(1);
      expect(controller.app).toBeNull();
      expect(controller.initializingApp).toBeInstanceOf(F1SimulatorApp);
      expect(secondResolved).toBe(false);

      finishInitialization();

      await expect(first).resolves.toBe(controller);
      await expect(second).resolves.toBe(controller);
      expect(controller.app).toBeInstanceOf(F1SimulatorApp);
      expect(controller.initializingApp).toBeNull();
      expect(controller.startPromise).toBeNull();
    } finally {
      controller.destroy();
      init.mockRestore();
    }
  });

  test('restart during initialization preserves the mounted DOM and pending runtime options', async () => {
    let complete;
    const init = vi.spyOn(F1SimulatorApp.prototype, 'init').mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    const controller = new PaddockSimulatorController(OPTIONS);
    const root = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
    controller.mountRaceControls(root);
    const originalMarkup = root.innerHTML;
    const originalOptions = controller.options;
    const pending = controller.start();
    try {
      expect(() => controller.restart({ title: 'Replacement' })).toThrow('Await start() before restarting');
      expect(root.innerHTML).toBe(originalMarkup);
      expect(controller.options).toBe(originalOptions);
      expect(controller.initializingApp.options).toBe(originalOptions);
      complete();
      await expect(pending).resolves.toBe(controller);
      expect(controller.app.options).toBe(originalOptions);
    } finally {
      complete();
      await pending.catch(() => {});
      controller.destroy();
      init.mockRestore();
    }
  });

  test('failed initialization clears lifecycle state and permits a clean retry', async () => {
    const failure = new Error('asset initialization failed');
    const init = vi.spyOn(F1SimulatorApp.prototype, 'init')
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce();
    const destroy = vi.spyOn(F1SimulatorApp.prototype, 'destroy');
    const controller = new PaddockSimulatorController(OPTIONS);

    try {
      await expect(controller.start()).rejects.toBe(failure);

      expect(controller.app).toBeNull();
      expect(controller.initializingApp).toBeNull();
      expect(controller.startPromise).toBeNull();
      expect(destroy).toHaveBeenCalledTimes(1);

      await expect(controller.start()).resolves.toBe(controller);
      expect(init).toHaveBeenCalledTimes(2);
      expect(controller.app).toBeInstanceOf(F1SimulatorApp);
    } finally {
      controller.destroy();
      destroy.mockRestore();
      init.mockRestore();
    }
  });
});
