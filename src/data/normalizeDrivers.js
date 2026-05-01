import { buildChampionshipDriverGrid } from './championship.js';

export function normalizeSimulatorDrivers(drivers, { entries } = {}) {
  if (!Array.isArray(drivers) || drivers.length === 0) {
    throw new Error('mountF1Simulator requires a non-empty drivers array.');
  }

  const seenDriverIds = new Set();
  drivers.forEach((driver, index) => {
    if (!driver || typeof driver !== 'object') {
      throw new Error(`Invalid simulator driver at index ${index}.`);
    }
    if (!driver.id) {
      throw new Error(`Simulator driver at index ${index} is missing an id.`);
    }
    if (seenDriverIds.has(driver.id)) {
      throw new Error(`Duplicate simulator driver id: ${driver.id}`);
    }
    seenDriverIds.add(driver.id);
    if (!driver.name) {
      throw new Error(`Simulator driver "${driver.id}" is missing a name.`);
    }
  });

  return buildChampionshipDriverGrid(drivers, entries);
}
