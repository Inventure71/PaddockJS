import { createSurfaceMiss } from './surfaceRays.js';

export function writeRichRay(target, ray, angleRadians, roadEdge, carHit, surfaceHits, channels) {
  target.id = ray.id;
  target.angleDegrees = ray.angleDegrees;
  target.angleRadians = angleRadians;
  target.lengthMeters = ray.lengthMeters;
  target.roadEdge = writeTrackRayHit(target.roadEdge ?? {}, roadEdge);
  target.track = target.roadEdge;
  target.kerb = channels.hasKerb
    ? writeSurfaceRayHit(target.kerb ?? {}, surfaceHits.kerb ?? createSurfaceMiss(ray.lengthMeters))
    : writeSurfaceRayHit(target.kerb ?? {}, createSurfaceMiss(ray.lengthMeters));
  target.illegalSurface = channels.hasIllegalSurface
    ? writeSurfaceRayHit(target.illegalSurface ?? {}, surfaceHits.illegalSurface ?? createSurfaceMiss(ray.lengthMeters))
    : writeSurfaceRayHit(target.illegalSurface ?? {}, createSurfaceMiss(ray.lengthMeters));
  target.car = writeCarRayHit(target.car ?? {}, carHit);
  return target;
}

function writeTrackRayHit(target, source) {
  target.hit = Boolean(source?.hit);
  target.distanceMeters = source?.distanceMeters;
  target.kind = source?.kind ?? null;
  return target;
}

function writeSurfaceRayHit(target, source) {
  target.hit = Boolean(source?.hit);
  target.distanceMeters = source?.distanceMeters;
  target.surface = source?.surface ?? null;
  return target;
}

function writeCarRayHit(target, source) {
  target.hit = Boolean(source?.hit);
  target.distanceMeters = source?.distanceMeters;
  target.driverId = source?.driverId ?? null;
  target.targetId = source?.targetId ?? null;
  target.targetType = source?.targetType ?? null;
  target.relativeSpeedKph = source?.relativeSpeedKph ?? 0;
  return target;
}

export function writeRayVectorValues(values, lengthMeters, roadEdge, carHit, surfaceHits, surfaceChannels) {
  values.length = 0;
  appendRayVectorValues(values, lengthMeters, roadEdge, carHit, surfaceHits, surfaceChannels);
  return values;
}

export function appendRayVectorValues(values, lengthMeters, roadEdge, carHit, surfaceHits, surfaceChannels) {
  values.push(
    ratio(roadEdge.distanceMeters, lengthMeters),
    roadEdge.hit ? 1 : 0,
    roadEdge.kind === 'exit' ? 1 : 0,
    roadEdge.kind === 'entry' ? 1 : 0,
    ratio(carHit.distanceMeters, lengthMeters),
    carHit.hit ? 1 : 0,
    carHit.relativeSpeedKph / 200,
    carHit.targetType === 'replayGhost' ? 1 : 0,
  );
  for (let index = 0; index < surfaceChannels.length; index += 1) {
    const channel = surfaceChannels[index];
    const hit = surfaceHits[channel] ?? createSurfaceMiss(lengthMeters);
    values.push(
      ratio(hit.distanceMeters, lengthMeters),
      hit.hit ? 1 : 0,
    );
  }
  return values;
}

function ratio(value, max) {
  const finite = Number.isFinite(value) ? value : max;
  return Math.max(0, Math.min(1, finite / Math.max(1e-9, max)));
}
