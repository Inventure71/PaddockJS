import { DEFAULT_RAY_ANGLES_DEGREES } from './rayDefaults.js';
import { RAY_CHANNELS } from './rayChannels.js';

const NORMALIZED_RAY_OPTIONS = Symbol('normalizedRayOptions');
const NORMALIZED_RAY_INPUTS = new WeakMap();

export { RAY_CHANNELS } from './rayChannels.js';

export const DEFAULT_RAY_LENGTH_METERS = 120;

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
  if (rayOptions?.[NORMALIZED_RAY_OPTIONS]) return rayOptions;
  const defaultLengthMeters = positiveNumber(
    rayOptions.defaultLengthMeters ?? rayOptions.lengthMeters,
    DEFAULT_RAY_LENGTH_METERS,
  );
  const rays = normalizeRays(rayOptions, defaultLengthMeters);
  const channels = normalizeRayChannels(rayOptions);
  const precision = RAY_PRECISION_MODES.includes(rayOptions.precision) ? rayOptions.precision : 'driver';
  const anglesDegrees = new Array(rays.length);
  let lengthMeters = rays.length ? 0 : defaultLengthMeters;
  for (let index = 0; index < rays.length; index += 1) {
    const ray = rays[index];
    anglesDegrees[index] = ray.angleDegrees;
    if (ray.lengthMeters > lengthMeters) lengthMeters = ray.lengthMeters;
  }
  let detectTrack = false;
  let detectCars = false;
  for (let index = 0; index < channels.length; index += 1) {
    const channel = channels[index];
    if (channel === 'roadEdge') detectTrack = true;
    else if (channel === 'car') detectCars = true;
  }

  const normalized = {
    ...rayOptions,
    enabled: rayOptions.enabled !== false,
    anglesDegrees,
    lengthMeters,
    defaultLengthMeters,
    rays,
    channels,
    precision,
    detectTrack,
    detectCars,
  };
  Object.defineProperty(normalized, NORMALIZED_RAY_OPTIONS, {
    value: true,
    enumerable: false,
  });
  NORMALIZED_RAY_INPUTS.set(normalized, copyRayOptionsInput(rayOptions));
  return normalized;
}

export function mergeRayOptionOverrides(baseRays = {}, overrides = {}) {
  const baseInput = NORMALIZED_RAY_INPUTS.get(baseRays) ?? baseRays;
  const overrideInput = NORMALIZED_RAY_INPUTS.get(overrides) ?? overrides;
  const requested = Object.fromEntries(Object.entries(overrideInput).filter(([, value]) => value !== undefined));
  const merged = { ...baseInput, ...requested };
  if (Object.hasOwn(requested, 'lengthMeters') && !Object.hasOwn(requested, 'defaultLengthMeters')) {
    delete merged.defaultLengthMeters;
  }
  if (Object.hasOwn(requested, 'rays')) return merged;
  if (Object.hasOwn(requested, 'layout') || Object.hasOwn(requested, 'anglesDegrees')) {
    delete merged.rays;
    if (Object.hasOwn(requested, 'anglesDegrees') && !Object.hasOwn(requested, 'layout')) delete merged.layout;
  }
  return merged;
}

function copyRayOptionsInput(source) {
  const input = { ...source };
  if (Array.isArray(source.rays)) input.rays = source.rays.map((ray) => typeof ray === 'object' && ray ? { ...ray } : ray);
  if (Array.isArray(source.anglesDegrees)) input.anglesDegrees = [...source.anglesDegrees];
  if (Array.isArray(source.channels)) input.channels = [...source.channels];
  return input;
}

function normalizeRays(rayOptions, defaultLengthMeters) {
  const configuredRays = Array.isArray(rayOptions.rays)
    ? rayOptions.rays
    : resolvePresetRays(rayOptions.layout);
  const source = configuredRays.length ? configuredRays : normalizeAngles(rayOptions.anglesDegrees);
  const rays = new Array(source.length);
  for (let index = 0; index < source.length; index += 1) {
    const ray = source[index];
    const angleDegrees = finiteNumber(
      typeof ray === 'number' ? ray : ray?.angleDegrees,
      DEFAULT_RAY_ANGLES_DEGREES[index % DEFAULT_RAY_ANGLES_DEGREES.length],
    );
    const lengthMeters = positiveNumber(
      typeof ray === 'object' ? ray.lengthMeters : null,
      defaultLengthMeters,
    );
    rays[index] = {
      id: typeof ray === 'object' && ray.id ? String(ray.id) : `ray-${index}`,
      angleDegrees,
      lengthMeters,
    };
  }
  return rays;
}

function resolvePresetRays(layout) {
  if (typeof layout !== 'string') return [];
  return RAY_LAYOUT_PRESETS[layout] ?? [];
}

function normalizeAngles(value) {
  if (!Array.isArray(value) || value.length === 0) return copyDefaultRayAngles();
  const angles = [];
  for (let index = 0; index < value.length; index += 1) {
    const angle = Number(value[index]);
    if (Number.isFinite(angle)) angles.push(angle);
  }
  return angles.length ? angles : copyDefaultRayAngles();
}

function normalizeRayChannels(rayOptions) {
  if (Array.isArray(rayOptions.channels) && rayOptions.channels.length) {
    const channels = [];
    for (let index = 0; index < rayOptions.channels.length; index += 1) {
      const channel = rayOptions.channels[index];
      if (!isKnownRayChannel(channel) || hasChannel(channels, channel)) continue;
      channels.push(channel);
    }
    if (channels.length) return channels;
  }

  const channels = [];
  if (rayOptions.detectTrack !== false) channels.push('roadEdge');
  if (rayOptions.detectCars !== false) channels.push('car');
  return channels;
}

function isKnownRayChannel(channel) {
  for (let index = 0; index < RAY_CHANNELS.length; index += 1) {
    if (RAY_CHANNELS[index] === channel) return true;
  }
  return false;
}

function hasChannel(channels, channel) {
  for (let index = 0; index < channels.length; index += 1) {
    if (channels[index] === channel) return true;
  }
  return false;
}

function copyDefaultRayAngles() {
  const angles = new Array(DEFAULT_RAY_ANGLES_DEGREES.length);
  for (let index = 0; index < DEFAULT_RAY_ANGLES_DEGREES.length; index += 1) {
    angles[index] = DEFAULT_RAY_ANGLES_DEGREES[index];
  }
  return angles;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
