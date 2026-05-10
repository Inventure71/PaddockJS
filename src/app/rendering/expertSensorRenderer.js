import { getCarRayOrigin, getCarRayVector } from '../../environment/sensors.js';
import { metersToSimUnits } from '../../simulation/units.js';

const SENSOR_RAY_TRACK_COLOR = 0xf1c65b;
const SENSOR_RAY_TRACK_ENTRY_COLOR = 0x68d8ff;
const SENSOR_RAY_CAR_COLOR = 0xff4d5f;

function expertVisualizesRays(expertOptions) {
  const setting = expertOptions?.visualizeSensors;
  if (setting === true) return true;
  if (!setting || setting === false) return false;
  return Boolean(setting.rays);
}

function pointFromRay(origin, ray, distance) {
  return {
    x: origin.x + ray.x * distance,
    y: origin.y + ray.y * distance,
  };
}

export function renderExpertSensorRays({ snapshot, observation, sensorLayer, expertMode, expertOptions }) {
  if (!sensorLayer) return;
  sensorLayer.clear();
  if (!expertMode || !expertVisualizesRays(expertOptions)) return;

  const controlledDrivers = expertOptions?.controlledDrivers ?? [];
  if (!controlledDrivers.length || !observation) return;

  const carsById = new Map(snapshot.cars.map((car) => [car.id, car]));
  controlledDrivers.forEach((driverId) => {
    const car = carsById.get(driverId);
    const rays = observation?.[driverId]?.object?.rays;
    if (!car || !Array.isArray(rays) || rays.length === 0) return;

    const origin = getCarRayOrigin(car);

    rays.forEach((ray) => {
      const rayVector = getCarRayVector(car, Number(ray.angleDegrees) || 0);
      const totalDistanceMeters = Math.max(0, Number(ray.lengthMeters) || 0);
      const trackDistanceMeters = Math.max(0, Number(ray.track?.distanceMeters) || totalDistanceMeters);
      const carDistanceMeters = Math.max(0, Number(ray.car?.distanceMeters) || totalDistanceMeters);
      const trackHit = Boolean(ray.track?.hit) && trackDistanceMeters <= totalDistanceMeters;
      const carHit = Boolean(ray.car?.hit) && carDistanceMeters <= totalDistanceMeters;
      const fullEnd = pointFromRay(origin, rayVector, metersToSimUnits(totalDistanceMeters));

      sensorLayer
        .moveTo(origin.x, origin.y)
        .lineTo(fullEnd.x, fullEnd.y)
        .stroke({ width: 2, color: 0xffffff, alpha: 0.18, cap: 'round' });

      if (!trackHit && !carHit) return;

      const carIsClosest = carHit && (!trackHit || carDistanceMeters <= trackDistanceMeters);
      const hitDistanceMeters = carIsClosest ? carDistanceMeters : trackDistanceMeters;
      const hitEnd = pointFromRay(origin, rayVector, metersToSimUnits(hitDistanceMeters));
      const hitColor = carIsClosest
        ? SENSOR_RAY_CAR_COLOR
        : ray.track?.kind === 'entry'
          ? SENSOR_RAY_TRACK_ENTRY_COLOR
          : SENSOR_RAY_TRACK_COLOR;

      sensorLayer
        .moveTo(origin.x, origin.y)
        .lineTo(hitEnd.x, hitEnd.y)
        .stroke({ width: carIsClosest ? 5 : 3.4, color: hitColor, alpha: carIsClosest ? 0.9 : 0.76, cap: 'round' });
      sensorLayer
        .circle(hitEnd.x, hitEnd.y, carIsClosest ? 7 : 5)
        .fill({ color: hitColor, alpha: 0.92 })
        .circle(hitEnd.x, hitEnd.y, carIsClosest ? 10 : 8)
        .stroke({ width: 1.5, color: 0x10131a, alpha: 0.72 });
    });
  });
}
