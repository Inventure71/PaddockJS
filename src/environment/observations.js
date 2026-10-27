import { writeEventDriverIds } from './events.js';
import { defaultSensorOptions, effectiveSensorOptions } from './sensorOptions.js';
import { buildDriverObservation, emptyObservation } from './driverObservations.js';
import { createNearbyBatchContext } from './sensors/sensorTargets.js';
import { createRayBatchContext } from './sensors.js';
export { defaultSensorOptions, effectiveSensorOptions } from './sensorOptions.js';

const EMPTY_EVENTS = Object.freeze([]);

export function buildEnvironmentObservation({
  snapshot,
  options,
  events = [],
  controlledDrivers = options.controlledDrivers,
  scratch = null,
}) {
  const carsById = carsByIdForObservation(snapshot, scratch);
  const eventsByDriver = groupEventsByDriver(events, controlledDrivers, scratch);
  const defaultSensors = defaultSensorOptions(options);
  const hasSensorOverrides = Object.keys(options.sensorsByDriver ?? {}).length > 0;
  let rayBatchContext = null;
  let rayScratchBatchContext = null;
  const getRayBatchContext = ({ scratch: useScratch = false } = {}) => {
    if (useScratch) {
      rayScratchBatchContext ??= createRayBatchContext(snapshot, {
        scratch: rayBatchContextScratchForObservation(scratch),
      });
      return rayScratchBatchContext;
    }
    rayBatchContext ??= createRayBatchContext(snapshot);
    return rayBatchContext;
  };
  let nearbyBatchContext = null;
  const sensorContexts = {
    getRayBatchContext,
    getNearbyBatchContext: () => nearbyBatchContext ??= createNearbyBatchContext(snapshot),
  };
  const observations = {};
  controlledDrivers.forEach((driverId) => {
    const car = carsById.get(driverId);
    if (!car) {
      observations[driverId] = formatObservation(emptyObservation(driverId), options.observation);
      return;
    }

    const driverEvents = eventsByDriver?.get(driverId) ?? EMPTY_EVENTS;
    const sensors = effectiveSensorOptions(options, car.id, defaultSensors, hasSensorOverrides);
    observations[driverId] = formatObservation(
      buildDriverObservation(car, snapshot, options, driverEvents, sensors, sensorContexts),
      options.observation,
    );
  });
  return observations;
}

function formatObservation(observation, options = {}) {
  const output = options.output ?? 'full';
  const includeSchema = options.includeSchema !== false;
  const formatted = { events: observation.events ?? [] };
  if ((output === 'full' || output === 'object') && observation.object) formatted.object = observation.object;
  if ((output === 'full' || output === 'vector') && observation.vector) formatted.vector = observation.vector;
  if (includeSchema) formatted.schema = observation.schema;
  return formatted;
}

function carsByIdForObservation(snapshot, scratch) {
  if (!scratch) return new Map(snapshot.cars.map((entry) => [entry.id, entry]));
  const carsById = scratch.carsById ?? new Map();
  scratch.carsById = carsById;
  carsById.clear();
  for (let index = 0; index < snapshot.cars.length; index += 1) {
    const entry = snapshot.cars[index];
    carsById.set(entry.id, entry);
  }
  return carsById;
}

function groupEventsByDriver(events, controlledDrivers, scratch = null) {
  if (!events.length) return null;
  const byDriver = scratch ? (scratch.eventsByDriver ?? new Map()) : new Map();
  const controlledSet = scratch ? (scratch.controlledEventDrivers ?? new Set()) : new Set();
  const eventDriverIds = scratch ? (scratch.eventDriverIds ?? []) : [];
  if (scratch) {
    scratch.eventsByDriver = byDriver;
    scratch.controlledEventDrivers = controlledSet;
    scratch.eventDriverIds = eventDriverIds;
  }
  byDriver.clear();
  controlledSet.clear();
  for (let index = 0; index < controlledDrivers.length; index += 1) {
    const driverId = controlledDrivers[index];
    byDriver.set(driverId, []);
    controlledSet.add(driverId);
  }
  events.forEach((event) => {
    writeEventDriverIds(eventDriverIds, event);
    for (let index = 0; index < eventDriverIds.length; index += 1) {
      const driverId = eventDriverIds[index];
      if (controlledSet.has(driverId)) byDriver.get(driverId)?.push(event);
    }
  });
  eventDriverIds.length = 0;
  return byDriver;
}

function rayBatchContextScratchForObservation(scratch) {
  if (!scratch) return true;
  const rayScratch = scratch.rayBatchContextScratch ?? {};
  scratch.rayBatchContextScratch = rayScratch;
  return rayScratch;
}
