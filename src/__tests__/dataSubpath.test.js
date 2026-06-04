import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  DriverData,
  VehicleData,
  buildChampionshipDriverGrid,
  createProceduralTrack,
  formatDriverNumber,
  kphToSimSpeed,
  normalizeSimulatorDrivers,
  simSpeedToKph,
} from '../data/index.js';

describe('CSS-free data subpath', () => {
  test('exports host data helpers without pulling browser runtime modules', () => {
    expect(DriverData).toBeTypeOf('function');
    expect(VehicleData).toBeTypeOf('function');
    expect(buildChampionshipDriverGrid).toBeTypeOf('function');
    expect(formatDriverNumber(7)).toBe('07');
    expect(normalizeSimulatorDrivers).toBeTypeOf('function');
    expect(createProceduralTrack).toBeTypeOf('function');
    expect(simSpeedToKph(kphToSimSpeed(120))).toBeCloseTo(120);

    const source = readFileSync(new URL('../data/index.js', import.meta.url), 'utf8');
    expect(source).not.toMatch(/styles\.css|F1SimulatorApp|pixi\.js/);
  });
});
