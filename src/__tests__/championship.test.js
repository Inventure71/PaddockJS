import { describe, expect, test } from 'vitest';
import {
  CHAMPIONSHIP_DRIVER_ENTRIES,
  CHAMPIONSHIP_ENTRY_BLUEPRINTS,
  CHAMPIONSHIP_PROJECT_DRIVERS,
  DriverData,
  DRIVER_STAT_DEFINITIONS,
  VehicleData,
  VEHICLE_STAT_DEFINITIONS,
  buildChampionshipDriverGrid,
  formatDriverNumber,
} from '../data/championship.js';

describe('championship driver metadata', () => {
  test('assigns stable unique driver numbers from the championship entries', () => {
    const numbers = CHAMPIONSHIP_PROJECT_DRIVERS.map((driver) => driver.driverNumber);

    expect(numbers).toHaveLength(new Set(numbers).size);
    expect(CHAMPIONSHIP_PROJECT_DRIVERS.find((driver) => driver.id === 'budget').driverNumber).toBe(71);
    expect(formatDriverNumber(7)).toBe('07');
  });

  test('generates unique F1-style three-letter timing names', () => {
    const timingCodes = CHAMPIONSHIP_PROJECT_DRIVERS.map((driver) => driver.timingCode);

    expect(timingCodes).toHaveLength(new Set(timingCodes).size);
    expect(timingCodes.every((code) => /^[A-Z]{3}$/.test(code))).toBe(true);
    expect(CHAMPIONSHIP_PROJECT_DRIVERS.find((driver) => driver.id === 'budget').timingCode).toBe('BUD');
    expect(CHAMPIONSHIP_PROJECT_DRIVERS.find((driver) => driver.id === 'drsorriso').timingCode).toBe('DRS');
  });

  test('rejects duplicate championship driver numbers', () => {
    expect(() => buildChampionshipDriverGrid(undefined, [
      ...CHAMPIONSHIP_DRIVER_ENTRIES,
      { driverId: 'duplicate', driverNumber: 71, timingName: 'Duplicate' },
    ])).toThrow('Duplicate championship driver number: 71');
  });

  test('allows host entries to omit driver numbers and falls back to stable grid order', () => {
    const drivers = [
      { id: 'alpha', name: 'Alpha Project', color: '#ff2d55' },
      { id: 'bravo', name: 'Bravo Project', color: '#39a7ff' },
    ];

    const grid = buildChampionshipDriverGrid(drivers, [
      { driverId: 'alpha', timingName: 'Alpha' },
      { driverId: 'bravo', timingName: 'Bravo' },
    ]);

    expect(grid.map((driver) => driver.driverNumber)).toEqual([1, 2]);
    expect(grid.map((driver) => driver.timingCode)).toEqual(['ALP', 'BRA']);
  });

  test('rejects duplicate host entry driver ids before merging race metadata', () => {
    expect(() => buildChampionshipDriverGrid([
      { id: 'alpha', name: 'Alpha Project', color: '#ff2d55' },
    ], [
      { driverId: 'alpha', timingName: 'Alpha One' },
      { driverId: 'alpha', timingName: 'Alpha Two' },
    ])).toThrow('Duplicate championship entry driver id: alpha');
  });

  test('defines neutral-at-50 rating sheets for drivers and vehicles', () => {
    expect(Object.keys(DRIVER_STAT_DEFINITIONS)).toEqual([
      'pace',
      'racecraft',
      'aggression',
      'riskTolerance',
      'patience',
      'consistency',
    ]);
    expect(Object.keys(VEHICLE_STAT_DEFINITIONS)).toEqual([
      'power',
      'braking',
      'aero',
      'dragEfficiency',
      'mechanicalGrip',
      'weightControl',
      'tireCare',
    ]);
    [...Object.values(DRIVER_STAT_DEFINITIONS), ...Object.values(VEHICLE_STAT_DEFINITIONS)].forEach((definition) => {
      expect(definition.neutral).toBe(50);
      expect(definition.minimum).toBe(0);
      expect(definition.maximum).toBe(100);
    });
  });

  test('builds paired driver and vehicle constructor argument sheets', () => {
    const budget = CHAMPIONSHIP_PROJECT_DRIVERS.find((driver) => driver.id === 'budget');
    const blueprint = CHAMPIONSHIP_ENTRY_BLUEPRINTS.find((entry) => entry.driverId === 'budget');

    expect(blueprint.driver).toBeInstanceOf(DriverData);
    expect(blueprint.vehicle).toBeInstanceOf(VehicleData);
    expect(blueprint.driver.pace).toBeGreaterThanOrEqual(0);
    expect(blueprint.driver.pace).toBeLessThanOrEqual(100);
    expect(blueprint.vehicle.power).toBeGreaterThanOrEqual(0);
    expect(blueprint.vehicle.power).toBeLessThanOrEqual(100);
    expect(budget.constructorArgs.driver.ratings).toEqual(blueprint.driver.ratings());
    expect(budget.constructorArgs.vehicle.ratings).toEqual(blueprint.vehicle.ratings());
    expect(budget.pace).not.toBe(1);
    expect(budget.racecraft).not.toBe(0.78);
    expect(budget.vehicle.powerNewtons).toBeGreaterThan(0);
    expect(budget.vehicle.brakeNewtons).toBeGreaterThan(0);
  });

  test('normalizes optional team metadata for each race entry', () => {
    const [alpha] = buildChampionshipDriverGrid([
      { id: 'alpha', name: 'Alpha Project', color: '#ff2d55' },
    ], [
      {
        driverId: 'alpha',
        driverNumber: 81,
        timingName: 'Alpha',
        team: {
          id: 'apex',
          name: 'Apex Works',
          color: '#00ff84',
          icon: 'AW',
        },
      },
    ]);

    expect(alpha.team).toEqual({
      id: 'apex',
      name: 'Apex Works',
      color: '#00ff84',
      icon: 'AW',
    });
  });

  test('defaults team color and icon from the entry car when team fields are omitted', () => {
    const [alpha] = buildChampionshipDriverGrid([
      { id: 'alpha', name: 'Alpha Project', color: '#ff2d55' },
    ], [
      {
        driverId: 'alpha',
        driverNumber: 81,
        timingName: 'Alpha',
        team: {
          id: 'apex',
          name: 'Apex Works',
        },
      },
    ]);

    expect(alpha.team.color).toBe('#ff2d55');
    expect(alpha.team.icon).toBe('AP');
  });
});
