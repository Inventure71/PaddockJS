import { DEFAULT_RAY_ANGLES_DEGREES } from './rayDefaults.js';

export const DEFAULT_RAY_LENGTH_METERS = 120;

export const RAY_CHANNELS = Object.freeze([
  'roadEdge',
  'kerb',
  'illegalSurface',
  'car',
]);

export const RAY_PRECISION_MODES = Object.freeze(['driver', 'debug']);

export const RAY_LAYOUT_PRESETS = Object.freeze({
  compact: DEFAULT_RAY_ANGLES_DEGREES.map((angleDegrees) => ({ angleDegrees })),
  'driver-front-heavy': [
    -140, -100, -70, -50, -35, -20, -10, 0, 10, 20, 35, 50, 70, 100, 140, 180,
  ].map((angleDegrees) => ({
    angleDegrees,
    lengthMeters: Math.abs(angleDegrees) <= 70 ? 240 : Math.abs(angleDegrees) <= 100 ? 90 : 60,
  })),
  'lidar-lite': Array.from({ length: 25 }, (_, index) => ({
    angleDegrees: -120 + index * 10,
    lengthMeters: Math.abs(-120 + index * 10) <= 70 ? 260 : 100,
  })),
});

export function normalizeRayOptions(rayOptions = {}) {
  const defaultLengthMeters = positiveNumber(
    rayOptions.defaultLengthMeters ?? rayOptions.lengthMeters,
    DEFAULT_RAY_LENGTH_METERS,
  );
  const rays = normalizeRays(rayOptions, defaultLengthMeters);
  const channels = normalizeRayChannels(rayOptions);
  const precision = RAY_PRECISION_MODES.includes(rayOptions.precision) ? rayOptions.precision : 'driver';
  const anglesDegrees = rays.map((ray) => ray.angleDegrees);
  const lengthMeters = rays.length ? Math.max(...rays.map((ray) => ray.lengthMeters)) : defaultLengthMeters;

  return {
    ...rayOptions,
    enabled: rayOptions.enabled !== false,
    anglesDegrees,
    lengthMeters,
    defaultLengthMeters,
    rays,
    channels,
    precision,
    detectTrack: channels.includes('roadEdge'),
    detectCars: channels.includes('car'),
  };
}

function normalizeRays(rayOptions, defaultLengthMeters) {
  const configuredRays = Array.isArray(rayOptions.rays)
    ? rayOptions.rays
    : resolvePresetRays(rayOptions.layout);
  const source = configuredRays.length
    ? configuredRays
    : normalizeAngles(rayOptions.anglesDegrees).map((angleDegrees) => ({ angleDegrees }));

  return source.map((ray, index) => {
    const angleDegrees = finiteNumber(
      typeof ray === 'number' ? ray : ray?.angleDegrees,
      DEFAULT_RAY_ANGLES_DEGREES[index % DEFAULT_RAY_ANGLES_DEGREES.length],
    );
    const lengthMeters = positiveNumber(
      typeof ray === 'object' ? ray.lengthMeters : null,
      defaultLengthMeters,
    );
    return {
      id: typeof ray === 'object' && ray.id ? String(ray.id) : `ray-${index}`,
      angleDegrees,
      lengthMeters,
    };
  });
}

function resolvePresetRays(layout) {
  if (typeof layout !== 'string') return [];
  return RAY_LAYOUT_PRESETS[layout] ?? [];
}

function normalizeAngles(value) {
  if (!Array.isArray(value) || value.length === 0) return [...DEFAULT_RAY_ANGLES_DEGREES];
  const angles = value.map((angle) => Number(angle)).filter((angle) => Number.isFinite(angle));
  return angles.length ? angles : [...DEFAULT_RAY_ANGLES_DEGREES];
}

function normalizeRayChannels(rayOptions) {
  if (Array.isArray(rayOptions.channels) && rayOptions.channels.length) {
    const channelSet = new Set(RAY_CHANNELS);
    const channels = rayOptions.channels.filter((channel) => channelSet.has(channel));
    if (channels.length) return [...new Set(channels)];
  }

  const channels = [];
  if (rayOptions.detectTrack !== false) channels.push('roadEdge');
  if (rayOptions.detectCars !== false) channels.push('car');
  return channels;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
