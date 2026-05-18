import { simUnitsToMeters } from '../../simulation/units.js';

export function buildBoundarySenses(car, snapshot, onLegalSurface) {
  const widthMeters = simUnitsToMeters(snapshot.track?.width ?? 0);
  const halfWidthMeters = widthMeters / 2;
  const lateralOffsetMeters = simUnitsToMeters(car.signedOffset ?? 0);

  return {
    lateralOffsetMeters,
    headingErrorRadians: car.trackHeadingError ?? 0,
    legalWidthMeters: widthMeters,
    leftBoundaryMeters: halfWidthMeters + lateralOffsetMeters,
    rightBoundaryMeters: halfWidthMeters - lateralOffsetMeters,
    onLegalSurface,
    surface: car.surface ?? 'track',
  };
}
