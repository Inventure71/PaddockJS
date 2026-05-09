import { metersToSimUnits, simSpeedToMetersPerSecond, simUnitsToMeters } from '../simulation/units.js';
import { normalizeAngle } from '../simulation/simMath.js';
import { pointAt } from '../simulation/trackModel.js';
import { normalizeLookaheadMeters } from './observationOptions.js';
import { buildNearbyCars, buildRaySensors } from './sensors.js';

export function buildEnvironmentObservation({ snapshot, options, events = [] }) {
  const carsById = new Map(snapshot.cars.map((entry) => [entry.id, entry]));
  const eventsByDriver = groupEventsByDriver(events, options.controlledDrivers);
  return Object.fromEntries(options.controlledDrivers.map((driverId) => {
    const car = carsById.get(driverId);
    if (!car) return [driverId, emptyObservation(driverId)];

    const driverEvents = eventsByDriver.get(driverId) ?? [];
    const sensors = effectiveSensorOptions(options, car.id);
    const object = buildDriverObservationObject(car, snapshot, options, driverEvents, sensors);
    const { vector, schema } = buildDriverVector(object, sensors);
    return [driverId, { object, vector, schema, events: driverEvents }];
  }));
}

function groupEventsByDriver(events, controlledDrivers) {
  const byDriver = new Map(controlledDrivers.map((driverId) => [driverId, []]));
  if (!events.length) return byDriver;
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

function buildDriverObservationObject(car, snapshot, options, events, sensors) {
  return {
    self: {
      id: car.id,
      speedKph: car.speedKph,
      speedMetersPerSecond: simSpeedToMetersPerSecond(car.speed ?? 0),
      headingRadians: car.heading,
      steeringAngleRadians: car.steeringAngle ?? 0,
      throttle: car.throttle ?? 0,
      brake: car.brake ?? 0,
      lap: car.lap,
      completedLaps: car.lapTelemetry?.completedLaps ?? 0,
      lapProgressMeters: simUnitsToMeters(car.progress ?? 0),
      trackOffsetMeters: simUnitsToMeters(car.signedOffset ?? 0),
      trackHeadingErrorRadians: car.trackHeadingError ?? estimateTrackHeadingError(car, snapshot),
      onTrack: isCarLegallyOnTrack(car),
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
    rays: sensors.rays.enabled ? buildRaySensors(car, snapshot, sensors.rays) : [],
    nearbyCars: sensors.nearbyCars.enabled ? buildNearbyCars(car, snapshot, sensors.nearbyCars) : [],
    events,
  };
}

function estimateTrackHeadingError(car, snapshot) {
  const base = pointAt(snapshot.track, car.progress ?? 0);
  return normalizeAngle((car.heading ?? base.heading) - base.heading);
}

function buildTrackLookahead(car, snapshot, options) {
  const distances = normalizeLookaheadMeters(options.observation?.lookaheadMeters);
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

function buildDriverVector(object, sensors) {
  const schema = [
    { name: 'self.speedKph', unit: 'kph', scale: 'fixed:400' },
    { name: 'self.speedMetersPerSecond', unit: 'm/s', scale: 'fixed:120' },
    { name: 'self.steeringAngleRadians', unit: 'rad', scale: 'fixed:pi' },
    { name: 'self.throttle', scale: '0..1' },
    { name: 'self.brake', scale: '0..1' },
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
  ];
  const vector = [
    object.self.speedKph / 400,
    object.self.speedMetersPerSecond / 120,
    object.self.steeringAngleRadians / Math.PI,
    object.self.throttle,
    object.self.brake,
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
  object.track.lookahead.forEach((sample, index) => {
    schema.push(
      { name: `track.lookahead[${index}].curvature`, scale: 'track-curvature' },
      { name: `track.lookahead[${index}].headingDeltaRadians`, unit: 'rad', scale: 'fixed:pi' },
    );
    vector.push(sample.curvature ?? 0, (sample.headingDeltaRadians ?? 0) / Math.PI);
  });
  object.rays.forEach((ray, index) => {
    schema.push(
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
  });
  const nearbyLimit = sensors.nearbyCars.enabled ? (sensors.nearbyCars.maxCars ?? object.nearbyCars.length) : 0;
  const nearbyRadius = sensors.nearbyCars.radiusMeters ?? 150;
  for (let index = 0; index < nearbyLimit; index += 1) {
    const nearby = object.nearbyCars[index] ?? null;
    schema.push(
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
  }
  return { vector, schema };
}

function normalizeLapProgress(object) {
  return ratio(object.self.lapProgressMeters, object.track.lengthMeters || 1);
}

function normalizeRacePosition(object) {
  const total = Math.max(1, object.race.totalCars - 1);
  return object.race.totalCars <= 1 ? 0 : (object.race.position - 1) / total;
}

function ratio(value, max) {
  const finite = Number.isFinite(value) ? value : max;
  return Math.max(0, Math.min(1, finite / Math.max(1e-9, max)));
}

function clampRatio(value) {
  return Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
}

function effectiveSensorOptions(options, driverId) {
  return {
    rays: {
      ...options.sensors.rays,
      ...(options.sensorsByDriver?.[driverId]?.rays ?? {}),
    },
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
        steeringAngleRadians: 0,
        throttle: 0,
        brake: 0,
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
