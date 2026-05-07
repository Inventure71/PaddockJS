export function buildActionSpec(options) {
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
      },
    },
  };
}

export function buildObservationSpec(options) {
  const rayOptions = options.sensors.rays;
  const nearbyOptions = options.sensors.nearbyCars;
  return {
    version: 1,
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
        { name: 'tireEnergy', unit: 'nullable:number' },
        { name: 'pitIntent', unit: '0:none|1:if-free|2:committed' },
        { name: 'pitStopStatus', unit: 'nullable:label' },
      ],
      race: [
        { name: 'position', unit: 'rank' },
        { name: 'totalCars', unit: 'count' },
        { name: 'raceMode', unit: 'label' },
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
          relativeSpeedKph: { unit: 'kph' },
        },
      },
      nearbyCars: {
        enabled: Boolean(nearbyOptions.enabled),
        maxCars: nearbyOptions.maxCars,
        radiusMeters: nearbyOptions.radiusMeters,
      },
      events: { type: 'array' },
    },
    vector: {
      schema: [
        { name: 'self.speedKph', unit: 'kph', scale: 'fixed:400' },
        { name: 'self.trackOffsetMeters', unit: 'm', scale: 'fixed:meters' },
        { name: 'self.trackHeadingErrorRadians', unit: 'rad', scale: 'fixed:pi' },
        { name: 'self.onTrack', scale: 'boolean' },
        { name: 'race.position', scale: 'fixed:field-position' },
      ],
    },
  };
}
