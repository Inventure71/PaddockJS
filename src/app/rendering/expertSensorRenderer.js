import { getCarRayOrigin, getCarRayVector } from '../../environment/sensors.js';
import { metersToSimUnits } from '../../simulation/units.js';

const SENSOR_RAY_TRACK_COLOR = 0xf1c65b;
const SENSOR_RAY_TRACK_ENTRY_COLOR = 0x68d8ff;
const SENSOR_RAY_CAR_COLOR = 0xff4d5f;
const SENSOR_RAY_KERB_COLOR = 0x49d17d;
const SENSOR_RAY_ILLEGAL_COLOR = 0xd946ef;
const SENSOR_RAY_MARKER_STROKE = 0x10131a;

const SENSOR_HIT_CHANNELS = Object.freeze([
  { key: 'track', radius: 5.8, alpha: 0.94 },
  { key: 'kerb', color: SENSOR_RAY_KERB_COLOR, radius: 4.6, alpha: 0.9 },
  { key: 'illegalSurface', color: SENSOR_RAY_ILLEGAL_COLOR, radius: 5.2, alpha: 0.92 },
  { key: 'car', color: SENSOR_RAY_CAR_COLOR, radius: 6.6, alpha: 0.96 },
]);

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

function clearSensorLayerIfRendered(sensorLayer) {
  if (!sensorLayer?.__paddockHasExpertSensorRays) return;
  sensorLayer.clear();
  sensorLayer.__paddockHasExpertSensorRays = false;
}

export function renderExpertSensorRays({ snapshot, observation, sensorLayer, expertMode, expertOptions }) {
  if (!sensorLayer) return;
  if (!expertMode || !expertVisualizesRays(expertOptions)) {
    clearSensorLayerIfRendered(sensorLayer);
    return;
  }

  const controlledDrivers = visualizedSensorDrivers(expertOptions);
  if (!controlledDrivers.length || !observation) {
    clearSensorLayerIfRendered(sensorLayer);
    return;
  }

  const carsById = new Map(snapshot.cars.map((car) => [car.id, car]));
  const drawableDrivers = controlledDrivers.filter((driverId) => {
    const car = carsById.get(driverId);
    const rays = observation?.[driverId]?.object?.rays;
    return Boolean(car && Array.isArray(rays) && rays.length > 0);
  });
  if (!drawableDrivers.length) {
    clearSensorLayerIfRendered(sensorLayer);
    return;
  }

  sensorLayer.clear();
  sensorLayer.__paddockHasExpertSensorRays = true;
  drawableDrivers.forEach((driverId) => {
    const car = carsById.get(driverId);
    const rays = observation?.[driverId]?.object?.rays;
    if (!car || !Array.isArray(rays) || rays.length === 0) return;

    const origin = getCarRayOrigin(car);

    rays.forEach((ray) => {
      const rayVector = getCarRayVector(car, Number(ray.angleDegrees) || 0);
      const totalDistanceMeters = Math.max(0, Number(ray.lengthMeters) || 0);
      const fullEnd = pointFromRay(origin, rayVector, metersToSimUnits(totalDistanceMeters));

      sensorLayer
        .moveTo(origin.x, origin.y)
        .lineTo(fullEnd.x, fullEnd.y)
        .stroke({ width: 2, color: 0xffffff, alpha: 0.18, cap: 'round' });

      rayHitMarkers(ray, totalDistanceMeters).forEach((marker) => {
        const hitEnd = pointFromRay(origin, rayVector, metersToSimUnits(marker.distanceMeters));
        sensorLayer
          .circle(hitEnd.x, hitEnd.y, marker.radius)
          .fill({ color: marker.color, alpha: marker.alpha })
          .stroke({ width: 1.4, color: SENSOR_RAY_MARKER_STROKE, alpha: 0.82 });
      });
    });
  });
}

function rayHitMarkers(ray, totalDistanceMeters) {
  return SENSOR_HIT_CHANNELS
    .map((channel) => {
      const hit = ray[channel.key];
      const distanceMeters = Math.max(0, Number(hit?.distanceMeters));
      if (!hit?.hit || !Number.isFinite(distanceMeters) || distanceMeters > totalDistanceMeters) return null;
      return {
        ...channel,
        distanceMeters,
        color: markerColor(channel, hit),
      };
    })
    .filter(Boolean);
}

function markerColor(channel, hit) {
  if (channel.key === 'track') {
    return hit.kind === 'entry' ? SENSOR_RAY_TRACK_ENTRY_COLOR : SENSOR_RAY_TRACK_COLOR;
  }
  return channel.color;
}

function visualizedSensorDrivers(expertOptions) {
  const controlledDrivers = expertOptions?.controlledDrivers ?? [];
  if (!controlledDrivers.length) return [];
  const setting = expertOptions?.visualizeSensors;
  if (setting && typeof setting === 'object') {
    if (Array.isArray(setting.drivers)) {
      return setting.drivers.filter((driverId) => controlledDrivers.includes(driverId));
    }
    if (setting.drivers === 'all') return controlledDrivers;
    if (controlledDrivers.includes(setting.selectedDriverId)) return [setting.selectedDriverId];
  }
  return [controlledDrivers[0]];
}
