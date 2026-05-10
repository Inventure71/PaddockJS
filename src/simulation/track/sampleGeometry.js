import { normalizeAngle } from '../simMath.js';
import { distance } from './trackMath.js';

export function recalculateSampleGeometry(samples) {
  const usableCount = samples.length - 1;
  for (let index = 0; index < usableCount; index += 1) {
    const sample = samples[index];
    const previous = samples[(index - 1 + usableCount) % usableCount];
    const next = samples[(index + 1) % usableCount];
    const nextNext = samples[(index + 2) % usableCount];
    const heading = Math.atan2(next.y - previous.y, next.x - previous.x);
    const nextHeading = Math.atan2(nextNext.y - sample.y, nextNext.x - sample.x);
    sample.heading = heading;
    sample.normalX = -Math.sin(heading);
    sample.normalY = Math.cos(heading);
    sample.curvature = Math.abs(normalizeAngle(nextHeading - heading)) / 28;
  }

  samples[usableCount] = {
    ...samples[0],
    distance: samples[usableCount].distance,
  };

  return samples;
}

export function rebuildSampleDistances(samples) {
  const usable = samples.slice(0, -1).map((sample) => ({ ...sample }));
  let rebuiltLength = 0;

  usable.forEach((sample, index) => {
    if (index > 0) rebuiltLength += distance(usable[index - 1], sample);
    sample.distance = rebuiltLength;
  });

  rebuiltLength += distance(usable.at(-1), usable[0]);
  const rebuilt = [
    ...usable,
    {
      ...usable[0],
      distance: rebuiltLength,
    },
  ];

  return {
    samples: recalculateSampleGeometry(rebuilt),
    totalLength: rebuiltLength,
  };
}
