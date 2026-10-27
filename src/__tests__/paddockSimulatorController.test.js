import { describe, expect, test, vi } from 'vitest';
import { PaddockSimulatorController, mountViewControls } from '../api/PaddockSimulatorController.js';
import { createF1SimulatorShell } from '../ui/shellTemplate.js';
import { createRaceTelemetryDrawerMarkup } from '../ui/telemetryDrawerTemplate.js';
import { resolveF1SimulatorOptions } from '../config/defaultOptions.js';
import { F1SimulatorApp } from '../app/F1SimulatorApp.js';

const OPTIONS = {
  drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
};

describe('PaddockSimulatorController lifecycle', () => {
  test('mounts view controls before startup, remounts cleanly, and rerenders pre-start option changes', () => {
    const controller = new PaddockSimulatorController({ ...OPTIONS,
      gridWalk: { enabled: true, initialView: 'grid-walk' } });
    const root = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
    const replacement = { ...root };
    try {
      expect(mountViewControls(root, controller)).toBe(root);
      expect(controller.roots.get('view-controls')).toBe(root);
      expect(root.innerHTML).toContain('role="group" aria-label="Simulator view"');
      expect(root.innerHTML).toContain('data-grid-view="grid-walk" aria-pressed="true" disabled');
      expect(root.innerHTML).toContain('data-grid-view="race" aria-pressed="false" disabled');
      expect(() => controller.mountRaceControls(root)).toThrow('requires its own root');
      expect(controller.mountViewControls(replacement)).toBe(replacement);
      expect(root.innerHTML).toBe('');
      expect(controller.roots.get('view-controls')).toBe(replacement);
      controller.restart({ gridWalk: { enabled: false } });
      expect(replacement.innerHTML).toContain('role="group" hidden');
      expect(replacement.innerHTML).toContain('data-grid-view="race" aria-pressed="true" disabled');
      controller.restart({ gridWalk: { enabled: true, initialView: 'race' } });
      expect(replacement.innerHTML).not.toContain('role="group" hidden');
      expect(replacement.innerHTML).toContain('data-grid-view="race" aria-pressed="true" disabled');
    } finally {
      controller.destroy();
    }
    expect(replacement.innerHTML).toBe('');
    expect(controller.roots.size).toBe(0);
  });

  test('prevents mounting view controls during startup and after runtime startup', async () => {
    let complete;
    const init = vi.spyOn(F1SimulatorApp.prototype, 'init')
      .mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    const controller = new PaddockSimulatorController(OPTIONS);
    const root = { innerHTML: 'host content', querySelector: () => null, querySelectorAll: () => [] };
    const pending = controller.start();
    try {
      expect(() => controller.mountViewControls(root)).toThrow('before calling start()');
      expect(root.innerHTML).toBe('host content');
      complete();
      await pending;
      expect(() => mountViewControls(root, controller)).toThrow('before calling start()');
      expect(root.innerHTML).toBe('host content');
    } finally {
      complete();
      await pending.catch(() => {});
      controller.destroy();
      init.mockRestore();
    }
  });

  test('composes external view controls above built-in scenes and hides disabled controls for later activation', () => {
    for (const enabled of [false, true]) {
      const options = resolveF1SimulatorOptions({ ...OPTIONS, gridWalk: { enabled, initialView: 'race' } });
      const shell = createF1SimulatorShell(options);
      const drawer = createRaceTelemetryDrawerMarkup(options);
      for (const markup of [shell, drawer]) {
        expect(markup.includes('data-paddock-component="view-controls"')).toBe(true);
        expect(markup.includes('role="group" hidden')).toBe(!enabled);
      }
      expect(shell.indexOf('data-paddock-component="view-controls"')).toBeLessThan(shell.indexOf('class="sim-grid"'));
      expect(drawer.indexOf('data-paddock-component="view-controls"')).toBeGreaterThan(drawer.indexOf('class="race-telemetry-drawer__toolbar"'));
      expect(drawer.indexOf('data-paddock-component="view-controls"')).toBeLessThan(drawer.indexOf('class="race-telemetry-drawer__race"'));
    }
  });

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
