import { simSpeedToMetersPerSecond, simUnitsToMeters } from '../simulation/units.js';
import { buildNearbyCars, buildRaySensors } from './sensors.js';

export function buildEnvironmentObservation({ snapshot, options, events = [] }) {
  return Object.fromEntries(options.controlledDrivers.map((driverId) => {
    const car = snapshot.cars.find((entry) => entry.id === driverId);
    if (!car) return [driverId, emptyObservation(driverId)];

    const driverEvents = events.filter((event) =>
      event.driverId === driverId ||
      event.carId === driverId ||
      event.otherCarId === driverId ||
      event.driverIds?.includes?.(driverId));
    const object = buildDriverObservationObject(car, snapshot, options, driverEvents);
    const { vector, schema } = buildDriverVector(object);
    return [driverId, { object, vector, schema, events: driverEvents }];
  }));
}

function buildDriverObservationObject(car, snapshot, options, events) {
  const sensors = effectiveSensorOptions(options, car.id);
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
      trackHeadingErrorRadians: car.trackHeadingError ?? 0,
      onTrack: (car.surface ?? 'track') === 'track',
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
    rays: sensors.rays.enabled ? buildRaySensors(car, snapshot, sensors.rays) : [],
    nearbyCars: sensors.nearbyCars.enabled ? buildNearbyCars(car, snapshot, sensors.nearbyCars) : [],
    events,
  };
}

function buildDriverVector(object) {
  const schema = [
    { name: 'self.speedKph', unit: 'kph', scale: 'fixed:400' },
    { name: 'self.trackOffsetMeters', unit: 'm', scale: 'fixed:meters' },
    { name: 'self.trackHeadingErrorRadians', unit: 'rad', scale: 'fixed:pi' },
    { name: 'self.onTrack', scale: 'boolean' },
    { name: 'race.position', scale: 'fixed:field-position' },
  ];
  const vector = [
    object.self.speedKph / 400,
    object.self.trackOffsetMeters,
    object.self.trackHeadingErrorRadians / Math.PI,
    object.self.onTrack ? 1 : 0,
    object.race.position,
  ];
  return { vector, schema };
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
      rays: [],
      nearbyCars: [],
      events: [],
    },
    vector: [],
    schema: [],
    events: [],
  };
}
