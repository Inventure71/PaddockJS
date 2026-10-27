import { attachTrackQueryIndex, createTrackQueryIndex } from '../simulation/track/trackQueryConstruction.js';
import { prepareSampleIndexLut } from '../simulation/track/spatialQueries.js';
import { createPitBoxBounds, createPitConnectorBounds, createPitLaneBounds } from '../simulation/track/pitLaneLayout.js';

const SAMPLE_FIELDS = ['x', 'y', 'distance', 'heading', 'normalX', 'normalY', 'curvature'];

// JSON snapshots deliberately omit runtime indexes and compact sample objects
// into a schema/table. Restore only display query infrastructure around that
// supplied geometry. Never generate another track or reconstruct model senses.
export function createExternalTrackSnapshotDecoder() {
  let lastKey = null, lastTrack = null;
  return {
    decode(snapshot) {
      const track = snapshot?.track;
      if (!track || track.queryIndex || !Array.isArray(track.samples)) return snapshot;
      const key = JSON.stringify(track);
      if (key !== lastKey) {
        const decoded = decodeTrack(track);
        lastTrack = decoded;
        lastKey = key;
      }
      return { ...snapshot, track: lastTrack };
    },
    reset() { lastKey = null; lastTrack = null; },
  };
}

function decodeTrack(track) {
  const schema = track.sampleSchema;
  const samples = track.samples?.map((sample) => Array.isArray(sample) && Array.isArray(schema)
    ? Object.fromEntries(schema.map((field, index) => [field, sample[index]]))
    : { ...sample });
  if (!Array.isArray(samples) || samples.length < 2 ||
    !Number.isFinite(track.length) || track.length <= 0 ||
    !Number.isFinite(track.width) || track.width <= 0 ||
    samples.some((sample) => SAMPLE_FIELDS.some((field) => !Number.isFinite(sample[field])))) {
    throw new Error('External track requires finite sample geometry, length and width.');
  }
  const decoded = { ...track, samples };
  if (track.pitLane?.enabled) {
    const pitLane = { ...track.pitLane };
    pitLane.bounds ??= createPitLaneBounds(pitLane);
    pitLane.boxBounds ??= createPitBoxBounds(pitLane);
    pitLane.connectorBounds ??= createPitConnectorBounds(pitLane);
    decoded.pitLane = pitLane;
  }
  attachTrackQueryIndex(decoded, createTrackQueryIndex(decoded));
  prepareSampleIndexLut(decoded);
  return decoded;
}
