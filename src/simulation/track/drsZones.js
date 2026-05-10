import { wrapDistance } from '../simMath.js';

export function normalizeDrsZone(zone, totalLength) {
  if (Number.isFinite(zone.start) && Number.isFinite(zone.end)) return zone;
  const start = zone.startRatio * totalLength;
  const rawEnd = zone.endRatio * totalLength;
  return {
    ...zone,
    start,
    end: rawEnd >= start ? rawEnd : rawEnd + totalLength,
  };
}

export function scoreStraightWindow(samples, startIndex, windowSize) {
  let curvature = 0;
  for (let offset = 0; offset < windowSize; offset += 1) {
    curvature += samples[(startIndex + offset) % (samples.length - 1)].curvature;
  }
  return curvature / windowSize;
}

export function deriveDrsZones(samples, totalLength) {
  const usableSampleCount = samples.length - 1;
  const windowSize = Math.max(96, Math.floor(usableSampleCount * 0.07));
  const candidates = [];

  for (let index = 0; index < usableSampleCount; index += Math.floor(windowSize / 2)) {
    const start = samples[index];
    const end = samples[(index + windowSize) % usableSampleCount];
    const distance = end.distance >= start.distance
      ? end.distance - start.distance
      : totalLength - start.distance + end.distance;
    if (distance < 360) continue;
    candidates.push({
      startRatio: start.distance / totalLength,
      endRatio: (start.distance + Math.min(distance, totalLength * 0.16)) / totalLength,
      score: scoreStraightWindow(samples, index, windowSize),
    });
  }

  return candidates
    .sort((a, b) => a.score - b.score)
    .reduce((zones, candidate) => {
      const farEnough = zones.every((zone) => Math.abs(zone.startRatio - candidate.startRatio) > 0.18);
      if (farEnough && zones.length < 3) {
        zones.push({
          id: `generated-drs-${zones.length + 1}`,
          startRatio: candidate.startRatio % 1,
          endRatio: candidate.endRatio % 1,
        });
      }
      return zones;
    }, [])
    .sort((a, b) => a.startRatio - b.startRatio);
}

export function isInDrsZone(track, progress) {
  const wrapped = wrapDistance(progress, track.length);
  return track.drsZones.some((zone) => {
    const start = wrapDistance(zone.start, track.length);
    const end = wrapDistance(zone.end, track.length);
    if (zone.end - zone.start >= track.length) return true;
    return end >= start
      ? wrapped >= start && wrapped <= end
      : wrapped >= start || wrapped <= end;
  });
}
