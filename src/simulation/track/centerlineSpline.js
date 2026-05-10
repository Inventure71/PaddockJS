import { distance } from './trackMath.js';
import { CENTERLINE_CONTROLS } from './trackConstants.js';

export function uniformCatmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: 0.5 * (
      (2 * p1.x) +
      (-p0.x + p2.x) * t +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
    ),
    y: 0.5 * (
      (2 * p1.y) +
      (-p0.y + p2.y) * t +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
    ),
  };
}

export function centripetalCatmullRom(p0, p1, p2, p3, t) {
  const t0 = 0;
  const t1 = t0 + Math.sqrt(Math.max(distance(p0, p1), 0.001));
  const t2 = t1 + Math.sqrt(Math.max(distance(p1, p2), 0.001));
  const t3 = t2 + Math.sqrt(Math.max(distance(p2, p3), 0.001));
  const localT = t1 + (t2 - t1) * t;

  const interpolate = (a, b, start, end) => {
    const span = Math.max(end - start, 0.001);
    const amount = (localT - start) / span;
    return {
      x: a.x + (b.x - a.x) * amount,
      y: a.y + (b.y - a.y) * amount,
    };
  };

  const a1 = interpolate(p0, p1, t0, t1);
  const a2 = interpolate(p1, p2, t1, t2);
  const a3 = interpolate(p2, p3, t2, t3);
  const b1 = interpolate(a1, a2, t0, t2);
  const b2 = interpolate(a2, a3, t1, t3);
  return interpolate(b1, b2, t1, t2);
}

export function rawCenterPoint(ratio, controls = CENTERLINE_CONTROLS, interpolation = 'uniform') {
  const count = controls.length;
  const scaled = ratio * count;
  const index = Math.floor(scaled) % count;
  const localT = scaled - Math.floor(scaled);
  const p0 = controls[(index - 1 + count) % count];
  const p1 = controls[index];
  const p2 = controls[(index + 1) % count];
  const p3 = controls[(index + 2) % count];
  return interpolation === 'centripetal'
    ? centripetalCatmullRom(p0, p1, p2, p3, localT)
    : uniformCatmullRom(p0, p1, p2, p3, localT);
}
