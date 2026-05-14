import { metersToSimUnits, simUnitsToMeters } from '../simulation/units.js';
import { normalizeAngle } from '../simulation/simMath.js';
import { pointAt } from '../simulation/track/trackModel.js';
import { normalizeLookaheadMeters } from './observationOptions.js';
import { buildBodySenses } from './sensors/bodySenses.js';
import { buildBoundarySenses } from './sensors/boundarySenses.js';
import { buildContactPatchSenses } from './sensors/contactSenses.js';
import { enrichOpponentRadar } from './sensors/opponentRadar.js';
import { buildNearbyCars, buildRaySensors, createRayBatchContext, normalizeRayOptions } from './sensors.js';

const EMPTY_EVENTS = Object.freeze([]);
const PHYSICAL_RAY_SURFACE_CHANNELS = Object.freeze(['kerb', 'illegalSurface']);

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
  const includePhysicalDriverSenses = object.profile === 'physical-driver';
  const schema = includeSchema ? [
    { name: 'self.speedKph', unit: 'kph', scale: 'fixed:400' },
    { name: 'self.speedMetersPerSecond', unit: 'm/s', scale: 'fixed:120' },
    { name: 'self.steeringAngleRadians', unit: 'rad', scale: 'fixed:pi' },
    { name: 'self.throttle', scale: '0..1' },
    { name: 'self.brake', scale: '0..1' },
    { name: 'self.lateralG', scale: 'fixed:8g' },
    { name: 'self.longitudinalG', scale: 'fixed:6g' },
    { name: 'self.gripUsage', scale: '0..2' },
    { name: 'self.slipAngleRadians', unit: 'rad', scale: 'fixed:pi' },
    { name: 'self.tractionLimited', scale: 'boolean' },
    { name: 'self.lapProgressRatio', scale: '0..1' },
    { name: 'self.trackOffsetMeters', unit: 'm', scale: 'fixed:meters' },
    { name: 'self.trackHeadingErrorRadians', unit: 'rad', scale: 'fixed:pi' },
    { name: 'self.onTrack', scale: 'boolean' },
    { name: 'self.inPitLane', scale: 'boolean' },
    { name: 'self.tireEnergy', scale: '0..100' },
    { name: 'self.pitIntent', scale: '0..2' },
    { name: 'self.pitStopActive', scale: 'boolean' },
    { name: 'race.positionNormalized', scale: '0..1' },
    { name: 'race.raceModeGreen', scale: 'boolean' },
    { name: 'race.raceModeSafetyCar', scale: 'boolean' },
    { name: 'race.redFlag', scale: 'boolean' },
    { name: 'race.pitLaneOpen', scale: 'boolean' },
    { name: 'track.curvature', scale: 'track-curvature' },
  ] : null;
  const vector = [
    object.self.speedKph / 400,
    object.self.speedMetersPerSecond / 120,
    object.self.steeringAngleRadians / Math.PI,
    object.self.throttle,
    object.self.brake,
    object.self.lateralG / 8,
    object.self.longitudinalG / 6,
    object.self.gripUsage / 2,
    object.self.slipAngleRadians / Math.PI,
    object.self.tractionLimited ? 1 : 0,
    normalizeLapProgress(object),
    object.self.trackOffsetMeters,
    object.self.trackHeadingErrorRadians / Math.PI,
    object.self.onTrack ? 1 : 0,
    object.self.inPitLane ? 1 : 0,
    (object.self.tireEnergy ?? 0) / 100,
    (object.self.pitIntent ?? 0) / 2,
    object.self.pitStopStatus && object.self.pitStopStatus !== 'pending' && object.self.pitStopStatus !== 'completed' ? 1 : 0,
    normalizeRacePosition(object),
    object.race.raceMode === 'green' ? 1 : 0,
    object.race.raceMode === 'safety-car' ? 1 : 0,
    object.race.redFlag ? 1 : 0,
    object.race.pitLaneOpen ? 1 : 0,
    object.track.curvature ?? 0,
  ];
  if (includePhysicalDriverSenses) {
    pushSchema(schema,
      { name: 'self.yawRateRadiansPerSecond', unit: 'rad/s', scale: 'fixed:pi' },
      { name: 'trackRelation.leftBoundaryMeters', unit: 'm', scale: 'fixed:meters' },
      { name: 'trackRelation.rightBoundaryMeters', unit: 'm', scale: 'fixed:meters' },
      { name: 'trackRelation.legalWidthMeters', unit: 'm', scale: 'fixed:meters' },
    );
    vector.push(
      object.self.yawRateRadiansPerSecond / Math.PI,
      object.trackRelation.leftBoundaryMeters,
      object.trackRelation.rightBoundaryMeters,
      object.trackRelation.legalWidthMeters,
    );
    object.contactPatches.forEach((patch, index) => {
      pushSchema(schema,
        { name: `contactPatches[${index}].present`, scale: 'boolean' },
        { name: `contactPatches[${index}].surfaceCode`, scale: 'surface-code' },
        { name: `contactPatches[${index}].onLegalSurface`, scale: 'boolean' },
        { name: `contactPatches[${index}].signedOffsetMeters`, unit: 'm', scale: 'fixed:meters' },
      );
      vector.push(
        patch.present ? 1 : 0,
        patch.surfaceCode / 5,
        patch.onLegalSurface ? 1 : 0,
        patch.signedOffsetMeters,
      );
    });
  }
  object.track.lookahead.forEach((sample, index) => {
    pushSchema(schema,
      { name: `track.lookahead[${index}].curvature`, scale: 'track-curvature' },
      { name: `track.lookahead[${index}].headingDeltaRadians`, unit: 'rad', scale: 'fixed:pi' },
    );
    vector.push(sample.curvature ?? 0, (sample.headingDeltaRadians ?? 0) / Math.PI);
  });
  object.rays.forEach((ray, index) => {
    pushSchema(schema,
      { name: `rays[${index}].track.distanceRatio`, scale: '0..1' },
      { name: `rays[${index}].track.hit`, scale: 'boolean' },
      { name: `rays[${index}].track.kindExit`, scale: 'boolean' },
      { name: `rays[${index}].track.kindEntry`, scale: 'boolean' },
      { name: `rays[${index}].car.distanceRatio`, scale: '0..1' },
      { name: `rays[${index}].car.hit`, scale: 'boolean' },
      { name: `rays[${index}].car.relativeSpeedKph`, unit: 'kph', scale: 'fixed:200' },
    );
    vector.push(
      ratio(ray.track.distanceMeters, ray.lengthMeters),
      ray.track.hit ? 1 : 0,
      ray.track.kind === 'exit' ? 1 : 0,
      ray.track.kind === 'entry' ? 1 : 0,
      ratio(ray.car.distanceMeters, ray.lengthMeters),
      ray.car.hit ? 1 : 0,
      ray.car.relativeSpeedKph / 200,
    );
    if (includePhysicalDriverSenses) {
      PHYSICAL_RAY_SURFACE_CHANNELS.forEach((channel) => {
        pushSchema(schema,
          { name: `rays[${index}].${channel}.distanceRatio`, scale: '0..1' },
          { name: `rays[${index}].${channel}.hit`, scale: 'boolean' },
        );
        vector.push(
          ratio(ray[channel]?.distanceMeters ?? ray.lengthMeters, ray.lengthMeters),
          ray[channel]?.hit ? 1 : 0,
        );
      });
    }
  });
  const nearbyLimit = sensors.nearbyCars.enabled ? (sensors.nearbyCars.maxCars ?? object.nearbyCars.length) : 0;
  const nearbyRadius = sensors.nearbyCars.radiusMeters ?? 150;
  for (let index = 0; index < nearbyLimit; index += 1) {
    const nearby = object.nearbyCars[index] ?? null;
    pushSchema(schema,
      { name: `nearbyCars[${index}].present`, scale: 'boolean' },
      { name: `nearbyCars[${index}].relativeForwardRatio`, scale: '-1..1' },
      { name: `nearbyCars[${index}].relativeRightRatio`, scale: '-1..1' },
      { name: `nearbyCars[${index}].relativeDistanceRatio`, scale: '0..1' },
      { name: `nearbyCars[${index}].relativeSpeedKph`, unit: 'kph', scale: 'fixed:200' },
      { name: `nearbyCars[${index}].relativeHeadingRadians`, unit: 'rad', scale: 'fixed:pi' },
      { name: `nearbyCars[${index}].ahead`, scale: 'boolean' },
      { name: `nearbyCars[${index}].sameLap`, scale: 'boolean' },
    );
    vector.push(
      nearby ? 1 : 0,
      clampRatio((nearby?.relativeForwardMeters ?? 0) / nearbyRadius),
      clampRatio((nearby?.relativeRightMeters ?? 0) / nearbyRadius),
      ratio(nearby?.relativeDistanceMeters ?? nearbyRadius, nearbyRadius),
      (nearby?.relativeSpeedKph ?? 0) / 200,
      (nearby?.relativeHeadingRadians ?? 0) / Math.PI,
      nearby?.ahead ? 1 : 0,
      nearby?.sameLap ? 1 : 0,
    );
    if (includePhysicalDriverSenses) {
      pushSchema(schema,
        { name: `nearbyCars[${index}].behind`, scale: 'boolean' },
        { name: `nearbyCars[${index}].closingRateMetersPerSecond`, unit: 'm/s', scale: 'fixed:100' },
        { name: `nearbyCars[${index}].timeToContactSeconds`, unit: 's', scale: 'fixed:10' },
        { name: `nearbyCars[${index}].leftOverlap`, scale: 'boolean' },
        { name: `nearbyCars[${index}].rightOverlap`, scale: 'boolean' },
      );
      vector.push(
        nearby?.behind ? 1 : 0,
        (nearby?.closingRateMetersPerSecond ?? 0) / 100,
        ratio(nearby?.timeToContactSeconds ?? 10, 10),
        nearby?.leftOverlap ? 1 : 0,
        nearby?.rightOverlap ? 1 : 0,
      );
    }
  }
  return { vector: finalizeVector(vector, vectorType), schema: schema ?? [] };
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
  const vector = [
    body.speedKph / 400,
    body.speedMetersPerSecond / 120,
    body.steeringAngleRadians / Math.PI,
    body.throttle,
    body.brake,
    body.lateralG / 8,
    body.longitudinalG / 6,
    body.gripUsage / 2,
    body.slipAngleRadians / Math.PI,
    body.tractionLimited ? 1 : 0,
    ratio(simUnitsToMeters(car.progress ?? 0), trackLengthMeters || 1),
    trackRelation.lateralOffsetMeters,
    trackHeadingError / Math.PI,
    onTrack ? 1 : 0,
    car.inPitLane ? 1 : 0,
    (car.tireEnergy ?? 0) / 100,
    (car.pitIntent ?? car.pitStop?.intent ?? 0) / 2,
    car.pitStop?.status && car.pitStop.status !== 'pending' && car.pitStop.status !== 'completed' ? 1 : 0,
    snapshot.cars.length <= 1 ? 0 : ((car.rank ?? 1) - 1) / Math.max(1, snapshot.cars.length - 1),
    snapshot.raceControl.mode === 'green' ? 1 : 0,
    snapshot.raceControl.mode === 'safety-car' ? 1 : 0,
    snapshot.raceControl.redFlag ? 1 : 0,
    snapshot.raceControl.pitLaneOpen ? 1 : 0,
    trackCurvature,
  ];
  if (includePhysicalDriverSenses) {
    vector.push(
      body.yawRateRadiansPerSecond / Math.PI,
      trackRelation.leftBoundaryMeters,
      trackRelation.rightBoundaryMeters,
      trackRelation.legalWidthMeters,
    );
    contactPatches.forEach((patch) => {
      vector.push(
        patch.present ? 1 : 0,
        patch.surfaceCode / 5,
        patch.onLegalSurface ? 1 : 0,
        patch.signedOffsetMeters,
      );
    });
  }
  buildTrackLookahead(car, snapshot, options).forEach((sample) => {
    vector.push(sample.curvature ?? 0, (sample.headingDeltaRadians ?? 0) / Math.PI);
  });
  rays.forEach((ray) => {
    vector.push(
      ratio(ray.track.distanceMeters, ray.lengthMeters),
      ray.track.hit ? 1 : 0,
      ray.track.kind === 'exit' ? 1 : 0,
      ray.track.kind === 'entry' ? 1 : 0,
      ratio(ray.car.distanceMeters, ray.lengthMeters),
      ray.car.hit ? 1 : 0,
      ray.car.relativeSpeedKph / 200,
    );
    if (includePhysicalDriverSenses) {
      PHYSICAL_RAY_SURFACE_CHANNELS.forEach((channel) => {
        vector.push(
          ratio(ray[channel]?.distanceMeters ?? ray.lengthMeters, ray.lengthMeters),
          ray[channel]?.hit ? 1 : 0,
        );
      });
    }
  });
  const nearbyLimit = sensors.nearbyCars.enabled ? (sensors.nearbyCars.maxCars ?? nearbyCars.length) : 0;
  const nearbyRadius = sensors.nearbyCars.radiusMeters ?? 150;
  for (let index = 0; index < nearbyLimit; index += 1) {
    const nearby = nearbyCars[index] ?? null;
    vector.push(
      nearby ? 1 : 0,
      clampRatio((nearby?.relativeForwardMeters ?? 0) / nearbyRadius),
      clampRatio((nearby?.relativeRightMeters ?? 0) / nearbyRadius),
      ratio(nearby?.relativeDistanceMeters ?? nearbyRadius, nearbyRadius),
      (nearby?.relativeSpeedKph ?? 0) / 200,
      (nearby?.relativeHeadingRadians ?? 0) / Math.PI,
      nearby?.ahead ? 1 : 0,
      nearby?.sameLap ? 1 : 0,
    );
    if (includePhysicalDriverSenses) {
      vector.push(
        nearby?.behind ? 1 : 0,
        (nearby?.closingRateMetersPerSecond ?? 0) / 100,
        ratio(nearby?.timeToContactSeconds ?? 10, 10),
        nearby?.leftOverlap ? 1 : 0,
        nearby?.rightOverlap ? 1 : 0,
      );
    }
  }
  return { vector: finalizeVector(vector, options.observation?.vectorType), schema: [] };
}

function rayBatchContextForSensors(sensors, getRayBatchContext) {
  if (!getRayBatchContext || !sensors.rays?.channels?.includes('car')) return null;
  return getRayBatchContext();
}

function finalizeVector(vector, vectorType = 'array') {
  return vectorType === 'float32' ? Float32Array.from(vector) : vector;
}

function pushSchema(schema, ...entries) {
  if (schema) schema.push(...entries);
}

function normalizeLapProgress(object) {
  return ratio(object.self.lapProgressMeters, object.track.lengthMeters || 1);
}

function normalizeRacePosition(object) {
  const totalCars = Number(object.race.totalCars);
  const position = Number(object.race.position);
  if (!Number.isFinite(totalCars) || totalCars <= 1 || !Number.isFinite(position)) return 0;
  return ratio(position - 1, totalCars - 1);
}

function ratio(value, max) {
  const finite = Number.isFinite(value) ? value : max;
  return Math.max(0, Math.min(1, finite / Math.max(1e-9, max)));
}

function clampRatio(value) {
  return Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
}

function defaultSensorOptions(options) {
  return {
    rays: normalizeRayOptions(options.sensors.rays),
    nearbyCars: options.sensors.nearbyCars,
  };
}

function effectiveSensorOptions(options, driverId, defaultSensors = defaultSensorOptions(options), hasSensorOverrides = true) {
  if (!hasSensorOverrides || !options.sensorsByDriver?.[driverId]) return defaultSensors;
  return {
    rays: normalizeRayOptions({
      ...options.sensors.rays,
      ...(options.sensorsByDriver?.[driverId]?.rays ?? {}),
    }),
    nearbyCars: {
      ...options.sensors.nearbyCars,
      ...(options.sensorsByDriver?.[driverId]?.nearbyCars ?? {}),
    },
  };
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
