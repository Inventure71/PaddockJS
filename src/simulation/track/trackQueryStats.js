export function createQueryStats() {
  return {
    nearestQueries: 0,
    nearestFallbacks: 0,
    hintDistanceCacheHits: 0,
    precomputedSegmentNeighborhoodHits: 0,
    nearestEmptyCellSkippedRings: 0,
    nearestIsolatedHintQueries: 0,
    nearestLowDensityHintQueries: 0,
    nearestLowDensityCellExactQueries: 0,
    nearestLowDensityCellDirectQueries: 0,
    nearestSparseGridExactQueries: 0,
    nearestRing2NeighborhoodExactQueries: 0,
    arcBucketRadius2PrecomputedQueries: 0,
    nearestPaths: {},
    nearestFallbackReasons: {
      'spatial-grid-no-candidates': 0,
    },
    hintedArcQueries: 0,
    hintedSegmentFastPathQueries: 0,
    hintedSegmentWideRadiusQueries: 0,
    hintedSegmentWideRadiusHits: 0,
    candidateProjectionObjectAllocations: 0,
    raySegmentObjectAllocations: 0,
    rayTraceCacheEntryAllocations: 0,
    hintedArcPaths: {},
    segmentNeighborhoodQueries: 0,
    segmentNeighborhoodBatchCalls: 0,
    segmentNeighborhoodPaths: {},
    runoffRadius1Queries: 0,
    runoffRadius2Queries: 0,
    pitQueries: 0,
    pitFallbacks: 0,
    pitConnectorEndpointWindowProjectionCalls: 0,
    pitConnectorFullRouteProjectionScans: 0,
    pitPaths: {},
    pitFallbackReasons: {},
  };
}

export function recordFallback(index, bucket, reason) {
  if (!index?.stats) return;
  if (bucket === 'nearestFallbackReasons') index.stats.nearestFallbacks += 1;
  if (bucket === 'pitFallbackReasons') index.stats.pitFallbacks += 1;
  recordStat(index, bucket, reason);
}

export function recordStat(index, bucket, key) {
  if (!index?.stats || !bucket || !key) return;
  const target = index.stats[bucket] ?? {};
  target[key] = (target[key] ?? 0) + 1;
  index.stats[bucket] = target;
}
