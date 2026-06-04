export function createQueryScratch(index) {
  const segmentCount = Math.max(0, index?.centerline?.segmentCount ?? 0);
  const maxId = Math.max(
    segmentCount,
    index?.pit?.roadSegments?.length ?? 0,
    index?.pit?.boxCandidates?.length ?? 0,
  );
  const grid = index?.segmentGrid ?? index?.grid;
  const cellCount = Math.max(0, (grid?.columns ?? 0) * (grid?.rows ?? 0));
  return {
    candidateMarks: new Uint32Array(Math.max(1, maxId)),
    candidateEpoch: 1,
    sampleMarks: new Uint32Array(Math.max(1, segmentCount)),
    sampleEpoch: 1,
    raySegmentMarks: new Uint32Array(Math.max(1, segmentCount)),
    raySegmentEpoch: 1,
    rayCellMarks: new Uint32Array(Math.max(1, cellCount)),
    rayCellEpoch: 1,
    raySegmentIds: [],
    rayVisitedCells: [],
    rayTracePoint: { x: 0, y: 0 },
    rayTraceCache: new Map(),
    hintDistanceCacheDistance: Number.NaN,
    hintDistanceCacheWrappedDistance: Number.NaN,
    hintDistanceCacheSegmentId: -1,
    hintDistanceCachePointX: Number.NaN,
    hintDistanceCachePointY: Number.NaN,
    segmentNeighborhoodProjection: {},
  };
}

export function ensureQueryScratch(index) {
  if (index.queryScratch) return index.queryScratch;
  index.queryScratch = createQueryScratch(index);
  return index.queryScratch;
}

export function ensureScratchArray(scratch, key, minimumLength) {
  if (!scratch[key] || scratch[key].length < minimumLength) {
    scratch[key] = new Uint32Array(Math.max(1, minimumLength));
  }
  return scratch[key];
}

export function nextScratchEpoch(scratch, key, marks) {
  let epoch = (scratch[key] ?? 0) + 1;
  if (epoch >= 0xFFFFFFFF) {
    marks.fill(0);
    epoch = 1;
  }
  scratch[key] = epoch;
  return epoch;
}
