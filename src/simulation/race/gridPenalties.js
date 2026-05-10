import { pointAt, offsetTrackPoint } from '../track/trackModel.js';
import { applyWheelSurfaceState } from '../vehicle/wheelSurface.js';
import { getStartGridSlot } from '../vehicle/vehicleState.js';

export function applyGridDropForSimulation(simulation, driverId, positions) {
  const drop = Math.max(0, Math.floor(Number(positions) || 0));
  if (drop <= 0) return;

  const ordered = [...simulation.cars].sort((left, right) => {
    const delta = right.gridDistance - left.gridDistance;
    return delta === 0 ? left.index - right.index : delta;
  });
  const currentIndex = ordered.findIndex((car) => car.id === driverId);
  if (currentIndex < 0) return;
  const [car] = ordered.splice(currentIndex, 1);
  ordered.splice(Math.min(ordered.length, currentIndex + drop), 0, car);

  ordered.forEach((entry, index) => {
    const { gridDistance, gridOffset } = getStartGridSlot(index, { standingStart: true });
    const gridPoint = pointAt(simulation.track, gridDistance);
    const position = offsetTrackPoint(gridPoint, gridOffset);
    entry.gridDistance = gridDistance;
    entry.gridOffset = gridOffset;
    entry.rank = index + 1;
    if (entry.gridLocked) {
      entry.x = position.x;
      entry.y = position.y;
      entry.previousX = position.x;
      entry.previousY = position.y;
      entry.heading = gridPoint.heading;
      entry.previousHeading = gridPoint.heading;
      entry.progress = gridPoint.distance;
      entry.raceDistance = gridDistance;
      applyWheelSurfaceState(entry, simulation.track);
    }
  });
}
