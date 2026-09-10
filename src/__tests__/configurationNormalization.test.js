import { describe, expect, test } from 'vitest';
import { DriverData, VehicleData } from '../data/index.js';
import { resolveF1SimulatorOptions } from '../config/defaultOptions.js';
import { createTelemetryPanelMarkup } from '../ui/telemetryTemplates.js';

describe('shared rating scale through public data classes', () => {
  test.each([
    [undefined, 50, 1, 798, 0.33],
    [null, 0, 0.92, 808, 0.365],
    [false, 0, 0.92, 808, 0.365],
    ['50', 50, 1, 798, 0.33],
    [-10, 0, 0.92, 808, 0.365],
    [100, 100, 1.08, 788, 0.295],
    [120, 100, 1.08, 788, 0.295],
  ])('preserves defaults, coercion, bounds and inverse vehicle direction for %j', (input, rating, pace, mass, drag) => {
    const driver = new DriverData({ pace: input }).toConstructorArgs();
    const vehicle = new VehicleData({ weightControl: input, dragEfficiency: input }).toConstructorArgs();
    expect(driver.ratings.pace).toBe(rating);
    expect(vehicle.ratings.weightControl).toBe(rating);
    expect(driver.pace).toBe(pace);
    expect(vehicle.mass).toBe(mass);
    expect(vehicle.dragCoefficient).toBeCloseTo(drag, 14);
  });

  test.each([NaN, Infinity, 'invalid'])('retains domain-specific errors for %j', (input) => {
    expect(() => new DriverData({ pace: input })).toThrow(`Invalid driver rating for pace: ${input}`);
    expect(() => new VehicleData({ power: input })).toThrow(`Invalid vehicle rating for power: ${input}`);
  });
});

describe('telemetry options and raw template inputs share module policy', () => {
  const names = ['core', 'sectors', 'lapTimes', 'sectorTimes'];
  const components = ['telemetry-core', 'telemetry-sectors', 'telemetry-lap-times', 'telemetry-sector-times'];
  test.each([
    [undefined, [true, true, true, true]],
    [null, [true, true, true, true]],
    [true, [true, true, true, true]],
    [false, [false, false, false, false]],
    [[], [false, false, false, false]],
    [['core', 'unknown', 'core'], [true, false, false, false]],
    [{ core: 0, sectors: null, lapTimes: 1, sectorTimes: false }, [false, true, true, false]],
    ['invalid', [true, true, true, true]],
  ])('preserves module output for %j', (input, flags) => {
    const options = resolveF1SimulatorOptions({
      drivers: [{ id: 'driver', name: 'Driver', color: '#ff0000' }],
      ui: { telemetryModules: input },
    });
    expect(options.ui.telemetryModules).toEqual(Object.fromEntries(names.map((name, i) => [name, flags[i]])));
    const rawMarkup = createTelemetryPanelMarkup({ ui: { telemetryModules: input } }, { includeOverview: false });
    const normalizedMarkup = createTelemetryPanelMarkup(options, { includeOverview: false });
    expect(rawMarkup).toBe(normalizedMarkup);
    components.forEach((component, i) => {
      expect(rawMarkup.includes(`data-paddock-component="${component}"`)).toBe(flags[i]);
    });
  });
});
