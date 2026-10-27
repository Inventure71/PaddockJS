export { createTrackQueryIndex, attachTrackQueryIndex, forkTrackQueryIndex } from './trackQueryConstruction.js';
export {
  queryNearestTrackProjection,
  queryNearestTrackProjectionInto,
  queryHintedTrackProjection,
  querySegmentNeighborhoodProjection,
  querySegmentNeighborhoodProjections,
  queryNearbyTrackProjections,
  queryTrackSegmentsInBounds,
} from './trackNearestQueries.js';
export { queryTrackSegmentIdsAlongRay, queryTrackSegmentsAlongRay } from './trackRayQueries.js';
export { resetTrackQueryStats, snapshotTrackQueryStats } from './trackQueryStats.js';
export {
  queryPitBoxCandidates,
  queryPitRoadSegmentCandidates,
  queryPitRoadSegmentCandidatesByRoute,
} from './trackQueryPitIndex.js';
