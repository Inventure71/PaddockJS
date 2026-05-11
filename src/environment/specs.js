import { normalizeLookaheadMeters } from './observationOptions.js';

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
  const rayOptions = options.sensors.rays;
  const nearbyOptions = options.sensors.nearbyCars;
  const lookaheadMeters = normalizeLookaheadMeters(options.observation?.lookaheadMeters);
  return {
    version: 2,
    controlledDrivers: [...options.controlledDrivers],
    object: {
      self: [
        { name: 'id', unit: 'id' },
        { name: 'speedKph', unit: 'kph' },
        { name: 'speedMetersPerSecond', unit: 'm/s' },
        { name: 'headingRadians', unit: 'rad' },
        { name: 'steeringAngleRadians', unit: 'rad' },
        { name: 'throttle', unit: 'normalized' },
        { name: 'brake', unit: 'normalized' },
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
      race: [
        { name: 'position', unit: 'rank' },
        { name: 'totalCars', unit: 'count' },
        { name: 'raceMode', unit: 'label' },
        { name: 'pitLaneOpen', unit: 'boolean' },
        { name: 'redFlag', unit: 'boolean' },
        { name: 'totalLaps', unit: 'count' },
      ],
      rays: {
        enabled: Boolean(rayOptions.enabled),
        anglesDegrees: [...rayOptions.anglesDegrees],
        lengthMeters: rayOptions.lengthMeters,
        track: {
          distanceMeters: { unit: 'm', noHitValue: rayOptions.lengthMeters },
          hit: { unit: 'boolean' },
          kind: { values: ['exit', 'entry', null] },
        },
        car: {
          distanceMeters: { unit: 'm', noHitValue: rayOptions.lengthMeters },
          hit: { unit: 'boolean' },
          driverId: { nullable: true },
          targetId: { nullable: true },
          targetType: { values: ['car', 'replayGhost', null] },
          relativeSpeedKph: { unit: 'kph' },
        },
      },
      nearbyCars: {
        enabled: Boolean(nearbyOptions.enabled),
        maxCars: nearbyOptions.maxCars,
        radiusMeters: nearbyOptions.radiusMeters,
      },
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
      schema: buildVectorSchema({ rayOptions, nearbyOptions, lookaheadMeters }),
    },
  };
}

function buildVectorSchema({ rayOptions, nearbyOptions, lookaheadMeters }) {
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
  lookaheadMeters.forEach((_, index) => {
    schema.push(
      { name: `track.lookahead[${index}].curvature`, scale: 'track-curvature' },
      { name: `track.lookahead[${index}].headingDeltaRadians`, unit: 'rad', scale: 'fixed:pi' },
    );
  });
  if (rayOptions.enabled) {
    rayOptions.anglesDegrees.forEach((_, index) => {
      schema.push(
        { name: `rays[${index}].track.distanceRatio`, scale: '0..1' },
        { name: `rays[${index}].track.hit`, scale: 'boolean' },
        { name: `rays[${index}].track.kindExit`, scale: 'boolean' },
        { name: `rays[${index}].track.kindEntry`, scale: 'boolean' },
        { name: `rays[${index}].car.distanceRatio`, scale: '0..1' },
        { name: `rays[${index}].car.hit`, scale: 'boolean' },
        { name: `rays[${index}].car.relativeSpeedKph`, unit: 'kph', scale: 'fixed:200' },
      );
    });
  }
  if (nearbyOptions.enabled) {
    for (let index = 0; index < nearbyOptions.maxCars; index += 1) {
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
    }
  }
  return schema;
}
