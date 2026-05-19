import { metersToSimUnits, simUnitsToMeters } from '../simulation/units.js';
import { normalizeAngle } from '../simulation/simMath.js';
import { pointAt } from '../simulation/track/trackModel.js';
import { normalizeLookaheadMeters } from './observationOptions.js';
import { buildBodySenses } from './sensors/bodySenses.js';
import { buildBoundarySenses } from './sensors/boundarySenses.js';
import { buildContactPatchSenses } from './sensors/contactSenses.js';
import { enrichOpponentRadar } from './sensors/opponentRadar.js';
import { buildNearbyCars, buildRaySensors, createRayBatchContext, normalizeRayOptions } from './sensors.js';
import { buildObservationVector } from './observationVector.js';

const EMPTY_EVENTS = Object.freeze([]);

export function buildEnvironmentObservation({ snapshot, options, events = [], controlledDrivers = options.controlledDrivers }) {
  const carsById = new Map(snapshot.cars.map((entry) => [entry.id, entry]));
  const eventsByDriver = groupEventsByDriver(events, controlledDrivers);
  const defaultSensors = defaultSensorOptions(options);
  const hasSensorOverrides = Object.keys(options.sensorsByDriver ?? {}).length > 0;
  let rayBatchContext = null;
  const getRayBatchContext = () => {
    rayBatchContext ??= createRayBatchContext(snapshot);
    return rayBatchContext;
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
    const output = options.observation?.output ?? 'full';
    const includeSchema = options.observation?.includeSchema !== false;
    const wantsObject = output === 'full' || output === 'object';
    const wantsVector = output === 'full' || output === 'vector';
    const object = wantsObject
      ? buildDriverObservationObject(car, snapshot, options, driverEvents, sensors, getRayBatchContext)
      : null;
    const { vector, schema } = wantsVector
      ? object
        ? buildDriverVector(object, sensors, {
          includeSchema,
          vectorType: options.observation?.vectorType,
        })
        : includeSchema
          ? buildDriverVector(buildDriverObservationObject(car, snapshot, options, driverEvents, sensors, getRayBatchContext), sensors, {
            includeSchema,
            vectorType: options.observation?.vectorType,
          })
          : buildDriverVectorDirect(car, snapshot, options, driverEvents, sensors, getRayBatchContext)
      : { vector: undefined, schema: [] };
    observations[driverId] = formatObservation({ object, vector, schema, events: driverEvents }, options.observation);
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

function groupEventsByDriver(events, controlledDrivers) {
  if (!events.length) return null;
  const byDriver = new Map(controlledDrivers.map((driverId) => [driverId, []]));
  const controlledSet = new Set(controlledDrivers);
  events.forEach((event) => {
    const driverIds = new Set([
      event.driverId,
      event.carId,
      event.otherCarId,
      ...(event.driverIds ?? []),
    ].filter(Boolean));
    driverIds.forEach((driverId) => {
      if (controlledSet.has(driverId)) byDriver.get(driverId)?.push(event);
    });
  });
  return byDriver;
}

function buildDriverObservationObject(car, snapshot, options, events, sensors, getRayBatchContext = null) {
  const sensorCar = withEnvironmentControlFlag(car, options);
  const onTrack = isCarLegallyOnTrack(car);
  const body = buildBodySenses(car);
  const trackHeadingError = car.trackHeadingError ?? estimateTrackHeadingError(car, snapshot);
  const trackRelation = {
    ...buildBoundarySenses(car, snapshot, onTrack),
    headingErrorRadians: trackHeadingError,
  };
  const nearbyCars = sensors.nearbyCars.enabled
    ? enrichOpponentRadar(car, buildNearbyCars(car, snapshot, sensors.nearbyCars), snapshot)
    : [];
  return {
    profile: options.observation?.profile ?? 'default',
    self: {
      ...body,
      lap: car.lap,
      completedLaps: car.lapTelemetry?.completedLaps ?? 0,
      lapProgressMeters: simUnitsToMeters(car.progress ?? 0),
      trackOffsetMeters: trackRelation.lateralOffsetMeters,
      trackHeadingErrorRadians: trackHeadingError,
      onTrack,
      surface: car.surface ?? 'track',
      inPitLane: Boolean(car.inPitLane),
      pitLanePart: car.pitLanePart ?? null,
      pitBoxId: car.pitBoxId ?? null,
      tireEnergy: car.tireEnergy ?? null,
      pitIntent: car.pitIntent ?? car.pitStop?.intent ?? 0,
      pitTargetCompound: car.pitStop?.targetTire ?? null,
      pitStopStatus: car.pitStop?.status ?? null,
      pitStopPhase: car.pitStop?.phase ?? null,
      pitStopServiceRemainingSeconds: car.pitStop?.serviceRemainingSeconds ?? null,
      pitStopPenaltyServiceRemainingSeconds: car.pitStop?.penaltyServiceRemainingSeconds ?? null,
      pitStopsCompleted: car.pitStop?.stopsCompleted ?? 0,
    },
    trackRelation,
    contactPatches: buildContactPatchSenses(car),
    race: {
      position: car.rank,
      totalCars: snapshot.cars.length,
      raceMode: snapshot.raceControl.mode,
      pitLaneOpen: Boolean(snapshot.raceControl.pitLaneOpen),
      redFlag: Boolean(snapshot.raceControl.redFlag),
      totalLaps: snapshot.totalLaps,
    },
    track: {
      lengthMeters: simUnitsToMeters(snapshot.track.length ?? 0),
      widthMeters: simUnitsToMeters(snapshot.track.width ?? 0),
      curvature: car.trackState?.curvature ?? pointAt(snapshot.track, car.progress ?? 0).curvature ?? 0,
      lookahead: buildTrackLookahead(car, snapshot, options),
    },
    rays: sensors.rays.enabled ? buildRaySensors(sensorCar, snapshot, sensors.rays, rayBatchContextForSensors(sensors, getRayBatchContext)) : [],
    nearbyCars,
    events,
  };
}

function estimateTrackHeadingError(car, snapshot) {
  const base = pointAt(snapshot.track, car.progress ?? 0);
  return normalizeAngle((car.heading ?? base.heading) - base.heading);
}

function buildTrackLookahead(car, snapshot, options) {
  const distances = Array.isArray(options.observation?.lookaheadMeters)
    ? options.observation.lookaheadMeters
    : normalizeLookaheadMeters(options.observation?.lookaheadMeters);
  if (!distances.length) return [];
  const base = pointAt(snapshot.track, car.progress ?? 0);
  return distances.map((distanceMeters) => {
    const sample = pointAt(snapshot.track, (car.progress ?? 0) + metersToSimUnits(distanceMeters));
    return {
      distanceMeters,
      curvature: sample.curvature ?? 0,
      headingDeltaRadians: normalizeAngle(sample.heading - base.heading),
    };
  });
}

function isCarLegallyOnTrack(car) {
  if (Array.isArray(car.wheels) && car.wheels.length > 0) {
    return car.wheels.every((wheel) => wheel.onTrack || wheel.inPitLane);
  }
  if (car.inPitLane) return true;
  return ['track', 'kerb', 'pit-entry', 'pit-lane', 'pit-exit', 'pit-box'].includes(car.surface ?? 'track');
}

function buildDriverVector(object, sensors, { includeSchema = true, vectorType = 'array' } = {}) {
  return buildObservationVector(object, sensors, { includeSchema, vectorType });
}

function buildDriverVectorDirect(car, snapshot, options, events, sensors, getRayBatchContext = null) {
  const profile = options.observation?.profile ?? 'default';
  const includePhysicalDriverSenses = profile === 'physical-driver';
  const onTrack = isCarLegallyOnTrack(car);
  const body = buildBodySenses(car);
  const trackHeadingError = car.trackHeadingError ?? estimateTrackHeadingError(car, snapshot);
  const sensorCar = withEnvironmentControlFlag(car, options);
  const trackRelation = {
    ...buildBoundarySenses(car, snapshot, onTrack),
    headingErrorRadians: trackHeadingError,
  };
  const contactPatches = includePhysicalDriverSenses ? buildContactPatchSenses(car) : [];
  const rays = sensors.rays.enabled ? buildRaySensors(sensorCar, snapshot, sensors.rays, rayBatchContextForSensors(sensors, getRayBatchContext)) : [];
  const nearbyCars = sensors.nearbyCars.enabled
    ? enrichOpponentRadar(car, buildNearbyCars(car, snapshot, sensors.nearbyCars), snapshot)
    : [];
  const trackLengthMeters = simUnitsToMeters(snapshot.track.length ?? 0);
  const trackCurvature = car.trackState?.curvature ?? pointAt(snapshot.track, car.progress ?? 0).curvature ?? 0;
  const source = {
    profile,
    self: {
      ...body,
      lapProgressMeters: simUnitsToMeters(car.progress ?? 0),
      trackOffsetMeters: trackRelation.lateralOffsetMeters,
      trackHeadingErrorRadians: trackHeadingError,
      onTrack,
      inPitLane: Boolean(car.inPitLane),
      tireEnergy: car.tireEnergy ?? null,
      pitIntent: car.pitIntent ?? car.pitStop?.intent ?? 0,
      pitStopStatus: car.pitStop?.status ?? null,
    },
    trackRelation,
    contactPatches,
    race: {
      position: car.rank,
      totalCars: snapshot.cars.length,
      raceMode: snapshot.raceControl.mode,
      pitLaneOpen: Boolean(snapshot.raceControl.pitLaneOpen),
      redFlag: Boolean(snapshot.raceControl.redFlag),
    },
    track: {
      lengthMeters: trackLengthMeters,
      curvature: trackCurvature,
      lookahead: buildTrackLookahead(car, snapshot, options),
    },
    rays,
    nearbyCars,
  };
  return buildObservationVector(source, sensors, {
    includeSchema: false,
    vectorType: options.observation?.vectorType,
  });
}

function rayBatchContextForSensors(sensors, getRayBatchContext) {
  if (!getRayBatchContext || !sensors.rays?.channels?.includes('car')) return null;
  return getRayBatchContext();
}

export function defaultSensorOptions(options) {
  return {
    rays: normalizeRayOptions(options.sensors.rays),
    nearbyCars: options.sensors.nearbyCars,
  };
}

export function effectiveSensorOptions(options, driverId, defaultSensors = defaultSensorOptions(options), hasSensorOverrides = true) {
  if (!hasSensorOverrides || !options.sensorsByDriver?.[driverId]) return defaultSensors;
  const rayOverrides = options.sensorsByDriver?.[driverId]?.rays ?? {};
  return {
    rays: normalizeRayOptions(mergeDriverRayOptions(options.sensors.rays, rayOverrides)),
    nearbyCars: {
      ...options.sensors.nearbyCars,
      ...(options.sensorsByDriver?.[driverId]?.nearbyCars ?? {}),
    },
  };
}

function mergeDriverRayOptions(baseRays, rayOverrides = {}) {
  const merged = {
    ...baseRays,
    ...rayOverrides,
  };
  if (Object.hasOwn(rayOverrides, 'rays')) return merged;
  if (Object.hasOwn(rayOverrides, 'layout') || Object.hasOwn(rayOverrides, 'anglesDegrees')) {
    delete merged.rays;
    return merged;
  }
  if (Object.hasOwn(rayOverrides, 'lengthMeters') || Object.hasOwn(rayOverrides, 'defaultLengthMeters')) {
    merged.rays = (baseRays.rays ?? []).map((ray) => ({
      id: ray.id,
      angleDegrees: ray.angleDegrees,
    }));
  }
  return merged;
}

function emptyObservation(driverId) {
  return {
    object: {
      self: {
        id: driverId,
        speedKph: 0,
        speedMetersPerSecond: 0,
        headingRadians: 0,
        yawRateRadiansPerSecond: 0,
        steeringAngleRadians: 0,
        throttle: 0,
        brake: 0,
        lateralG: 0,
        longitudinalG: 0,
        gripUsage: 0,
        slipAngleRadians: 0,
        tractionLimited: false,
        stabilityState: 'stable',
        destroyed: false,
        destroyReason: null,
        lap: 0,
        completedLaps: 0,
        lapProgressMeters: 0,
        trackOffsetMeters: 0,
        trackHeadingErrorRadians: 0,
        onTrack: false,
        surface: 'missing',
        inPitLane: false,
        pitLanePart: null,
        pitBoxId: null,
        tireEnergy: null,
        pitIntent: 0,
        pitTargetCompound: null,
        pitStopStatus: null,
        pitStopPhase: null,
        pitStopServiceRemainingSeconds: null,
        pitStopPenaltyServiceRemainingSeconds: null,
        pitStopsCompleted: 0,
      },
      trackRelation: {
        lateralOffsetMeters: 0,
        headingErrorRadians: 0,
        legalWidthMeters: 0,
        leftBoundaryMeters: 0,
        rightBoundaryMeters: 0,
        onLegalSurface: false,
        surface: 'missing',
      },
      contactPatches: [],
      race: { position: 0, totalCars: 0, raceMode: 'missing', pitLaneOpen: false, redFlag: false, totalLaps: 0 },
      track: { lengthMeters: 0, widthMeters: 0, curvature: 0, lookahead: [] },
      rays: [],
      nearbyCars: [],
      events: [],
    },
    vector: [],
    schema: [],
    events: [],
  };
}

function withEnvironmentControlFlag(car, options) {
  if (!car || car.environmentControlled) return car;
  if (!Array.isArray(options?.controlledDrivers) || !options.controlledDrivers.includes(car.id)) return car;
  return {
    ...car,
    environmentControlled: true,
  };
}
