import { clamp, wrapDistance } from '../simMath.js';
import { metersToSimUnits } from '../units.js';
import {
  candidateIdsFromGrid,
  candidateIdsFromGridBounds,
  createSpatialGrid,
  gridCellForPoint,
  insertIdIntoGridBounds,
} from './trackQueryGrid.js';
import { createPitQueryIndex } from './trackQueryPitIndex.js';
import { createQueryScratch, ensureQueryScratch, ensureScratchArray, nextScratchEpoch } from './trackQueryScratch.js';
import { createQueryStats, recordFallback, recordStat } from './trackQueryStats.js';

export {
  queryPitBoxCandidates,
  queryPitRoadSegmentCandidates,
  queryPitRoadSegmentCandidatesByRoute,
} from './trackQueryPitIndex.js';

const DEFAULT_GRID_CELL_SIZE = metersToSimUnits(32);
const GRID_NEIGHBOR_LIMIT = 2;
const ARC_BUCKET_COUNT = 512;
const AMBIGUOUS_DISTANCE_EPSILON = 1e-6;
const RAY_TRACE_BUCKET_DEGREES = 10;
const HINTED_RUNOFF_WIDE_SEGMENT_RADIUS = 20;
const PRECOMPUTED_SEGMENT_NEIGHBORHOOD_RADII = new Set([2, HINTED_RUNOFF_WIDE_SEGMENT_RADIUS]);
const LOW_DENSITY_HINT_RING1_SEGMENT_THRESHOLD = 158;

export function createTrackQueryIndex(track) {
  const samples = Array.isArray(track.samples) ? track.samples : [];
  const segmentCount = Math.max(0, samples.length - 1);
  const bands = createTrackBands(track);
  const expansion = bands.runoffEdge + (track.barrierWidth ?? 0) + metersToSimUnits(64);
  const bounds = expandedSampleBounds(samples, expansion);
  const centerline = createCenterlineSegments(samples, segmentCount);
  centerline.precomputedNeighborhoodsByRadius = createPrecomputedSegmentNeighborhoods(segmentCount, PRECOMPUTED_SEGMENT_NEIGHBORHOOD_RADII);
  const grid = createSpatialGrid(bounds, DEFAULT_GRID_CELL_SIZE);
  const segmentGrid = createSpatialGrid(bounds, DEFAULT_GRID_CELL_SIZE);
  const arcBuckets = createArcBuckets(track.length, ARC_BUCKET_COUNT);

  for (let segmentId = 0; segmentId < segmentCount; segmentId += 1) {
    insertSegmentIntoGrid(grid, centerline, segmentId, expansion);
    insertSegmentIntoGrid(segmentGrid, centerline, segmentId, 0);
    insertSegmentIntoArcBuckets(arcBuckets, centerline, segmentId);
  }
  finalizeArcBuckets(arcBuckets, segmentCount);

  const lowDensityHintRing1Neighborhood = createLowDensityHintRing1Neighborhood(centerline, segmentGrid, LOW_DENSITY_HINT_RING1_SEGMENT_THRESHOLD);
  const index = {
    version: 1,
    bands,
    nearestGridExpansion: expansion,
    centerline,
    grid,
    segmentGrid,
    arcBuckets,
    nearestOccupiedCellRadiusByCell: createNearestOccupiedCellRadiusByCell(segmentGrid),
    nearestNonLocalHintDistanceSquared: createNearestNonLocalHintDistanceSquared(centerline, segmentGrid, bands.kerbEdge * 2),
    lowDensityHintRing1SegmentCounts: lowDensityHintRing1Neighborhood.counts,
    lowDensityHintRing1CandidateIdsByCell: lowDensityHintRing1Neighborhood.candidateIdsByCell,
    pit: createPitQueryIndex(track, grid.cellSize),
    stats: createQueryStats(),
  };
  attachQueryStatsToCenterline(centerline, index.stats);
  index.queryScratch = createQueryScratch(index);
  return index;
}

export function queryNearestTrackProjection(track, position, progressHint = null) {
  return queryNearestTrackProjectionInto(track, position, progressHint);
}

export function queryNearestTrackProjectionInto(track, position, progressHint = null, target = null) {
  const index = track?.queryIndex;
  if (!index?.centerline?.segmentCount) {
    recordFallback(index, 'nearestFallbackReasons', 'missing-index');
    return null;
  }
  if (!finitePoint(position)) {
    recordFallback(index, 'nearestFallbackReasons', 'invalid-position');
    return null;
  }
  index.stats.nearestQueries += 1;

  const { projection, path, reason } = bestProjectionFromIndex(index, position, progressHint, target);
  if (!projection) {
    recordFallback(index, 'nearestFallbackReasons', reason ?? 'unknown');
    return null;
  }

  recordStat(index, 'nearestPaths', path);
  return projection;
}

export function queryHintedTrackProjection(track, position, progressHint, { radius = 2 } = {}) {
  const index = track?.queryIndex;
  if (!index?.centerline?.segmentCount || !finitePoint(position) || !Number.isFinite(progressHint)) return null;
  const local = bestProjectionFromHintedSegmentNeighborhood(
    index,
    progressHint,
    Math.max(0, Math.floor(radius)),
    position,
    progressHint,
  );
  if (local.projection && local.projection.crossTrackError <= index.bands.gravelEdge) {
    index.stats.hintedSegmentFastPathQueries += 1;
    recordStat(index, 'hintedArcPaths', local.reason === 'tie-resolved' ? 'segment-hint-local-tie-resolved' : 'segment-hint-local');
    return local.projection;
  }
  if (local.projection) {
    index.stats.hintedSegmentWideRadiusQueries += 1;
    const refined = bestProjectionFromHintedSegmentNeighborhood(
      index,
      progressHint,
      HINTED_RUNOFF_WIDE_SEGMENT_RADIUS,
      position,
      progressHint,
    );
    if (refined.projection) {
      if (!projectionMatches(local.projection, refined.projection)) {
        index.stats.hintedSegmentWideRadiusHits += 1;
      }
      recordStat(
        index,
        'hintedArcPaths',
        refined.reason === 'tie-resolved' ? 'segment-hint-runoff-wide-radius-tie-resolved' : 'segment-hint-runoff-wide-radius',
      );
      return refined.projection;
    }
  }
  const { projection, reason } = bestProjectionFromArcBuckets(
    index,
    progressHint,
    Math.max(0, Math.floor(radius)),
    position,
    progressHint,
  );
  if (!projection) return null;
  index.stats.hintedArcQueries += 1;
  recordStat(index, 'hintedArcPaths', reason === 'tie-resolved' ? 'arc-hint-local-tie-resolved' : 'arc-hint-local');
  return projection;
}

export function querySegmentNeighborhoodProjection(
  track,
  position,
  segmentId,
  { radius = 3, preferredDistance = null, target = null } = {},
) {
  const index = track?.queryIndex;
  if (!index?.centerline?.segmentCount || !finitePoint(position) || !Number.isInteger(segmentId)) return null;
  const { projection, reason } = bestProjectionFromSegmentNeighborhood(
    index.centerline,
    segmentId,
    Math.max(0, Math.floor(radius)),
    position,
    preferredDistance,
    target,
  );
  if (!projection) return null;
  index.stats.segmentNeighborhoodQueries += 1;
  recordStat(
    index,
    'segmentNeighborhoodPaths',
    reason === 'tie-resolved' ? 'segment-neighborhood-tie-resolved' : 'segment-neighborhood',
  );
  return projection;
}

export function querySegmentNeighborhoodProjections(
  track,
  positions,
  segmentId,
  { radius = 3, preferredDistance = null, target = null } = {},
) {
  const index = track?.queryIndex;
  if (!index?.centerline?.segmentCount || !Array.isArray(positions) || !Number.isInteger(segmentId)) return null;
  index.stats.segmentNeighborhoodBatchCalls += 1;
  const projections = target ?? new Array(positions.length);
  const tieResolvedFlags = bestProjectionBatchFromSegmentNeighborhood(
    index,
    positions,
    segmentId,
    Math.max(0, Math.floor(radius)),
    preferredDistance,
    projections,
  );
  for (let indexPosition = 0; indexPosition < positions.length; indexPosition += 1) {
    const projection = projections[indexPosition];
    if (!projection) continue;
    index.stats.segmentNeighborhoodQueries += 1;
    recordStat(
      index,
      'segmentNeighborhoodPaths',
      tieResolvedFlags[indexPosition] ? 'segment-neighborhood-tie-resolved' : 'segment-neighborhood',
    );
  }
  return projections;
}

function bestProjectionFromIndex(index, position, progressHint, target = null) {
  if (Number.isFinite(progressHint)) {
    const isolatedHint = bestProjectionFromHintedSegmentNeighborhood(
      index,
      progressHint,
      2,
      position,
      progressHint,
      target,
    );
    if (
      isolatedHint.projection &&
      isolatedHint.projection.crossTrackError <= index.bands.kerbEdge &&
      hintedQueryStaysInLocalCorridor(index, position, progressHint, index.bands.kerbEdge)
    ) {
      if (isHintProjectionDistanceSafe(index, isolatedHint.projection)) {
        index.stats.nearestIsolatedHintQueries += 1;
        return {
          projection: isolatedHint.projection,
          path: isolatedHint.reason === 'tie-resolved' ? 'segment-hint-distance-gated-tie-resolved' : 'segment-hint-distance-gated',
        };
      }
      if (isHintProjectionLowDensitySafe(index, position)) {
        index.stats.nearestLowDensityHintQueries += 1;
        return {
          projection: isolatedHint.projection,
          path: isolatedHint.reason === 'tie-resolved' ? 'segment-hint-density-gated-tie-resolved' : 'segment-hint-density-gated',
        };
      }
    }
    const lowDensityExact = bestProjectionFromLowDensityCellNeighborhood(index, position, progressHint, target);
    if (lowDensityExact.projection) {
      index.stats.nearestLowDensityCellExactQueries += 1;
      index.stats.nearestLowDensityCellDirectQueries += 1;
      return {
        projection: lowDensityExact.projection,
        path: lowDensityExact.reason === 'tie-resolved'
          ? 'low-density-cell-exact-tie-resolved'
          : 'low-density-cell-exact',
      };
    }
    if (!hintedQueryStaysInLocalCorridor(index, position, progressHint, index.bands.runoffEdge)) {
      const sparseExact = bestProjectionFromCellSearch(index, position, progressHint, null, target);
      if (sparseExact.projection) {
        index.stats.nearestSparseGridExactQueries += 1;
        return {
          projection: sparseExact.projection,
          path: sparseExact.reason === 'tie-resolved'
            ? 'sparse-grid-exact-tie-resolved'
            : 'sparse-grid-exact',
        };
      }
    }

    const hinted = bestProjectionFromArcBuckets(index, progressHint, 2, position, progressHint, target);
    if (hinted.projection) {
      let initialProjection = hinted.projection;
      if (
        hinted.projection.crossTrackError > index.bands.gravelEdge &&
        hinted.projection.crossTrackError <= index.bands.runoffEdge + AMBIGUOUS_DISTANCE_EPSILON
      ) {
        // Runoff-adjacent accurate-hint queries often converge inside the local radius-2 segment
        // neighborhood; ring-3 cell lower bounds are enough to prove no outside segment can tie or beat it.
        const ring2NeighborhoodExact = bestProjectionFromRing2Neighborhood(index, position, progressHint, target);
        if (ring2NeighborhoodExact.projection) {
          index.stats.nearestRing2NeighborhoodExactQueries += 1;
          return {
            projection: ring2NeighborhoodExact.projection,
            path: ring2NeighborhoodExact.reason === 'tie-resolved'
              ? 'arc-hint-ring2-neighborhood-exact-tie-resolved'
              : 'arc-hint-ring2-neighborhood-exact',
          };
        }
        if (ring2NeighborhoodExact.bestProjection) {
          initialProjection = ring2NeighborhoodExact.bestProjection;
        }
      }
      const exact = bestProjectionFromCellSearch(index, position, progressHint, initialProjection);
      if (exact.projection) {
        const path = projectionMatches(hinted.projection, exact.projection)
          ? (hinted.reason === 'tie-resolved' ? 'arc-hint-tie-resolved' : 'arc-hint')
          : 'arc-hint-refined';
        return {
          projection: exact.projection,
          path: exact.reason === 'tie-resolved' && !path.endsWith('tie-resolved') ? `${path}-tie-resolved` : path,
        };
      }
    }
  }

  let local = { projection: null, path: null };
  const gridCandidateIds = candidateIdsFromGrid(index, index.grid, position, GRID_NEIGHBOR_LIMIT);
  const grid = bestProjectionFromCandidates(index.centerline, gridCandidateIds, position, progressHint, target);
  if (grid.projection) {
    local = chooseBetterProjectionResult(local, grid, 'spatial-grid', progressHint);
    if (grid.projection.distanceSquared <= index.nearestGridExpansion * index.nearestGridExpansion) {
      return local;
    }
  }

  if (local.projection) {
    const exact = bestProjectionFromCellSearch(index, position, progressHint, local.projection);
    if (exact.projection) {
      const path = projectionMatches(local.projection, exact.projection)
        ? local.path
        : `${local.path}-refined`;
      return {
        projection: exact.projection,
        path: exact.reason === 'tie-resolved' && !path.endsWith('tie-resolved') ? `${path}-tie-resolved` : path,
      };
    }

    return {
      projection: local.projection,
      path: local.path,
    };
  }

  const exact = bestProjectionFromCellSearch(index, position, progressHint);
  const global = exact.projection ? exact : bestProjectionFromAllSegments(index.centerline, position, progressHint, target);
  return global.projection
    ? {
      projection: global.projection,
      path: exact.projection
        ? (global.reason === 'tie-resolved' ? 'exact-grid-tie-resolved' : 'exact-grid')
        : (global.reason === 'tie-resolved' ? 'global-index-tie-resolved' : 'global-index'),
    }
    : { projection: null, reason: `global-index-${global.reason}` };
}

function chooseBetterProjectionResult(current, candidate, source, preferredDistance) {
  if (!candidate.projection) return current;
  const path = candidate.reason === 'tie-resolved' ? `${source}-tie-resolved` : source;
  if (!current.projection) return { projection: candidate.projection, path };
  if (candidate.projection.distanceSquared < current.projection.distanceSquared - AMBIGUOUS_DISTANCE_EPSILON) {
    return { projection: candidate.projection, path };
  }
  if (Math.abs(candidate.projection.distanceSquared - current.projection.distanceSquared) <= AMBIGUOUS_DISTANCE_EPSILON) {
    const candidateTie = projectionTieScore(candidate.projection, preferredDistance);
    const currentTie = projectionTieScore(current.projection, preferredDistance);
    if (projectionTieBeats(candidate.projection, candidateTie, current.projection, currentTie)) {
      return { projection: candidate.projection, path: `${path}-tie-resolved` };
    }
  }
  return current;
}

function bestProjectionFromCellSearch(index, position, preferredDistance, initialProjection = null, target = null) {
  const grid = index.segmentGrid ?? index.grid;
  const center = gridCellForPoint(grid, position, true);
  const startCellIndex = center.row * grid.columns + center.column;
  const startRadius = index.nearestOccupiedCellRadiusByCell?.[startCellIndex] ?? 0;
  if (startRadius > 0) {
    index.stats.nearestEmptyCellSkippedRings += startRadius;
  }

  const scratch = ensureQueryScratch(index);
  const segmentMarks = ensureScratchArray(scratch, 'exactSegmentMarks', index.centerline.segmentCount);
  const cellMarks = ensureScratchArray(scratch, 'exactCellMarks', grid.columns * grid.rows);
  const segmentEpoch = nextScratchEpoch(scratch, 'exactSegmentEpoch', segmentMarks);
  const cellEpoch = nextScratchEpoch(scratch, 'exactCellEpoch', cellMarks);
  const maxRadius = Math.max(grid.columns, grid.rows);
  let bestSegmentId = initialProjection?.segmentId ?? null;
  let bestX = initialProjection?.x ?? 0;
  let bestY = initialProjection?.y ?? 0;
  let bestDistance = initialProjection?.distance ?? 0;
  let bestHeading = initialProjection?.heading ?? 0;
  let bestNormalX = initialProjection?.normalX ?? 0;
  let bestNormalY = initialProjection?.normalY ?? 0;
  let bestCurvature = initialProjection?.curvature ?? 0;
  let bestSignedOffset = initialProjection?.signedOffset ?? 0;
  let bestDistanceSquared = initialProjection?.distanceSquared ?? Infinity;
  let bestTieScore = initialProjection ? projectionTieScore(initialProjection, preferredDistance) : Infinity;
  let secondBestDistance = Infinity;
  let tieResolved = false;
  if (Number.isInteger(bestSegmentId)) {
    segmentMarks[bestSegmentId] = segmentEpoch;
  }

  for (let radius = startRadius; radius <= maxRadius; radius += 1) {
    let ringCanImprove = bestSegmentId == null;
    forEachRingCell(grid, center, radius, (cellIndex, row, column) => {
      if (cellMarks[cellIndex] === cellEpoch) return;
      cellMarks[cellIndex] = cellEpoch;
      const lowerBound = cellDistanceSquared(grid, row, column, position);
      if (bestSegmentId != null && lowerBound > bestDistanceSquared + AMBIGUOUS_DISTANCE_EPSILON) {
        return;
      }
      ringCanImprove = true;
      const cell = grid.cells[cellIndex];
      if (!cell) return;
      for (const segmentId of cell) {
        if (segmentMarks[segmentId] === segmentEpoch) continue;
        segmentMarks[segmentId] = segmentEpoch;
        const ax = index.centerline.startX[segmentId];
        const ay = index.centerline.startY[segmentId];
        const dx = index.centerline.deltaX[segmentId];
        const dy = index.centerline.deltaY[segmentId];
        const amount = index.centerline.lengthSquared[segmentId] > 0
          ? clamp(((position.x - ax) * dx + (position.y - ay) * dy) / index.centerline.lengthSquared[segmentId], 0, 1)
          : 0;
        const x = ax + dx * amount;
        const y = ay + dy * amount;
        const distance = index.centerline.startDistance[segmentId] +
          index.centerline.distanceSpan[segmentId] * amount;
        const normalX = index.centerline.normalX[segmentId];
        const normalY = index.centerline.normalY[segmentId];
        const px = position.x - x;
        const py = position.y - y;
        const signedOffset = px * normalX + py * normalY;
        const distanceSquared = px * px + py * py;
        const tieScore = projectionTieScoreForCandidate(distance, segmentId, preferredDistance);
        if (bestSegmentId == null || distanceSquared < bestDistanceSquared - AMBIGUOUS_DISTANCE_EPSILON) {
          secondBestDistance = bestSegmentId == null ? Infinity : bestDistanceSquared;
          bestSegmentId = segmentId;
          bestX = x;
          bestY = y;
          bestDistance = distance;
          bestHeading = index.centerline.heading[segmentId];
          bestNormalX = normalX;
          bestNormalY = normalY;
          bestCurvature = index.centerline.curvature[segmentId];
          bestSignedOffset = signedOffset;
          bestDistanceSquared = distanceSquared;
          bestTieScore = tieScore;
        } else if (Math.abs(distanceSquared - bestDistanceSquared) <= AMBIGUOUS_DISTANCE_EPSILON) {
          tieResolved = true;
          secondBestDistance = Math.min(secondBestDistance, distanceSquared);
          if (projectionTieBeatsCandidate(segmentId, tieScore, bestSegmentId, bestTieScore)) {
            bestSegmentId = segmentId;
            bestX = x;
            bestY = y;
            bestDistance = distance;
            bestHeading = index.centerline.heading[segmentId];
            bestNormalX = normalX;
            bestNormalY = normalY;
            bestCurvature = index.centerline.curvature[segmentId];
            bestSignedOffset = signedOffset;
            bestDistanceSquared = distanceSquared;
            bestTieScore = tieScore;
          }
        } else if (distanceSquared < secondBestDistance) {
          secondBestDistance = distanceSquared;
        }
      }
    });
    if (bestSegmentId != null && !ringCanImprove) break;
  }

  if (bestSegmentId == null) return { projection: null, reason: 'no-candidates' };
  const projection = initialProjection ?? target ?? {};
  writeProjectionCandidate(projection, {
    segmentId: bestSegmentId,
    x: bestX,
    y: bestY,
    distance: bestDistance,
    heading: bestHeading,
    normalX: bestNormalX,
    normalY: bestNormalY,
    curvature: bestCurvature,
    signedOffset: bestSignedOffset,
    distanceSquared: bestDistanceSquared,
  });
  const ambiguous = Number.isFinite(secondBestDistance) &&
    Math.abs(secondBestDistance - bestDistanceSquared) <= AMBIGUOUS_DISTANCE_EPSILON;
  return { projection, reason: ambiguous || tieResolved ? 'tie-resolved' : 'ok' };
}

function projectionMatches(first, second) {
  return first.segmentId === second.segmentId &&
    Math.abs(first.distanceSquared - second.distanceSquared) <= AMBIGUOUS_DISTANCE_EPSILON;
}

function forEachRingCell(grid, center, radius, visitor) {
  const minRow = Math.max(0, center.row - radius);
  const maxRow = Math.min(grid.rows - 1, center.row + radius);
  const minColumn = Math.max(0, center.column - radius);
  const maxColumn = Math.min(grid.columns - 1, center.column + radius);
  for (let row = minRow; row <= maxRow; row += 1) {
    for (let column = minColumn; column <= maxColumn; column += 1) {
      if (
        radius > 0 &&
        row !== minRow &&
        row !== maxRow &&
        column !== minColumn &&
        column !== maxColumn
      ) continue;
      visitor(row * grid.columns + column, row, column);
    }
  }
}

function cellDistanceSquared(grid, row, column, position) {
  const minX = grid.bounds.minX + column * grid.cellSize;
  const minY = grid.bounds.minY + row * grid.cellSize;
  const maxX = Math.min(grid.bounds.maxX, minX + grid.cellSize);
  const maxY = Math.min(grid.bounds.maxY, minY + grid.cellSize);
  const dx = position.x < minX ? minX - position.x : position.x > maxX ? position.x - maxX : 0;
  const dy = position.y < minY ? minY - position.y : position.y > maxY ? position.y - maxY : 0;
  return dx * dx + dy * dy;
}

function bestProjectionFromCandidates(centerline, candidateIds, position, preferredDistance = null, target = null) {
  if (!candidateIds.length) return { projection: null, reason: 'no-candidates' };
  let bestSegmentId = null;
  let bestX = 0;
  let bestY = 0;
  let bestDistance = 0;
  let bestHeading = 0;
  let bestNormalX = 0;
  let bestNormalY = 0;
  let bestCurvature = 0;
  let bestSignedOffset = 0;
  let bestDistanceSquared = Infinity;
  let bestTieScore = Infinity;
  let secondBestDistance = Infinity;
  let tieResolved = false;
  for (const segmentId of candidateIds) {
    const ax = centerline.startX[segmentId];
    const ay = centerline.startY[segmentId];
    const dx = centerline.deltaX[segmentId];
    const dy = centerline.deltaY[segmentId];
    const amount = centerline.lengthSquared[segmentId] > 0
      ? clamp(((position.x - ax) * dx + (position.y - ay) * dy) / centerline.lengthSquared[segmentId], 0, 1)
      : 0;
    const x = ax + dx * amount;
    const y = ay + dy * amount;
    const distance = centerline.startDistance[segmentId] +
      centerline.distanceSpan[segmentId] * amount;
    const normalX = centerline.normalX[segmentId];
    const normalY = centerline.normalY[segmentId];
    const px = position.x - x;
    const py = position.y - y;
    const signedOffset = px * normalX + py * normalY;
    const distanceSquared = px * px + py * py;
    const tieScore = projectionTieScoreForCandidate(distance, segmentId, preferredDistance);
    if (bestSegmentId == null || distanceSquared < bestDistanceSquared - AMBIGUOUS_DISTANCE_EPSILON) {
      secondBestDistance = bestSegmentId == null ? Infinity : bestDistanceSquared;
      bestSegmentId = segmentId;
      bestX = x;
      bestY = y;
      bestDistance = distance;
      bestHeading = centerline.heading[segmentId];
      bestNormalX = normalX;
      bestNormalY = normalY;
      bestCurvature = centerline.curvature[segmentId];
      bestSignedOffset = signedOffset;
      bestDistanceSquared = distanceSquared;
      bestTieScore = tieScore;
    } else if (Math.abs(distanceSquared - bestDistanceSquared) <= AMBIGUOUS_DISTANCE_EPSILON) {
      tieResolved = true;
      secondBestDistance = Math.min(secondBestDistance, distanceSquared);
      if (projectionTieBeatsCandidate(segmentId, tieScore, bestSegmentId, bestTieScore)) {
        bestSegmentId = segmentId;
        bestX = x;
        bestY = y;
        bestDistance = distance;
        bestHeading = centerline.heading[segmentId];
        bestNormalX = normalX;
        bestNormalY = normalY;
        bestCurvature = centerline.curvature[segmentId];
        bestSignedOffset = signedOffset;
        bestDistanceSquared = distanceSquared;
        bestTieScore = tieScore;
      }
    } else if (distanceSquared < secondBestDistance) {
      secondBestDistance = distanceSquared;
    }
  }

  if (bestSegmentId == null) return { projection: null, reason: 'no-best' };
  const projection = writeProjectionCandidate(target ?? {}, {
    segmentId: bestSegmentId,
    x: bestX,
    y: bestY,
    distance: bestDistance,
    heading: bestHeading,
    normalX: bestNormalX,
    normalY: bestNormalY,
    curvature: bestCurvature,
    signedOffset: bestSignedOffset,
    distanceSquared: bestDistanceSquared,
  });

  const ambiguous = Number.isFinite(secondBestDistance) &&
    Math.abs(secondBestDistance - bestDistanceSquared) <= AMBIGUOUS_DISTANCE_EPSILON;
  return { projection, reason: ambiguous || tieResolved ? 'tie-resolved' : 'ok' };
}

function bestProjectionFromAllSegments(centerline, position, preferredDistance = null, target = null) {
  const segmentCount = centerline?.segmentCount ?? 0;
  if (segmentCount <= 0) return { projection: null, reason: 'no-candidates' };
  let bestSegmentId = null;
  let bestX = 0;
  let bestY = 0;
  let bestDistance = 0;
  let bestHeading = 0;
  let bestNormalX = 0;
  let bestNormalY = 0;
  let bestCurvature = 0;
  let bestSignedOffset = 0;
  let bestDistanceSquared = Infinity;
  let bestTieScore = Infinity;
  let secondBestDistance = Infinity;
  let tieResolved = false;

  for (let segmentId = 0; segmentId < segmentCount; segmentId += 1) {
    const ax = centerline.startX[segmentId];
    const ay = centerline.startY[segmentId];
    const dx = centerline.deltaX[segmentId];
    const dy = centerline.deltaY[segmentId];
    const amount = centerline.lengthSquared[segmentId] > 0
      ? clamp(((position.x - ax) * dx + (position.y - ay) * dy) / centerline.lengthSquared[segmentId], 0, 1)
      : 0;
    const x = ax + dx * amount;
    const y = ay + dy * amount;
    const distance = centerline.startDistance[segmentId] +
      centerline.distanceSpan[segmentId] * amount;
    const normalX = centerline.normalX[segmentId];
    const normalY = centerline.normalY[segmentId];
    const px = position.x - x;
    const py = position.y - y;
    const signedOffset = px * normalX + py * normalY;
    const distanceSquared = px * px + py * py;
    const tieScore = projectionTieScoreForCandidate(distance, segmentId, preferredDistance);
    if (bestSegmentId == null || distanceSquared < bestDistanceSquared - AMBIGUOUS_DISTANCE_EPSILON) {
      secondBestDistance = bestSegmentId == null ? Infinity : bestDistanceSquared;
      bestSegmentId = segmentId;
      bestX = x;
      bestY = y;
      bestDistance = distance;
      bestHeading = centerline.heading[segmentId];
      bestNormalX = normalX;
      bestNormalY = normalY;
      bestCurvature = centerline.curvature[segmentId];
      bestSignedOffset = signedOffset;
      bestDistanceSquared = distanceSquared;
      bestTieScore = tieScore;
    } else if (Math.abs(distanceSquared - bestDistanceSquared) <= AMBIGUOUS_DISTANCE_EPSILON) {
      tieResolved = true;
      secondBestDistance = Math.min(secondBestDistance, distanceSquared);
      if (projectionTieBeatsCandidate(segmentId, tieScore, bestSegmentId, bestTieScore)) {
        bestSegmentId = segmentId;
        bestX = x;
        bestY = y;
        bestDistance = distance;
        bestHeading = centerline.heading[segmentId];
        bestNormalX = normalX;
        bestNormalY = normalY;
        bestCurvature = centerline.curvature[segmentId];
        bestSignedOffset = signedOffset;
        bestDistanceSquared = distanceSquared;
        bestTieScore = tieScore;
      }
    } else if (distanceSquared < secondBestDistance) {
      secondBestDistance = distanceSquared;
    }
  }

  if (bestSegmentId == null) return { projection: null, reason: 'no-best' };
  const projection = writeProjectionCandidate(target ?? {}, {
    segmentId: bestSegmentId,
    x: bestX,
    y: bestY,
    distance: bestDistance,
    heading: bestHeading,
    normalX: bestNormalX,
    normalY: bestNormalY,
    curvature: bestCurvature,
    signedOffset: bestSignedOffset,
    distanceSquared: bestDistanceSquared,
  });
  const ambiguous = Number.isFinite(secondBestDistance) &&
    Math.abs(secondBestDistance - bestDistanceSquared) <= AMBIGUOUS_DISTANCE_EPSILON;
  return { projection, reason: ambiguous || tieResolved ? 'tie-resolved' : 'ok' };
}

function bestProjectionFromSegmentNeighborhood(
  centerline,
  centerSegmentId,
  radius,
  position,
  preferredDistance = null,
  target = null,
) {
  const segmentCount = centerline?.segmentCount ?? 0;
  if (segmentCount <= 0) return { projection: null, reason: 'no-candidates' };
  let bestSegmentId = null;
  let bestX = 0;
  let bestY = 0;
  let bestDistance = 0;
  let bestHeading = 0;
  let bestNormalX = 0;
  let bestNormalY = 0;
  let bestCurvature = 0;
  let bestSignedOffset = 0;
  let bestDistanceSquared = Infinity;
  let bestTieScore = Infinity;
  let secondBestDistance = Infinity;
  let tieResolved = false;

  const precomputedNeighborhood = getPrecomputedSegmentNeighborhood(centerline, centerSegmentId, radius);
  const segmentIds = precomputedNeighborhood ?? null;
  if (centerline?.stats && segmentIds) centerline.stats.precomputedSegmentNeighborhoodHits += 1;
  const segmentIdCount = segmentIds?.length ?? (radius * 2 + 1);
  for (let index = 0; index < segmentIdCount; index += 1) {
    const segmentId = segmentIds
      ? segmentIds[index]
      : ((centerSegmentId + (index - radius)) % segmentCount + segmentCount) % segmentCount;
    const ax = centerline.startX[segmentId];
    const ay = centerline.startY[segmentId];
    const dx = centerline.deltaX[segmentId];
    const dy = centerline.deltaY[segmentId];
    const amount = centerline.lengthSquared[segmentId] > 0
      ? clamp(((position.x - ax) * dx + (position.y - ay) * dy) / centerline.lengthSquared[segmentId], 0, 1)
      : 0;
    const x = ax + dx * amount;
    const y = ay + dy * amount;
    const distance = centerline.startDistance[segmentId] +
      centerline.distanceSpan[segmentId] * amount;
    const normalX = centerline.normalX[segmentId];
    const normalY = centerline.normalY[segmentId];
    const px = position.x - x;
    const py = position.y - y;
    const signedOffset = px * normalX + py * normalY;
    const distanceSquared = px * px + py * py;
    const tieScore = projectionTieScoreForCandidate(distance, segmentId, preferredDistance);

    if (bestSegmentId == null || distanceSquared < bestDistanceSquared - AMBIGUOUS_DISTANCE_EPSILON) {
      secondBestDistance = bestSegmentId == null ? Infinity : bestDistanceSquared;
      bestSegmentId = segmentId;
      bestX = x;
      bestY = y;
      bestDistance = distance;
      bestHeading = centerline.heading[segmentId];
      bestNormalX = normalX;
      bestNormalY = normalY;
      bestCurvature = centerline.curvature[segmentId];
      bestSignedOffset = signedOffset;
      bestDistanceSquared = distanceSquared;
      bestTieScore = tieScore;
      continue;
    }

    if (Math.abs(distanceSquared - bestDistanceSquared) <= AMBIGUOUS_DISTANCE_EPSILON) {
      tieResolved = true;
      secondBestDistance = Math.min(secondBestDistance, distanceSquared);
      if (projectionTieBeatsCandidate(segmentId, tieScore, bestSegmentId, bestTieScore)) {
        bestSegmentId = segmentId;
        bestX = x;
        bestY = y;
        bestDistance = distance;
        bestHeading = centerline.heading[segmentId];
        bestNormalX = normalX;
        bestNormalY = normalY;
        bestCurvature = centerline.curvature[segmentId];
        bestSignedOffset = signedOffset;
        bestDistanceSquared = distanceSquared;
        bestTieScore = tieScore;
      }
      continue;
    }

    if (distanceSquared < secondBestDistance) {
      secondBestDistance = distanceSquared;
    }
  }

  if (bestSegmentId == null) return { projection: null, reason: 'no-best' };
  const projection = target ?? {};
  projection.segmentId = bestSegmentId;
  projection.x = bestX;
  projection.y = bestY;
  projection.distance = bestDistance;
  projection.heading = bestHeading;
  projection.normalX = bestNormalX;
  projection.normalY = bestNormalY;
  projection.curvature = bestCurvature;
  projection.signedOffset = bestSignedOffset;
  projection.crossTrackError = Math.abs(bestSignedOffset);
  projection.distanceSquared = bestDistanceSquared;
  const ambiguous = Number.isFinite(secondBestDistance) &&
    Math.abs(secondBestDistance - bestDistanceSquared) <= AMBIGUOUS_DISTANCE_EPSILON;
  return { projection, reason: ambiguous || tieResolved ? 'tie-resolved' : 'ok' };
}

function bestProjectionBatchFromSegmentNeighborhood(
  index,
  positions,
  centerSegmentId,
  radius,
  preferredDistance = null,
  target = null,
) {
  const centerline = index.centerline;
  const projections = target ?? new Array(positions.length);
  projections.length = positions.length;
  const scratch = ensureQueryScratch(index);
  const tieResolvedFlags = ensureUint8ScratchArray(scratch, 'segmentNeighborhoodTieResolved', positions.length);
  const validFlags = ensureUint8ScratchArray(scratch, 'segmentNeighborhoodValid', positions.length);
  const bestTieScores = ensureFloat64ScratchArray(scratch, 'segmentNeighborhoodBestTieScores', positions.length);
  const secondBestDistances = ensureFloat64ScratchArray(scratch, 'segmentNeighborhoodSecondBestDistances', positions.length);

  for (let indexPosition = 0; indexPosition < positions.length; indexPosition += 1) {
    const position = positions[indexPosition];
    if (!finitePoint(position)) {
      projections[indexPosition] = null;
      validFlags[indexPosition] = 0;
      tieResolvedFlags[indexPosition] = 0;
      bestTieScores[indexPosition] = Infinity;
      secondBestDistances[indexPosition] = Infinity;
      continue;
    }
    const projection = projections[indexPosition] ?? {};
    projections[indexPosition] = projection;
    projection.segmentId = -1;
    projection.distanceSquared = Infinity;
    validFlags[indexPosition] = 1;
    tieResolvedFlags[indexPosition] = 0;
    bestTieScores[indexPosition] = Infinity;
    secondBestDistances[indexPosition] = Infinity;
  }

  const segmentCount = centerline.segmentCount;
  const precomputedNeighborhood = getPrecomputedSegmentNeighborhood(centerline, centerSegmentId, radius);
  if (centerline?.stats && precomputedNeighborhood) centerline.stats.precomputedSegmentNeighborhoodHits += positions.length;
  const segmentIds = precomputedNeighborhood ?? null;
  const segmentIdCount = segmentIds?.length ?? (radius * 2 + 1);
  for (let index = 0; index < segmentIdCount; index += 1) {
    const segmentId = segmentIds
      ? segmentIds[index]
      : ((centerSegmentId + (index - radius)) % segmentCount + segmentCount) % segmentCount;
    const ax = centerline.startX[segmentId];
    const ay = centerline.startY[segmentId];
    const dx = centerline.deltaX[segmentId];
    const dy = centerline.deltaY[segmentId];
    const lengthSquared = centerline.lengthSquared[segmentId];
    const distanceBase = centerline.startDistance[segmentId];
    const distanceSpan = centerline.distanceSpan[segmentId];
    const heading = centerline.heading[segmentId];
    const normalX = centerline.normalX[segmentId];
    const normalY = centerline.normalY[segmentId];
    const curvature = centerline.curvature[segmentId];

    for (let indexPosition = 0; indexPosition < positions.length; indexPosition += 1) {
      if (!validFlags[indexPosition]) continue;
      const position = positions[indexPosition];
      const amount = lengthSquared > 0
        ? clamp(((position.x - ax) * dx + (position.y - ay) * dy) / lengthSquared, 0, 1)
        : 0;
      const x = ax + dx * amount;
      const y = ay + dy * amount;
      const distance = distanceBase + distanceSpan * amount;
      const px = position.x - x;
      const py = position.y - y;
      const signedOffset = px * normalX + py * normalY;
      const distanceSquared = px * px + py * py;
      const tieScore = projectionTieScoreForCandidate(distance, segmentId, preferredDistance);
      const projection = projections[indexPosition];

      if (projection.segmentId < 0 || distanceSquared < projection.distanceSquared - AMBIGUOUS_DISTANCE_EPSILON) {
        secondBestDistances[indexPosition] = projection.segmentId < 0 ? Infinity : projection.distanceSquared;
        writeProjectionCandidate(projection, {
          segmentId,
          x,
          y,
          distance,
          heading,
          normalX,
          normalY,
          curvature,
          signedOffset,
          distanceSquared,
        });
        bestTieScores[indexPosition] = tieScore;
        continue;
      }

      if (Math.abs(distanceSquared - projection.distanceSquared) <= AMBIGUOUS_DISTANCE_EPSILON) {
        tieResolvedFlags[indexPosition] = 1;
        secondBestDistances[indexPosition] = Math.min(secondBestDistances[indexPosition], distanceSquared);
        if (projectionTieBeatsCandidate(segmentId, tieScore, projection.segmentId, bestTieScores[indexPosition])) {
          writeProjectionCandidate(projection, {
            segmentId,
            x,
            y,
            distance,
            heading,
            normalX,
            normalY,
            curvature,
            signedOffset,
            distanceSquared,
          });
          bestTieScores[indexPosition] = tieScore;
        }
        continue;
      }

      if (distanceSquared < secondBestDistances[indexPosition]) {
        secondBestDistances[indexPosition] = distanceSquared;
      }
    }
  }

  for (let indexPosition = 0; indexPosition < positions.length; indexPosition += 1) {
    if (!validFlags[indexPosition]) continue;
    const projection = projections[indexPosition];
    if (projection.segmentId < 0) {
      projections[indexPosition] = null;
      tieResolvedFlags[indexPosition] = 0;
      continue;
    }
    const ambiguous = Number.isFinite(secondBestDistances[indexPosition]) &&
      Math.abs(secondBestDistances[indexPosition] - projection.distanceSquared) <= AMBIGUOUS_DISTANCE_EPSILON;
    if (ambiguous) tieResolvedFlags[indexPosition] = 1;
  }

  return tieResolvedFlags;
}

function writeProjectionCandidate(target, {
  segmentId,
  x,
  y,
  distance,
  heading,
  normalX,
  normalY,
  curvature,
  signedOffset,
  distanceSquared,
}) {
  target.segmentId = segmentId;
  target.x = x;
  target.y = y;
  target.distance = distance;
  target.heading = heading;
  target.normalX = normalX;
  target.normalY = normalY;
  target.curvature = curvature;
  target.signedOffset = signedOffset;
  target.crossTrackError = Math.abs(signedOffset);
  target.distanceSquared = distanceSquared;
  return target;
}

function bestProjectionFromHintedSegmentNeighborhood(index, distanceAlong, radius, position, preferredDistance = null, target = null) {
  const centerSegmentId = segmentIdAtDistance(index, distanceAlong);
  if (!Number.isInteger(centerSegmentId)) return { projection: null, reason: 'no-candidates' };
  return bestProjectionFromSegmentNeighborhood(
    index.centerline,
    centerSegmentId,
    radius,
    position,
    preferredDistance,
    target,
  );
}

function segmentIdAtDistance(index, distanceAlong) {
  const centerline = index?.centerline;
  const segmentCount = centerline?.segmentCount ?? 0;
  const totalLength = index?.arcBuckets?.totalLength;
  if (segmentCount <= 0 || !Number.isFinite(distanceAlong) || !Number.isFinite(totalLength) || totalLength <= 0) return null;
  const scratch = ensureQueryScratch(index);
  if (scratch.hintDistanceCacheDistance === distanceAlong && Number.isInteger(scratch.hintDistanceCacheSegmentId) && scratch.hintDistanceCacheSegmentId >= 0) {
    index.stats.hintDistanceCacheHits += 1;
    return scratch.hintDistanceCacheSegmentId;
  }
  const wrapped = wrapDistance(distanceAlong, totalLength);
  let low = 0;
  let high = segmentCount - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (centerline.endDistance[mid] < wrapped) low = mid + 1;
    else high = mid;
  }
  scratch.hintDistanceCacheDistance = distanceAlong;
  scratch.hintDistanceCacheWrappedDistance = wrapped;
  scratch.hintDistanceCacheSegmentId = low;
  scratch.hintDistanceCachePointX = Number.NaN;
  scratch.hintDistanceCachePointY = Number.NaN;
  return low;
}

function projectionTieScore(projection, preferredDistance) {
  if (!Number.isFinite(preferredDistance)) return projection.segmentId;
  return Math.abs(projection.distance - preferredDistance);
}

function projectionTieScoreForCandidate(distance, segmentId, preferredDistance) {
  if (!Number.isFinite(preferredDistance)) return segmentId;
  return Math.abs(distance - preferredDistance);
}

function projectionTieBeats(candidate, candidateTieScore, current, currentTieScore) {
  if (candidateTieScore < currentTieScore - AMBIGUOUS_DISTANCE_EPSILON) return true;
  if (Math.abs(candidateTieScore - currentTieScore) > AMBIGUOUS_DISTANCE_EPSILON) return false;
  return candidate.segmentId < current.segmentId;
}

function projectionTieBeatsCandidate(candidateSegmentId, candidateTieScore, currentSegmentId, currentTieScore) {
  if (candidateTieScore < currentTieScore - AMBIGUOUS_DISTANCE_EPSILON) return true;
  if (Math.abs(candidateTieScore - currentTieScore) > AMBIGUOUS_DISTANCE_EPSILON) return false;
  return candidateSegmentId < currentSegmentId;
}

function ensureFloat64ScratchArray(scratch, key, minimumLength) {
  if (!(scratch[key] instanceof Float64Array) || scratch[key].length < minimumLength) {
    scratch[key] = new Float64Array(Math.max(1, minimumLength));
  }
  return scratch[key];
}

function ensureUint8ScratchArray(scratch, key, minimumLength) {
  if (!(scratch[key] instanceof Uint8Array) || scratch[key].length < minimumLength) {
    scratch[key] = new Uint8Array(Math.max(1, minimumLength));
  }
  return scratch[key];
}

export function queryNearbyTrackProjections(track, position, { neighborLimit = GRID_NEIGHBOR_LIMIT } = {}) {
  const index = track?.queryIndex;
  if (!index?.centerline?.segmentCount || !finitePoint(position)) return null;
  const ids = candidateIdsFromGrid(index, index.grid, position, neighborLimit);
  if (!ids.length) return [];
  return ids.map((segmentId) => projectIndexedSegment(index.centerline, segmentId, position));
}

export function queryTrackSegmentsInBounds(track, bounds) {
  const index = track?.queryIndex;
  const grid = index?.segmentGrid ?? index?.grid;
  if (!index?.centerline?.segmentCount || !grid || !finiteBounds(bounds)) return null;
  const ids = candidateIdsFromGridBounds(index, grid, bounds);
  if (!ids.length) return [];
  return ids.map((segmentId) => segmentFromIndex(index.centerline, segmentId));
}

export function queryTrackSegmentIdsAlongRay(track, origin, vector, maxDistance, margin = 0) {
  const index = track?.queryIndex;
  if (
    !index?.centerline?.segmentCount ||
    !finitePoint(origin) ||
    !Number.isFinite(vector?.x) ||
    !Number.isFinite(vector?.y) ||
    !Number.isFinite(maxDistance) ||
    maxDistance < 0
  ) return null;

  const grid = index.segmentGrid ?? index.grid;
  const scratch = ensureQueryScratch(index);
  const segmentMarks = ensureScratchArray(scratch, 'raySegmentMarks', index.centerline.segmentCount);
  const cellMarks = ensureScratchArray(scratch, 'rayCellMarks', grid.columns * grid.rows);
  const segmentEpoch = nextScratchEpoch(scratch, 'raySegmentEpoch', segmentMarks);
  const cellEpoch = nextScratchEpoch(scratch, 'rayCellEpoch', cellMarks);
  const ids = scratch.raySegmentIds;
  ids.length = 0;
  const radius = Math.max(0, Math.ceil(Math.max(0, margin) / grid.cellSize));
  const step = Math.max(grid.cellSize * 0.5, 1);
  const sampleCount = Math.max(1, Math.ceil(maxDistance / step));
  const visitedCells = scratch.rayVisitedCells;
  visitedCells.length = 0;
  const point = scratch.rayTracePoint ?? { x: 0, y: 0 };
  scratch.rayTracePoint = point;

  const seed = seedRayTraceFromNearbyCache(index, grid, origin, vector, radius, maxDistance, segmentMarks, segmentEpoch, cellMarks, cellEpoch, ids);

  for (let sample = 0; sample <= sampleCount; sample += 1) {
    const distance = Math.min(maxDistance, sample * step);
    point.x = origin.x + vector.x * distance;
    point.y = origin.y + vector.y * distance;
    const center = gridCellForPoint(grid, point, false);
    if (!center) continue;
    for (let row = center.row - radius; row <= center.row + radius; row += 1) {
      for (let column = center.column - radius; column <= center.column + radius; column += 1) {
        if (column < 0 || row < 0 || column >= grid.columns || row >= grid.rows) continue;
        const cellIndex = row * grid.columns + column;
        if (cellMarks[cellIndex] === cellEpoch) continue;
        cellMarks[cellIndex] = cellEpoch;
        visitedCells.push(cellIndex);
        const cell = grid.cells[cellIndex];
        if (!cell) continue;
        for (const segmentId of cell) {
          if (segmentMarks[segmentId] === segmentEpoch) continue;
          segmentMarks[segmentId] = segmentEpoch;
          ids.push(segmentId);
        }
      }
    }
  }

  storeRayTraceCache(index, grid, origin, vector, radius, maxDistance, ids, visitedCells, seed);
  return ids;
}

export function queryTrackSegmentsAlongRay(track, origin, vector, maxDistance, margin = 0) {
  const index = track?.queryIndex;
  const ids = queryTrackSegmentIdsAlongRay(track, origin, vector, maxDistance, margin);
  if (!ids) return null;
  if (!ids.length) return [];
  return ids.map((segmentId) => segmentFromIndex(index.centerline, segmentId));
}

export function attachTrackQueryIndex(track, queryIndex) {
  Object.defineProperty(track, 'queryIndex', {
    configurable: true,
    enumerable: false,
    value: queryIndex,
    writable: false,
  });
  return track;
}

export function forkTrackQueryIndex(sourceIndex, runtimeTrack = null) {
  if (!sourceIndex || typeof sourceIndex !== 'object') return null;
  const index = {
    ...sourceIndex,
    pit: runtimeTrack ? createPitQueryIndex(runtimeTrack, sourceIndex.grid?.cellSize ?? DEFAULT_GRID_CELL_SIZE) : sourceIndex.pit,
    stats: createQueryStats(),
  };
  attachQueryStatsToCenterline(index.centerline, index.stats);
  index.queryScratch = createQueryScratch(index);
  return index;
}

export function resetTrackQueryStats(track) {
  const stats = track?.queryIndex?.stats;
  if (!stats) return null;
  Object.assign(stats, createQueryStats());
  return stats;
}

export function snapshotTrackQueryStats(track) {
  const stats = track?.queryIndex?.stats;
  return stats ? JSON.parse(JSON.stringify(stats)) : null;
}

function attachQueryStatsToCenterline(centerline, stats) {
  const descriptor = Object.getOwnPropertyDescriptor(centerline, 'stats');
  if (!descriptor) {
    Object.defineProperty(centerline, 'stats', {
      configurable: true,
      enumerable: false,
      value: stats,
      writable: true,
    });
    return;
  }
  if (descriptor.writable) centerline.stats = stats;
}

function createTrackBands(track) {
  const trackEdge = track.width / 2;
  const kerbEdge = trackEdge + (track.kerbWidth ?? 0);
  const gravelEdge = kerbEdge + (track.gravelWidth ?? 0);
  const runoffEdge = gravelEdge + (track.runoffWidth ?? 0);
  const barrierInnerFace = runoffEdge - (track.barrierWidth ?? 0) / 2;
  return {
    trackEdge,
    kerbEdge,
    gravelEdge,
    runoffEdge,
    barrierInnerFace,
  };
}

function createCenterlineSegments(samples, segmentCount) {
  const startX = new Float64Array(segmentCount);
  const startY = new Float64Array(segmentCount);
  const endX = new Float64Array(segmentCount);
  const endY = new Float64Array(segmentCount);
  const deltaX = new Float64Array(segmentCount);
  const deltaY = new Float64Array(segmentCount);
  const lengthSquared = new Float64Array(segmentCount);
  const startDistance = new Float64Array(segmentCount);
  const endDistance = new Float64Array(segmentCount);
  const distanceSpan = new Float64Array(segmentCount);
  const heading = new Float64Array(segmentCount);
  const normalX = new Float64Array(segmentCount);
  const normalY = new Float64Array(segmentCount);
  const endNormalX = new Float64Array(segmentCount);
  const endNormalY = new Float64Array(segmentCount);
  const curvature = new Float64Array(segmentCount);
  const minX = new Float64Array(segmentCount);
  const maxX = new Float64Array(segmentCount);
  const minY = new Float64Array(segmentCount);
  const maxY = new Float64Array(segmentCount);

  for (let id = 0; id < segmentCount; id += 1) {
    const start = samples[id];
    const end = samples[id + 1];
    startX[id] = start.x;
    startY[id] = start.y;
    endX[id] = end.x;
    endY[id] = end.y;
    deltaX[id] = end.x - start.x;
    deltaY[id] = end.y - start.y;
    lengthSquared[id] = deltaX[id] * deltaX[id] + deltaY[id] * deltaY[id];
    startDistance[id] = start.distance;
    endDistance[id] = end.distance;
    distanceSpan[id] = end.distance - start.distance;
    heading[id] = start.heading;
    normalX[id] = start.normalX;
    normalY[id] = start.normalY;
    endNormalX[id] = end.normalX;
    endNormalY[id] = end.normalY;
    curvature[id] = start.curvature ?? 0;
    minX[id] = Math.min(start.x, end.x);
    maxX[id] = Math.max(start.x, end.x);
    minY[id] = Math.min(start.y, end.y);
    maxY[id] = Math.max(start.y, end.y);
  }

  return {
    segmentCount,
    startX,
    startY,
    endX,
    endY,
    deltaX,
    deltaY,
    lengthSquared,
    startDistance,
    endDistance,
    distanceSpan,
    heading,
    normalX,
    normalY,
    endNormalX,
    endNormalY,
    curvature,
    minX,
    maxX,
    minY,
    maxY,
  };
}

function createPrecomputedSegmentNeighborhoods(segmentCount, radii) {
  if (!segmentCount || !radii?.size) return new Map();
  const neighborhoodsByRadius = new Map();
  for (const radius of radii) {
    const width = radius * 2 + 1;
    const neighborhoods = new Array(segmentCount);
    for (let centerSegmentId = 0; centerSegmentId < segmentCount; centerSegmentId += 1) {
      const segmentIds = new Int32Array(width);
      for (let index = 0; index < width; index += 1) {
        segmentIds[index] = ((centerSegmentId + (index - radius)) % segmentCount + segmentCount) % segmentCount;
      }
      neighborhoods[centerSegmentId] = segmentIds;
    }
    neighborhoodsByRadius.set(radius, neighborhoods);
  }
  return neighborhoodsByRadius;
}

function getPrecomputedSegmentNeighborhood(centerline, centerSegmentId, radius) {
  const neighborhoods = centerline?.precomputedNeighborhoodsByRadius?.get(radius);
  return neighborhoods?.[centerSegmentId] ?? null;
}

function createArcBuckets(totalLength, count) {
  return {
    count,
    totalLength,
    bucketLength: totalLength / count,
    buckets: Array.from({ length: count }, () => []),
    radius2CandidateIdsByBucket: Array.from({ length: count }, () => []),
  };
}

function insertSegmentIntoArcBuckets(arcBuckets, centerline, segmentId) {
  if (!Number.isFinite(arcBuckets.bucketLength) || arcBuckets.bucketLength <= 0) return;
  const start = Math.floor(centerline.startDistance[segmentId] / arcBuckets.bucketLength);
  const end = Math.floor(centerline.endDistance[segmentId] / arcBuckets.bucketLength);
  for (let bucket = start; bucket <= end; bucket += 1) {
    arcBuckets.buckets[((bucket % arcBuckets.count) + arcBuckets.count) % arcBuckets.count].push(segmentId);
  }
}

function finalizeArcBuckets(arcBuckets, segmentCount) {
  if (!arcBuckets?.count || !segmentCount) return;
  const candidateMarks = new Uint32Array(Math.max(1, segmentCount));
  let epoch = 0;
  for (let center = 0; center < arcBuckets.count; center += 1) {
    epoch += 1;
    if (epoch === 0xffffffff) {
      candidateMarks.fill(0);
      epoch = 1;
    }
    const candidateIds = [];
    for (let offset = -2; offset <= 2; offset += 1) {
      const bucket = ((center + offset) % arcBuckets.count + arcBuckets.count) % arcBuckets.count;
      for (const segmentId of arcBuckets.buckets[bucket]) {
        if (candidateMarks[segmentId] === epoch) continue;
        candidateMarks[segmentId] = epoch;
        candidateIds.push(segmentId);
      }
    }
    arcBuckets.radius2CandidateIdsByBucket[center] = candidateIds;
  }
}

function expandedSampleBounds(samples, expansion) {
  const bounds = samples.reduce((current, point) => ({
    minX: Math.min(current.minX, point.x),
    maxX: Math.max(current.maxX, point.x),
    minY: Math.min(current.minY, point.y),
    maxY: Math.max(current.maxY, point.y),
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  return {
    minX: bounds.minX - expansion,
    maxX: bounds.maxX + expansion,
    minY: bounds.minY - expansion,
    maxY: bounds.maxY + expansion,
  };
}

function insertSegmentIntoGrid(grid, centerline, segmentId, expansion) {
  insertIdIntoGridBounds(grid, segmentId, {
    minX: centerline.minX[segmentId] - expansion,
    maxX: centerline.maxX[segmentId] + expansion,
    minY: centerline.minY[segmentId] - expansion,
    maxY: centerline.maxY[segmentId] + expansion,
  });
}

function createNearestNonLocalHintDistanceSquared(centerline, grid, maxDistance) {
  const segmentCount = centerline?.segmentCount ?? 0;
  const distances = new Float64Array(segmentCount);
  distances.fill(Infinity);
  if (!segmentCount || !grid) return distances;
  const candidateMarks = new Uint32Array(Math.max(1, segmentCount));
  let epoch = 0;
  const maxDistanceSquared = maxDistance * maxDistance;
  for (let segmentId = 0; segmentId < segmentCount; segmentId += 1) {
    epoch += 1;
    if (epoch === 0xffffffff) {
      candidateMarks.fill(0);
      epoch = 1;
    }
    const bounds = {
      minX: centerline.minX[segmentId] - maxDistance,
      maxX: centerline.maxX[segmentId] + maxDistance,
      minY: centerline.minY[segmentId] - maxDistance,
      maxY: centerline.maxY[segmentId] + maxDistance,
    };
    const minCell = gridCellForPoint(grid, { x: bounds.minX, y: bounds.minY }, true);
    const maxCell = gridCellForPoint(grid, { x: bounds.maxX, y: bounds.maxY }, true);
    let bestDistanceSquared = Infinity;
    for (let row = minCell.row; row <= maxCell.row; row += 1) {
      for (let column = minCell.column; column <= maxCell.column; column += 1) {
        const cell = grid.cells[row * grid.columns + column];
        if (!cell) continue;
        for (const candidateId of cell) {
          if (candidateMarks[candidateId] === epoch) continue;
          candidateMarks[candidateId] = epoch;
          if (isLocalSegmentNeighbor(segmentId, candidateId, segmentCount, 2)) continue;
          const candidateDistanceSquared = segmentDistanceSquared(centerline, segmentId, candidateId);
          if (candidateDistanceSquared < bestDistanceSquared) {
            bestDistanceSquared = candidateDistanceSquared;
          }
          if (bestDistanceSquared <= AMBIGUOUS_DISTANCE_EPSILON) {
            break;
          }
        }
        if (bestDistanceSquared <= AMBIGUOUS_DISTANCE_EPSILON) break;
      }
      if (bestDistanceSquared <= AMBIGUOUS_DISTANCE_EPSILON) break;
    }
    distances[segmentId] = bestDistanceSquared <= maxDistanceSquared ? bestDistanceSquared : Infinity;
  }
  return distances;
}

function createLowDensityHintRing1Neighborhood(centerline, grid, threshold) {
  const cellCount = grid?.columns * grid?.rows;
  if (!centerline?.segmentCount || !grid || !Number.isInteger(cellCount) || cellCount <= 0) {
    return {
      counts: new Uint16Array(0),
      candidateIdsByCell: [],
    };
  }
  const counts = new Uint16Array(cellCount);
  const candidateIdsByCell = new Array(cellCount).fill(null);
  const candidateMarks = new Uint32Array(Math.max(1, centerline.segmentCount));
  let epoch = 0;
  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      epoch += 1;
      if (epoch === 0xffffffff) {
        candidateMarks.fill(0);
        epoch = 1;
      }
      let uniqueCount = 0;
      const ids = [];
      for (let localRow = Math.max(0, row - 1); localRow <= Math.min(grid.rows - 1, row + 1); localRow += 1) {
        for (
          let localColumn = Math.max(0, column - 1);
          localColumn <= Math.min(grid.columns - 1, column + 1);
          localColumn += 1
        ) {
          const cell = grid.cells[localRow * grid.columns + localColumn];
          if (!cell) continue;
          for (const segmentId of cell) {
            if (candidateMarks[segmentId] === epoch) continue;
            candidateMarks[segmentId] = epoch;
            uniqueCount += 1;
            ids.push(segmentId);
          }
        }
      }
      const cellIndex = row * grid.columns + column;
      counts[cellIndex] = uniqueCount;
      if (uniqueCount <= threshold) {
        candidateIdsByCell[cellIndex] = ids;
      }
    }
  }
  return { counts, candidateIdsByCell };
}

function createNearestOccupiedCellRadiusByCell(grid) {
  const cellCount = grid?.columns * grid?.rows;
  if (!grid || !Number.isInteger(cellCount) || cellCount <= 0) {
    return new Uint16Array(0);
  }
  const radii = new Uint16Array(cellCount);
  radii.fill(0xffff);
  const queue = new Uint32Array(cellCount);
  let head = 0;
  let tail = 0;

  for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
    if (!grid.cells[cellIndex]?.length) continue;
    radii[cellIndex] = 0;
    queue[tail] = cellIndex;
    tail += 1;
  }

  while (head < tail) {
    const cellIndex = queue[head];
    head += 1;
    const row = Math.floor(cellIndex / grid.columns);
    const column = cellIndex - row * grid.columns;
    const nextRadius = radii[cellIndex] + 1;

    for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
      const neighborRow = row + rowOffset;
      if (neighborRow < 0 || neighborRow >= grid.rows) continue;
      for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
        const neighborColumn = column + columnOffset;
        if (neighborColumn < 0 || neighborColumn >= grid.columns) continue;
        const neighborIndex = neighborRow * grid.columns + neighborColumn;
        if (radii[neighborIndex] <= nextRadius) continue;
        radii[neighborIndex] = nextRadius;
        queue[tail] = neighborIndex;
        tail += 1;
      }
    }
  }

  return radii;
}

function isLocalSegmentNeighbor(segmentId, candidateId, segmentCount, radius) {
  const delta = Math.abs(segmentId - candidateId);
  return Math.min(delta, segmentCount - delta) <= radius;
}

function segmentDistanceSquared(centerline, firstSegmentId, secondSegmentId) {
  const ax = centerline.startX[firstSegmentId];
  const ay = centerline.startY[firstSegmentId];
  const bx = centerline.endX[firstSegmentId];
  const by = centerline.endY[firstSegmentId];
  const cx = centerline.startX[secondSegmentId];
  const cy = centerline.startY[secondSegmentId];
  const dx = centerline.endX[secondSegmentId];
  const dy = centerline.endY[secondSegmentId];

  if (segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return 0;

  return Math.min(
    pointToSegmentDistanceSquared(ax, ay, cx, cy, dx, dy),
    pointToSegmentDistanceSquared(bx, by, cx, cy, dx, dy),
    pointToSegmentDistanceSquared(cx, cy, ax, ay, bx, by),
    pointToSegmentDistanceSquared(dx, dy, ax, ay, bx, by),
  );
}

function isHintProjectionDistanceSafe(index, projection) {
  const safeDistanceSquared = index.nearestNonLocalHintDistanceSquared?.[projection.segmentId] ?? 0;
  if (!Number.isFinite(safeDistanceSquared)) return true;
  return 4 * projection.crossTrackError * projection.crossTrackError < safeDistanceSquared - AMBIGUOUS_DISTANCE_EPSILON;
}

function hintedQueryStaysInLocalCorridor(index, position, progressHint, maxOffset) {
  const hintPoint = pointAtIndexedDistance(index, progressHint);
  if (!hintPoint) return false;
  const dx = position.x - hintPoint.x;
  const dy = position.y - hintPoint.y;
  return dx * dx + dy * dy <= maxOffset * maxOffset + AMBIGUOUS_DISTANCE_EPSILON;
}

function pointAtIndexedDistance(index, distanceAlong) {
  const centerline = index?.centerline;
  const scratch = ensureQueryScratch(index);
  const segmentId = segmentIdAtDistance(index, distanceAlong);
  if (!centerline || !Number.isInteger(segmentId)) return null;
  if (
    scratch.hintDistanceCacheDistance === distanceAlong &&
    Number.isFinite(scratch.hintDistanceCachePointX) &&
    Number.isFinite(scratch.hintDistanceCachePointY)
  ) {
    return {
      x: scratch.hintDistanceCachePointX,
      y: scratch.hintDistanceCachePointY,
    };
  }
  const startDistance = centerline.startDistance[segmentId];
  const endDistance = centerline.endDistance[segmentId];
  const span = Math.max(AMBIGUOUS_DISTANCE_EPSILON, endDistance - startDistance);
  const wrappedDistance = scratch.hintDistanceCacheDistance === distanceAlong &&
    Number.isFinite(scratch.hintDistanceCacheWrappedDistance)
    ? scratch.hintDistanceCacheWrappedDistance
    : wrapDistance(distanceAlong, index.arcBuckets.totalLength);
  const amount = clamp((wrappedDistance - startDistance) / span, 0, 1);
  const point = {
    x: centerline.startX[segmentId] + (centerline.endX[segmentId] - centerline.startX[segmentId]) * amount,
    y: centerline.startY[segmentId] + (centerline.endY[segmentId] - centerline.startY[segmentId]) * amount,
  };
  scratch.hintDistanceCacheDistance = distanceAlong;
  scratch.hintDistanceCacheWrappedDistance = wrappedDistance;
  scratch.hintDistanceCacheSegmentId = segmentId;
  scratch.hintDistanceCachePointX = point.x;
  scratch.hintDistanceCachePointY = point.y;
  return point;
}

function isHintProjectionLowDensitySafe(index, position) {
  const grid = index?.segmentGrid ?? index?.grid;
  const counts = index?.lowDensityHintRing1SegmentCounts;
  if (!grid || !counts?.length || !finitePoint(position)) return false;
  const cell = gridCellForPoint(grid, position, false);
  if (!cell) return false;
  const count = counts[cell.row * grid.columns + cell.column] ?? Infinity;
  return count <= LOW_DENSITY_HINT_RING1_SEGMENT_THRESHOLD;
}

function bestProjectionFromLowDensityCellNeighborhood(index, position, preferredDistance = null, target = null) {
  const grid = index?.segmentGrid ?? index?.grid;
  const counts = index?.lowDensityHintRing1SegmentCounts;
  const candidateIdsByCell = index?.lowDensityHintRing1CandidateIdsByCell;
  if (!grid || !counts?.length || !candidateIdsByCell?.length || !finitePoint(position)) {
    return { projection: null, reason: 'no-candidates' };
  }
  const center = gridCellForPoint(grid, position, false);
  if (!center) return { projection: null, reason: 'no-candidates' };
  const cellIndex = center.row * grid.columns + center.column;
  if ((counts[cellIndex] ?? Infinity) > LOW_DENSITY_HINT_RING1_SEGMENT_THRESHOLD) {
    return { projection: null, reason: 'no-candidates' };
  }
  const candidateIds = candidateIdsByCell[cellIndex];
  if (!candidateIds?.length) return { projection: null, reason: 'no-candidates' };
  const local = bestProjectionFromCandidates(index.centerline, candidateIds, position, preferredDistance, target);
  if (!local.projection) return local;
  forEachRingCell(grid, center, 2, (_ringCellIndex, row, column) => {
    if (local.projection == null) return;
    if (
      row >= center.row - 1 &&
      row <= center.row + 1 &&
      column >= center.column - 1 &&
      column <= center.column + 1
    ) return;
    const cell = grid.cells[row * grid.columns + column];
    if (!cell?.length) return;
    const lowerBound = cellDistanceSquared(grid, row, column, position);
    if (lowerBound <= local.projection.distanceSquared + AMBIGUOUS_DISTANCE_EPSILON) {
      local.projection = null;
    }
  });
  return local.projection ? local : { projection: null, reason: 'needs-wider-search' };
}

function bestProjectionFromRing2Neighborhood(index, position, preferredDistance = null, target = null) {
  const grid = index?.segmentGrid ?? index?.grid;
  if (!grid || !finitePoint(position)) {
    return { projection: null, bestProjection: null, reason: 'no-candidates' };
  }
  const center = gridCellForPoint(grid, position, false);
  if (!center) return { projection: null, bestProjection: null, reason: 'no-candidates' };
  const candidateIds = candidateIdsFromCellNeighborhood(index, grid, center, 2);
  if (!candidateIds.length) return { projection: null, bestProjection: null, reason: 'no-candidates' };
  const local = bestProjectionFromCandidates(index.centerline, candidateIds, position, preferredDistance, target);
  if (!local.projection) return { projection: null, bestProjection: null, reason: local.reason ?? 'no-candidates' };
  const bestProjection = local.projection;
  forEachRingCell(grid, center, 3, (_cellIndex, row, column) => {
    if (local.projection == null) return;
    const cell = grid.cells[row * grid.columns + column];
    if (!cell?.length) return;
    const lowerBound = cellDistanceSquared(grid, row, column, position);
    if (lowerBound <= local.projection.distanceSquared + AMBIGUOUS_DISTANCE_EPSILON) {
      local.projection = null;
    }
  });
  return local.projection
    ? local
    : { projection: null, bestProjection, reason: 'needs-wider-search' };
}

function candidateIdsFromCellNeighborhood(index, grid, center, radius) {
  const scratch = ensureQueryScratch(index);
  const segmentMarks = ensureScratchArray(scratch, 'cellNeighborhoodSegmentMarks', index.centerline.segmentCount);
  const segmentEpoch = nextScratchEpoch(scratch, 'cellNeighborhoodSegmentEpoch', segmentMarks);
  const ids = scratch.cellNeighborhoodSegmentIds ?? [];
  ids.length = 0;
  for (let row = Math.max(0, center.row - radius); row <= Math.min(grid.rows - 1, center.row + radius); row += 1) {
    for (let column = Math.max(0, center.column - radius); column <= Math.min(grid.columns - 1, center.column + radius); column += 1) {
      const cell = grid.cells[row * grid.columns + column];
      if (!cell) continue;
      for (const segmentId of cell) {
        if (segmentMarks[segmentId] === segmentEpoch) continue;
        segmentMarks[segmentId] = segmentEpoch;
        ids.push(segmentId);
      }
    }
  }
  scratch.cellNeighborhoodSegmentIds = ids;
  return ids;
}

function pointToSegmentDistanceSquared(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const amount = lengthSquared > 0
    ? clamp(((px - ax) * dx + (py - ay) * dy) / lengthSquared, 0, 1)
    : 0;
  const x = ax + dx * amount;
  const y = ay + dy * amount;
  const deltaX = px - x;
  const deltaY = py - y;
  return deltaX * deltaX + deltaY * deltaY;
}

function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const abx = bx - ax;
  const aby = by - ay;
  const acx = cx - ax;
  const acy = cy - ay;
  const adx = dx - ax;
  const ady = dy - ay;
  const cdx = dx - cx;
  const cdy = dy - cy;
  const cax = ax - cx;
  const cay = ay - cy;
  const cbx = bx - cx;
  const cby = by - cy;
  const cross1 = abx * acy - aby * acx;
  const cross2 = abx * ady - aby * adx;
  const cross3 = cdx * cay - cdy * cax;
  const cross4 = cdx * cby - cdy * cbx;
  return cross1 * cross2 <= 0 && cross3 * cross4 <= 0;
}

function bestProjectionFromArcBuckets(index, distanceAlong, radius, position, preferredDistance = null, target = null) {
  const arcBuckets = index?.arcBuckets;
  if (!arcBuckets?.count || !Number.isFinite(distanceAlong)) return { projection: null, reason: 'no-candidates' };
  const wrapped = wrapDistance(distanceAlong, arcBuckets.totalLength);
  const center = Math.floor(wrapped / arcBuckets.bucketLength);
  const precomputedRadius2Candidates = radius === 2
    ? arcBuckets.radius2CandidateIdsByBucket?.[center] ?? null
    : null;
  const scratch = precomputedRadius2Candidates ? null : ensureQueryScratch(index);
  const segmentMarks = precomputedRadius2Candidates
    ? null
    : ensureScratchArray(scratch, 'candidateMarks', index.centerline.segmentCount);
  const candidateEpoch = precomputedRadius2Candidates
    ? 0
    : nextScratchEpoch(scratch, 'candidateEpoch', segmentMarks);
  let bestSegmentId = null;
  let bestX = 0;
  let bestY = 0;
  let bestDistance = 0;
  let bestHeading = 0;
  let bestNormalX = 0;
  let bestNormalY = 0;
  let bestCurvature = 0;
  let bestSignedOffset = 0;
  let bestDistanceSquared = Infinity;
  let bestTieScore = Infinity;
  let secondBestDistance = Infinity;
  let tieResolved = false;

  const visitCandidate = (segmentId) => {
    if (segmentMarks) {
      if (segmentMarks[segmentId] === candidateEpoch) return;
      segmentMarks[segmentId] = candidateEpoch;
    }
    const ax = index.centerline.startX[segmentId];
    const ay = index.centerline.startY[segmentId];
    const dx = index.centerline.deltaX[segmentId];
    const dy = index.centerline.deltaY[segmentId];
    const amount = index.centerline.lengthSquared[segmentId] > 0
      ? clamp(((position.x - ax) * dx + (position.y - ay) * dy) / index.centerline.lengthSquared[segmentId], 0, 1)
      : 0;
    const x = ax + dx * amount;
    const y = ay + dy * amount;
    const distance = index.centerline.startDistance[segmentId] +
      index.centerline.distanceSpan[segmentId] * amount;
    const normalX = index.centerline.normalX[segmentId];
    const normalY = index.centerline.normalY[segmentId];
    const px = position.x - x;
    const py = position.y - y;
    const signedOffset = px * normalX + py * normalY;
    const distanceSquared = px * px + py * py;
    const tieScore = projectionTieScoreForCandidate(distance, segmentId, preferredDistance);
    if (bestSegmentId == null || distanceSquared < bestDistanceSquared - AMBIGUOUS_DISTANCE_EPSILON) {
      secondBestDistance = bestSegmentId == null ? Infinity : bestDistanceSquared;
      bestSegmentId = segmentId;
      bestX = x;
      bestY = y;
      bestDistance = distance;
      bestHeading = index.centerline.heading[segmentId];
      bestNormalX = normalX;
      bestNormalY = normalY;
      bestCurvature = index.centerline.curvature[segmentId];
      bestSignedOffset = signedOffset;
      bestDistanceSquared = distanceSquared;
      bestTieScore = tieScore;
    } else if (Math.abs(distanceSquared - bestDistanceSquared) <= AMBIGUOUS_DISTANCE_EPSILON) {
      tieResolved = true;
      secondBestDistance = Math.min(secondBestDistance, distanceSquared);
      if (projectionTieBeatsCandidate(segmentId, tieScore, bestSegmentId, bestTieScore)) {
        bestSegmentId = segmentId;
        bestX = x;
        bestY = y;
        bestDistance = distance;
        bestHeading = index.centerline.heading[segmentId];
        bestNormalX = normalX;
        bestNormalY = normalY;
        bestCurvature = index.centerline.curvature[segmentId];
        bestSignedOffset = signedOffset;
        bestDistanceSquared = distanceSquared;
        bestTieScore = tieScore;
      }
    } else if (distanceSquared < secondBestDistance) {
      secondBestDistance = distanceSquared;
    }
  };

  if (precomputedRadius2Candidates) {
    index.stats.arcBucketRadius2PrecomputedQueries += 1;
    for (const segmentId of precomputedRadius2Candidates) visitCandidate(segmentId);
  } else {
    for (let offset = -radius; offset <= radius; offset += 1) {
      const bucket = ((center + offset) % arcBuckets.count + arcBuckets.count) % arcBuckets.count;
      for (const segmentId of arcBuckets.buckets[bucket]) visitCandidate(segmentId);
    }
  }

  if (bestSegmentId == null) return { projection: null, reason: 'no-best' };
  const projection = writeProjectionCandidate(target ?? {}, {
    segmentId: bestSegmentId,
    x: bestX,
    y: bestY,
    distance: bestDistance,
    heading: bestHeading,
    normalX: bestNormalX,
    normalY: bestNormalY,
    curvature: bestCurvature,
    signedOffset: bestSignedOffset,
    distanceSquared: bestDistanceSquared,
  });
  const ambiguous = Number.isFinite(secondBestDistance) &&
    Math.abs(secondBestDistance - bestDistanceSquared) <= AMBIGUOUS_DISTANCE_EPSILON;
  return { projection, reason: ambiguous || tieResolved ? 'tie-resolved' : 'ok' };
}

function projectIndexedSegment(centerline, segmentId, position) {
  if (centerline?.stats) centerline.stats.candidateProjectionObjectAllocations += 1;
  const ax = centerline.startX[segmentId];
  const ay = centerline.startY[segmentId];
  const dx = centerline.deltaX[segmentId];
  const dy = centerline.deltaY[segmentId];
  const amount = centerline.lengthSquared[segmentId] > 0
    ? clamp(((position.x - ax) * dx + (position.y - ay) * dy) / centerline.lengthSquared[segmentId], 0, 1)
    : 0;
  const x = ax + dx * amount;
  const y = ay + dy * amount;
  const distance = centerline.startDistance[segmentId] +
    centerline.distanceSpan[segmentId] * amount;
  const heading = centerline.heading[segmentId];
  const normalX = centerline.normalX[segmentId];
  const normalY = centerline.normalY[segmentId];
  const px = position.x - x;
  const py = position.y - y;
  const signedOffset = px * normalX + py * normalY;

  return {
    segmentId,
    x,
    y,
    distance,
    heading,
    normalX,
    normalY,
    curvature: centerline.curvature[segmentId],
    signedOffset,
    crossTrackError: Math.abs(signedOffset),
    distanceSquared: px * px + py * py,
  };
}

function segmentFromIndex(centerline, segmentId) {
  if (centerline?.stats) centerline.stats.raySegmentObjectAllocations += 1;
  return {
    segmentId,
    startX: centerline.startX[segmentId],
    startY: centerline.startY[segmentId],
    endX: centerline.endX[segmentId],
    endY: centerline.endY[segmentId],
    startDistance: centerline.startDistance[segmentId],
    endDistance: centerline.endDistance[segmentId],
    normalX: centerline.normalX[segmentId],
    normalY: centerline.normalY[segmentId],
    endNormalX: centerline.endNormalX[segmentId],
    endNormalY: centerline.endNormalY[segmentId],
  };
}

function seedRayTraceFromNearbyCache(
  index,
  grid,
  origin,
  vector,
  radius,
  maxDistance,
  segmentMarks,
  segmentEpoch,
  cellMarks,
  cellEpoch,
  ids,
) {
  const scratch = ensureQueryScratch(index);
  const traceCache = scratch.rayTraceCache;
  const originCell = gridCellForPoint(grid, origin, false);
  if (!originCell) return null;
  const bucket = rayTraceBucket(vector);
  const base = rayTraceBaseKey(grid, originCell, radius);
  const minimumSeedDistance = maxDistance * 0.85;
  let seed = traceCache.get(rayTraceKey(base, bucket));
  let bestSeedDistance = seed?.maxDistance ?? -Infinity;
  if (bestSeedDistance < minimumSeedDistance) {
    seed = null;
    bestSeedDistance = -Infinity;
  }
  const beforeSeed = traceCache.get(rayTraceKey(base, bucket - 1));
  if ((beforeSeed?.maxDistance ?? -Infinity) >= minimumSeedDistance && beforeSeed.maxDistance > bestSeedDistance) {
    seed = beforeSeed;
    bestSeedDistance = beforeSeed.maxDistance;
  }
  const afterSeed = traceCache.get(rayTraceKey(base, bucket + 1));
  if ((afterSeed?.maxDistance ?? -Infinity) >= minimumSeedDistance && afterSeed.maxDistance > bestSeedDistance) {
    seed = afterSeed;
  }
  if (!seed) return { base, bucket };

  for (const segmentId of seed.segmentIds) {
    if (segmentMarks[segmentId] === segmentEpoch) continue;
    segmentMarks[segmentId] = segmentEpoch;
    ids.push(segmentId);
  }
  for (const cellId of seed.cellIds) {
    cellMarks[cellId] = cellEpoch;
  }
  return { base, bucket };
}

function storeRayTraceCache(index, grid, origin, vector, radius, maxDistance, segmentIds, cellIds, seed) {
  const scratch = ensureQueryScratch(index);
  const traceCache = scratch.rayTraceCache;
  const originCell = gridCellForPoint(grid, origin, false);
  if (!originCell) return;
  const bucket = seed?.bucket ?? rayTraceBucket(vector);
  const base = seed?.base ?? rayTraceBaseKey(grid, originCell, radius);
  const key = rayTraceKey(base, bucket);
  let entry = traceCache.get(key);
  if (!entry) {
    entry = {
      maxDistance: 0,
      segmentIds: [],
      cellIds: [],
    };
    traceCache.set(key, entry);
    if (index.stats) index.stats.rayTraceCacheEntryAllocations += 1;
  }
  entry.maxDistance = maxDistance;
  entry.segmentIds.length = segmentIds.length;
  for (let index = 0; index < segmentIds.length; index += 1) {
    entry.segmentIds[index] = segmentIds[index];
  }
  entry.cellIds.length = cellIds.length;
  for (let index = 0; index < cellIds.length; index += 1) {
    entry.cellIds[index] = cellIds[index];
  }
  if (traceCache.size > 96) {
    const oldestKey = traceCache.keys().next().value;
    if (oldestKey) traceCache.delete(oldestKey);
  }
}

function rayTraceBaseKey(grid, center, radius) {
  return `${center.column}:${center.row}:${radius}:${grid.columns}:${grid.rows}`;
}

function rayTraceKey(base, bucket) {
  return `${base}:${bucket}`;
}

function rayTraceBucket(vector) {
  const angleDegrees = Math.atan2(vector.y, vector.x) * 180 / Math.PI;
  return Math.round(angleDegrees / RAY_TRACE_BUCKET_DEGREES);
}

function finitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function finiteBounds(bounds) {
  return Number.isFinite(bounds?.minX) &&
    Number.isFinite(bounds?.maxX) &&
    Number.isFinite(bounds?.minY) &&
    Number.isFinite(bounds?.maxY) &&
    bounds.minX <= bounds.maxX &&
    bounds.minY <= bounds.maxY;
}
