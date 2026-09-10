import { normalizeLookaheadMeters } from './observationOptions.js';
import { effectiveSensorOptions } from './observations.js';
import { normalizeRayOptions } from './sensors.js';
import { buildObservationVectorSchema } from './observationSchema.js';

export function buildActionSpec(options) {
  const compounds = Array.isArray(options.rules?.modules?.tireStrategy?.compounds) &&
    options.rules.modules.tireStrategy.compounds.length
    ? [...options.rules.modules.tireStrategy.compounds]
    : ['S', 'M', 'H'];
  return {
    version: 1,
    controlledDrivers: [...options.controlledDrivers],
    action: {
      type: 'continuous',
      perDriver: {
        steering: { min: -1, max: 1, unit: 'normalized' },
        throttle: { min: 0, max: 1, unit: 'normalized' },
        brake: { min: 0, max: 1, unit: 'normalized' },
        pitIntent: { values: [0, 1, 2], unit: 'request', optional: true },
        pitCompound: { values: compounds, unit: 'compound', optional: true },
      },
    },
  };
}

export function buildObservationSpec(options) {
  const rayOptions = normalizeRayOptions(options.sensors.rays);
  const nearbyOptions = options.sensors.nearbyCars;
  const lookaheadMeters = Array.isArray(options.observation?.lookaheadMeters)
    ? options.observation.lookaheadMeters
    : normalizeLookaheadMeters(options.observation?.lookaheadMeters);
  const profile = options.observation?.profile ?? 'default';
  return {
    version: profile === 'physical-driver' ? 6 : 3,
    controlledDrivers: [...options.controlledDrivers],
    object: {
      profile,
      self: [
        { name: 'id', unit: 'id' },
        { name: 'speedKph', unit: 'kph' },
        { name: 'speedMetersPerSecond', unit: 'm/s' },
        { name: 'headingRadians', unit: 'rad' },
        { name: 'yawRateRadiansPerSecond', unit: 'rad/s' },
        { name: 'steeringAngleRadians', unit: 'rad' },
        { name: 'throttle', unit: 'normalized' },
        { name: 'brake', unit: 'normalized' },
        { name: 'appliedControls', unit: 'nullable:normalized-controls' },
        { name: 'lateralG', unit: 'g' },
        { name: 'longitudinalG', unit: 'g' },
        { name: 'gripUsage', unit: 'ratio' },
        { name: 'slipAngleRadians', unit: 'rad' },
        { name: 'tractionLimited', unit: 'boolean' },
        { name: 'stabilityState', unit: 'label' },
        { name: 'destroyed', unit: 'boolean' },
        { name: 'destroyReason', unit: 'nullable:label' },
        { name: 'lap', unit: 'count' },
        { name: 'completedLaps', unit: 'count' },
        { name: 'lapProgressMeters', unit: 'm' },
        { name: 'trackOffsetMeters', unit: 'm' },
        { name: 'trackHeadingErrorRadians', unit: 'rad' },
        { name: 'onTrack', unit: 'boolean' },
        { name: 'surface', unit: 'label' },
        { name: 'inPitLane', unit: 'boolean' },
        { name: 'pitLanePart', unit: 'nullable:label' },
        { name: 'pitBoxId', unit: 'nullable:id' },
        { name: 'tireEnergy', unit: 'nullable:number' },
        { name: 'pitIntent', unit: '0:none|1:if-free|2:committed' },
        { name: 'pitTargetCompound', unit: 'nullable:compound' },
        { name: 'pitStopStatus', unit: 'nullable:label' },
        { name: 'pitStopPhase', unit: 'nullable:label' },
        { name: 'pitStopServiceRemainingSeconds', unit: 'nullable:seconds' },
        { name: 'pitStopPenaltyServiceRemainingSeconds', unit: 'nullable:seconds' },
        { name: 'pitStopsCompleted', unit: 'count' },
      ],
      trackRelation: [
        { name: 'lateralOffsetMeters', unit: 'm' },
        { name: 'headingErrorRadians', unit: 'rad' },
        { name: 'legalWidthMeters', unit: 'm' },
        { name: 'leftBoundaryMeters', unit: 'm' },
        { name: 'rightBoundaryMeters', unit: 'm' },
        { name: 'onLegalSurface', unit: 'boolean' },
        { name: 'surface', unit: 'label' },
      ],
      contactPatches: {
        ids: ['front-left', 'front-right', 'rear-left', 'rear-right'],
        fields: [
          { name: 'present', unit: 'boolean' },
          { name: 'signedOffsetMeters', unit: 'm' },
          { name: 'crossTrackErrorMeters', unit: 'm' },
          { name: 'surface', unit: 'label' },
          { name: 'surfaceCode', unit: 'number' },
          { name: 'onLegalSurface', unit: 'boolean' },
          { name: 'inPitLane', unit: 'boolean' },
        ],
      },
      race: [
        { name: 'position', unit: 'rank' },
        { name: 'totalCars', unit: 'count' },
        { name: 'raceMode', unit: 'label' },
        { name: 'pitLaneOpen', unit: 'boolean' },
        { name: 'redFlag', unit: 'boolean' },
        { name: 'totalLaps', unit: 'count' },
      ],
      rays: buildRayObjectSpec(rayOptions),
      nearbyCars: buildNearbyObjectSpec(nearbyOptions),
      track: {
        lengthMeters: { unit: 'm' },
        widthMeters: { unit: 'm' },
        curvature: { unit: '1/sim-unit' },
        lookaheadMeters: [...lookaheadMeters],
        lookahead: {
          distanceMeters: { unit: 'm' },
          curvature: { unit: '1/sim-unit' },
          headingDeltaRadians: { unit: 'rad' },
        },
      },
      events: { type: 'array' },
    },
    vector: {
      schema: buildObservationVectorSchema({
        profile,
        lookaheadCount: lookaheadMeters.length,
        rayCount: rayOptions.enabled ? rayOptions.anglesDegrees.length : 0,
        rayChannels: rayOptions.channels,
        nearbyCount: nearbyOptions.enabled ? nearbyOptions.maxCars : 0,
      }),
    },
    perDriver: buildPerDriverObservationSpecs(options, { rayOptions, nearbyOptions, lookaheadMeters, profile }),
  };
}

function buildPerDriverObservationSpecs(options, { rayOptions, nearbyOptions, lookaheadMeters, profile }) {
  if (Object.keys(options.sensorsByDriver ?? {}).length === 0) return {};
  const defaultSensors = { rays: rayOptions, nearbyCars: nearbyOptions };
  return Object.fromEntries(options.controlledDrivers.map((driverId) => {
    const sensors = effectiveSensorOptions(options, driverId, defaultSensors, true);
    return [driverId, {
      object: {
        rays: buildRayObjectSpec(sensors.rays),
        nearbyCars: buildNearbyObjectSpec(sensors.nearbyCars),
      },
      vector: {
        schema: buildObservationVectorSchema({
          profile,
          lookaheadCount: lookaheadMeters.length,
          rayCount: sensors.rays.enabled ? sensors.rays.anglesDegrees.length : 0,
          rayChannels: sensors.rays.channels,
          nearbyCount: sensors.nearbyCars.enabled ? sensors.nearbyCars.maxCars : 0,
        }),
      },
    }];
  }));
}

function buildRayObjectSpec(rayOptions) {
  return {
    enabled: Boolean(rayOptions.enabled),
    anglesDegrees: [...rayOptions.anglesDegrees],
    lengthMeters: rayOptions.lengthMeters,
    defaultLengthMeters: rayOptions.defaultLengthMeters,
    rays: rayOptions.rays.map((ray) => ({ ...ray })),
    channels: [...rayOptions.channels],
    precision: rayOptions.precision,
    track: {
      distanceMeters: { unit: 'm', noHitValue: rayOptions.lengthMeters },
      hit: { unit: 'boolean' },
      kind: { values: ['exit', 'entry', null] },
    },
    roadEdge: {
      distanceMeters: { unit: 'm', noHitValue: rayOptions.lengthMeters },
      hit: { unit: 'boolean' },
      kind: { values: ['exit', 'entry', null] },
    },
    kerb: surfaceRaySpec(rayOptions.lengthMeters),
    illegalSurface: surfaceRaySpec(rayOptions.lengthMeters),
    car: {
      distanceMeters: { unit: 'm', noHitValue: rayOptions.lengthMeters },
      hit: { unit: 'boolean' },
      driverId: { nullable: true },
      targetId: { nullable: true },
      targetType: { values: ['car', 'replayGhost', null] },
      relativeSpeedKph: { unit: 'kph' },
    },
  };
}

function buildNearbyObjectSpec(nearbyOptions) {
  return {
    enabled: Boolean(nearbyOptions.enabled),
    maxCars: nearbyOptions.maxCars,
    radiusMeters: nearbyOptions.radiusMeters,
  };
}

function surfaceRaySpec(lengthMeters) {
  return {
    distanceMeters: { unit: 'm', noHitValue: lengthMeters },
    hit: { unit: 'boolean' },
    surface: { values: ['kerb', 'grass', 'gravel', null] },
  };
}
