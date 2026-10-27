import { DriverData } from './driverData.js';
import { DEMO_PROJECT_DRIVERS } from './demoDrivers.js';
import { VehicleData } from './vehicleData.js';
import { normalizeEntryPresentation } from './entryPresentation.js';
import { DEFAULT_DARK_THEME_TOKENS } from '../config/theme/themeTokens.js';
import { normalizeCssColorToken } from '../config/theme/cssTokens.js';
import { CHAMPIONSHIP, CHAMPIONSHIP_ENTRY_BLUEPRINTS, CHAMPIONSHIP_DRIVER_ENTRIES } from './championshipDefaults.js';
import { normalizeTeam, pickUniqueTimingCode } from './entryIdentity.js';

export { DriverData, DRIVER_STAT_DEFINITIONS } from './driverData.js';
export { VehicleData, VEHICLE_STAT_DEFINITIONS } from './vehicleData.js';
export { CHAMPIONSHIP, CHAMPIONSHIP_ENTRY_BLUEPRINTS, CHAMPIONSHIP_DRIVER_ENTRIES } from './championshipDefaults.js';
export { formatDriverNumber } from './entryIdentity.js';

function assertUniqueDriverNumbers(entries) {
  const seen = new Map();
  entries.forEach((entry) => {
    if (entry.driverNumber == null) return;
    const driverId = entry.driverId ?? entry.id;
    if (seen.has(entry.driverNumber)) {
      throw new Error(`Duplicate championship driver number: ${entry.driverNumber} (${seen.get(entry.driverNumber)} and ${driverId})`);
    }
    seen.set(entry.driverNumber, driverId);
  });
}

function assertUniqueEntryDriverIds(entries) {
  const seen = new Set();
  entries.forEach((entry) => {
    if (entry.driverId == null) return;
    if (seen.has(entry.driverId)) {
      throw new Error(`Duplicate championship entry driver id: ${entry.driverId}`);
    }
    seen.add(entry.driverId);
  });
}

function buildDriverConstructorArgs(entry) {
  const driver = entry.driver instanceof DriverData
    ? entry.driver
    : new DriverData(entry.driver ?? {});
  return driver.toConstructorArgs();
}

function buildVehicleConstructorArgs(entry) {
  const vehicle = entry.vehicle instanceof VehicleData
    ? entry.vehicle
    : new VehicleData(entry.vehicle ?? {});
  return vehicle.toConstructorArgs();
}

export function buildChampionshipDriverGrid(drivers = DEMO_PROJECT_DRIVERS, entries = CHAMPIONSHIP_DRIVER_ENTRIES) {
  assertUniqueEntryDriverIds(entries);
  assertUniqueDriverNumbers(entries);

  const entryByDriverId = new Map(entries.map((entry) => [entry.driverId, entry]));
  const blueprintByDriverId = new Map(CHAMPIONSHIP_ENTRY_BLUEPRINTS.map((entry) => [entry.driverId, entry]));
  const usedTimingCodes = new Set();

  const grid = drivers.map((driver, index) => {
    const safeDriver = {
      ...driver,
      color: normalizeCssColorToken(driver.color, DEFAULT_DARK_THEME_TOKENS.primary),
    };
    const entry = {
      ...(blueprintByDriverId.get(safeDriver.id) ?? {}),
      ...(entryByDriverId.get(safeDriver.id) ?? {}),
    };
    const timingCode = pickUniqueTimingCode(entry.timingName ?? safeDriver.timingName ?? safeDriver.name ?? safeDriver.code, usedTimingCodes);
    const driverNumber = entry.driverNumber ?? safeDriver.driverNumber ?? index + 1;
    const driverArgs = buildDriverConstructorArgs({ driverId: safeDriver.id, ...entry });
    const vehicleArgs = buildVehicleConstructorArgs({ driverId: safeDriver.id, ...entry });

    return {
      ...safeDriver,
      presentation: normalizeEntryPresentation(safeDriver, entry.presentation ?? safeDriver.presentation),
      code: timingCode,
      timingCode,
      raceName: timingCode,
      driverNumber,
      team: normalizeTeam(entry.team, safeDriver, timingCode),
      pace: driverArgs.pace,
      racecraft: driverArgs.racecraft,
      consistency: driverArgs.consistency,
      personality: driverArgs.personality,
      driverModel: safeDriver.driverModel ?? driverArgs.driverModel ?? vehicleArgs.driverModel ?? null,
      vehicle: vehicleArgs,
      constructorArgs: {
        driver: driverArgs,
        vehicle: vehicleArgs,
      },
      championship: {
        ...CHAMPIONSHIP,
        entryIndex: index,
        vehicleId: vehicleArgs.id,
      },
    };
  });
  assertUniqueDriverNumbers(grid);
  return grid;
}
