export function createQueryStats() {
  return {
    nearestQueries: 0,
    nearestFallbacks: 0,
    nearestPaths: {},
    nearestFallbackReasons: {
      'spatial-grid-no-candidates': 0,
    },
    pitQueries: 0,
    pitFallbacks: 0,
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
