export const MODEL_RAY_SURFACE_CHANNELS = Object.freeze(['kerb', 'illegalSurface']);

export function buildObservationVectorSchema({
  profile = 'default',
  contactPatchCount = 4,
  lookaheadCount = 0,
  rayCount = 0,
  rayChannels = [],
  nearbyCount = 0,
}) {
  const includePhysicalDriverSenses = profile === 'physical-driver';
  const schema = [
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
  ];
  if (includePhysicalDriverSenses) {
    schema.push(
      { name: 'self.yawRateRadiansPerSecond', unit: 'rad/s', scale: 'fixed:pi' },
      { name: 'trackRelation.leftBoundaryMeters', unit: 'm', scale: 'fixed:meters' },
      { name: 'trackRelation.rightBoundaryMeters', unit: 'm', scale: 'fixed:meters' },
      { name: 'trackRelation.legalWidthMeters', unit: 'm', scale: 'fixed:meters' },
    );
    for (let index = 0; index < contactPatchCount; index += 1) {
      schema.push(
        { name: `contactPatches[${index}].present`, scale: 'boolean' },
        { name: `contactPatches[${index}].surfaceCode`, scale: 'surface-code' },
        { name: `contactPatches[${index}].onLegalSurface`, scale: 'boolean' },
        { name: `contactPatches[${index}].signedOffsetMeters`, unit: 'm', scale: 'fixed:meters' },
        { name: `contactPatches[${index}].crossTrackErrorMeters`, unit: 'm', scale: 'fixed:meters' },
      );
    }
  }
  for (let index = 0; index < lookaheadCount; index += 1) {
    schema.push(
      { name: `track.lookahead[${index}].curvature`, scale: 'track-curvature' },
      { name: `track.lookahead[${index}].headingDeltaRadians`, unit: 'rad', scale: 'fixed:pi' },
    );
  }
  for (let index = 0; index < rayCount; index += 1) {
    schema.push(
      { name: `rays[${index}].track.distanceRatio`, scale: '0..1' },
      { name: `rays[${index}].track.hit`, scale: 'boolean' },
      { name: `rays[${index}].track.kindExit`, scale: 'boolean' },
      { name: `rays[${index}].track.kindEntry`, scale: 'boolean' },
      { name: `rays[${index}].car.distanceRatio`, scale: '0..1' },
      { name: `rays[${index}].car.hit`, scale: 'boolean' },
      { name: `rays[${index}].car.relativeSpeedKph`, unit: 'kph', scale: 'fixed:200' },
      { name: `rays[${index}].car.targetTypeReplayGhost`, scale: 'boolean' },
    );
    MODEL_RAY_SURFACE_CHANNELS.forEach((channel) => {
      if (rayChannels?.includes?.(channel)) {
        schema.push(
          { name: `rays[${index}].${channel}.distanceRatio`, scale: '0..1' },
          { name: `rays[${index}].${channel}.hit`, scale: 'boolean' },
        );
      }
    });
  }
  for (let index = 0; index < nearbyCount; index += 1) {
    schema.push(
      { name: `nearbyCars[${index}].present`, scale: 'boolean' },
      { name: `nearbyCars[${index}].relativeForwardRatio`, scale: '-1..1' },
      { name: `nearbyCars[${index}].relativeRightRatio`, scale: '-1..1' },
      { name: `nearbyCars[${index}].relativeDistanceRatio`, scale: '0..1' },
      { name: `nearbyCars[${index}].relativeSpeedKph`, unit: 'kph', scale: 'fixed:200' },
      { name: `nearbyCars[${index}].relativeHeadingRadians`, unit: 'rad', scale: 'fixed:pi' },
      { name: `nearbyCars[${index}].ahead`, scale: 'boolean' },
      { name: `nearbyCars[${index}].sameLap`, scale: 'boolean' },
      { name: `nearbyCars[${index}].entityTypeReplayGhost`, scale: 'boolean' },
    );
    if (includePhysicalDriverSenses) {
      schema.push(
        { name: `nearbyCars[${index}].behind`, scale: 'boolean' },
        { name: `nearbyCars[${index}].closingRateMetersPerSecond`, unit: 'm/s', scale: 'fixed:100' },
        { name: `nearbyCars[${index}].timeToContactSeconds`, unit: 's', scale: 'fixed:10' },
        { name: `nearbyCars[${index}].leftOverlap`, scale: 'boolean' },
        { name: `nearbyCars[${index}].rightOverlap`, scale: 'boolean' },
      );
    }
  }
  return schema;
}
