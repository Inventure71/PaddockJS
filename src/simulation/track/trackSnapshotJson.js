const TRACK_JSON_CACHE = new WeakMap();
const MAX_JSON_SAMPLES = 320;
const TRACK_SAMPLE_SCHEMA = Object.freeze([
  'x',
  'y',
  'distance',
  'heading',
  'normalX',
  'normalY',
  'curvature',
]);

const OMIT_JSON_KEYS = new Set([
  'bounds',
  'boxBounds',
  'connectorBounds',
  'pitCrew',
]);

const HIGH_PRECISION_JSON_KEYS = new Set([
  'heading',
  'normalX',
  'normalY',
  'curvature',
  'startRatio',
  'endRatio',
]);

export function attachTrackSnapshotJsonSerializer(track) {
  if (!track || typeof track !== 'object') return track;
  Object.defineProperty(track, 'toJSON', {
    configurable: true,
    enumerable: false,
    value: trackSnapshotToJson,
    writable: false,
  });
  return track;
}

export function serializeTrackSnapshotJson(track) {
  if (!track || typeof track !== 'object') return track;
  const cached = TRACK_JSON_CACHE.get(track);
  if (cached) return cached;
  const serialized = cloneTrackJsonValue(track);
  TRACK_JSON_CACHE.set(track, serialized);
  return serialized;
}

function trackSnapshotToJson() {
  return serializeTrackSnapshotJson(this);
}

function cloneTrackJsonValue(value, key = null) {
  if (typeof value === 'number') return roundTrackJsonNumber(key, value);
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    if (key === 'samples') return cloneTrackSamples(value);
    return value.map((entry) => cloneTrackJsonValue(entry));
  }
  if (key === 'pitLane') return clonePitLaneJson(value);

  const clone = {};
  Object.entries(value).forEach(([childKey, childValue]) => {
    if (OMIT_JSON_KEYS.has(childKey)) return;
    clone[childKey] = cloneTrackJsonValue(childValue, childKey);
  });
  if (key == null && Array.isArray(clone.samples)) clone.sampleSchema = TRACK_SAMPLE_SCHEMA;
  return clone;
}

function cloneTrackSamples(samples) {
  if (samples.length <= MAX_JSON_SAMPLES) {
    return samples.map((entry) => serializeTrackSample(entry));
  }
  const lastIndex = samples.length - 1;
  const stride = Math.max(1, Math.ceil(lastIndex / (MAX_JSON_SAMPLES - 1)));
  const decimated = [];
  for (let index = 0; index < lastIndex; index += stride) {
    decimated.push(serializeTrackSample(samples[index]));
  }
  const lastSample = serializeTrackSample(samples[lastIndex]);
  if (!decimated.length || decimated[decimated.length - 1]?.[2] !== lastSample?.[2]) {
    decimated.push(lastSample);
  }
  return decimated;
}

function serializeTrackSample(sample) {
  return [
    roundTrackJsonNumber('x', sample?.x),
    roundTrackJsonNumber('y', sample?.y),
    roundTrackJsonNumber('distance', sample?.distance),
    roundTrackJsonNumber('heading', sample?.heading),
    roundTrackJsonNumber('normalX', sample?.normalX),
    roundTrackJsonNumber('normalY', sample?.normalY),
    roundTrackJsonNumber('curvature', sample?.curvature),
  ];
}

function clonePitLaneJson(pitLane) {
  const clone = {};
  Object.entries(pitLane).forEach(([childKey, childValue]) => {
    if (OMIT_JSON_KEYS.has(childKey)) return;
    if (childKey === 'boxes') {
      clone.boxes = childValue.map(clonePitBoxJson);
      return;
    }
    if (childKey === 'serviceAreas') {
      clone.serviceAreas = childValue.map(clonePitServiceAreaJson);
      return;
    }
    clone[childKey] = cloneTrackJsonValue(childValue, childKey);
  });
  return clone;
}

function clonePitBoxJson(box) {
  const clone = {};
  Object.entries(box).forEach(([childKey, childValue]) => {
    if (childKey === 'teamId' || childKey === 'teamName' || childKey === 'teamColor') return;
    clone[childKey] = cloneTrackJsonValue(childValue, childKey);
  });
  return clone;
}

function clonePitServiceAreaJson(area) {
  const clone = {};
  Object.entries(area).forEach(([childKey, childValue]) => {
    if (childKey === 'teamId' || childKey === 'teamName' || childKey === 'teamColor') return;
    clone[childKey] = cloneTrackJsonValue(childValue, childKey);
  });
  return clone;
}

function roundTrackJsonNumber(key, value) {
  if (!Number.isFinite(value)) return value;
  const precision = HIGH_PRECISION_JSON_KEYS.has(key) ? 1_000_000 : 1_000;
  return Math.round(value * precision) / precision;
}
