import { Container } from 'pixi.js';
import { describe, expect, test, vi } from 'vitest';
import {
  ProceduralTrackAsset,
  getTrackMaterialBands,
  getOffsetGapBridges,
  getOffsetStrokeSegments,
  offsetGapBridgeIsSafe,
  offsetSegmentIsSafe,
} from '../rendering/proceduralTrackAsset.js';
import { buildTrackModel, offsetTrackPoint, TRACK, WORLD } from '../simulation/trackModel.js';
import { metersToSimUnits } from '../simulation/units.js';
import { resetTrackQueryStats, snapshotTrackQueryStats } from '../simulation/track/trackQueryIndex.js';

const TRACK_RENDER_TEST_TIMEOUT_MS = 30000;

function trackDrawingSnapshot(asset) {
  return asset.container.children.map((child) => ({
    label: child.label,
    alpha: child.alpha,
    renderable: child.renderable,
    bounds: child.worldGrassBounds,
    texture: child.texture?.label,
    tileScale: child.tileScale && { x: child.tileScale.x, y: child.tileScale.y },
    maskIndex: asset.container.children.indexOf(child.mask),
    instructions: child.context?.instructions.map(({ action, data }) => ({
      action,
      style: data.style && { ...data.style, texture: data.style.texture?.label },
      path: data.path?.instructions,
      hole: data.hole?.instructions,
    })),
  }));
}

describe('procedural track asset geometry', () => {
  test('startup rendering preserves every drawing instruction and splits safety queries within kerbs and borders', async () => {
    const track = buildTrackModel(TRACK);
    const synchronous = new ProceduralTrackAsset();
    resetTrackQueryStats(track);
    synchronous.render(track);
    const synchronousQueries = snapshotTrackQueryStats(track).nearestQueries;

    const startup = new ProceduralTrackAsset();
    const pauses = [];
    let workUntilPause = 64;
    resetTrackQueryStats(track);
    await startup.renderAsync(track, {
      checkpoint() {
        workUntilPause -= 1;
        if (workUntilPause > 0) return null;
        workUntilPause = 64;
        pauses.push({
          layer: startup.container.children.at(-1)?.label,
          queries: snapshotTrackQueryStats(track).nearestQueries,
        });
        return Promise.resolve();
      },
    });

    expect(trackDrawingSnapshot(startup)).toEqual(trackDrawingSnapshot(synchronous));
    expect(snapshotTrackQueryStats(track).nearestQueries).toBe(synchronousQueries);
    for (const layer of ['track-kerbs', 'track-borders']) {
      const layerPauses = pauses.filter((pause) => pause.layer === layer);
      expect(layerPauses.length).toBeGreaterThan(3);
      const queryIncrements = layerPauses.slice(1).map((pause, index) => pause.queries - layerPauses[index].queries);
      expect(queryIncrements.filter((count) => count > 0).length).toBeGreaterThan(3);
      // At most one segment's eight safety samples runs per work item.
      expect(Math.max(...queryIncrements)).toBeLessThanOrEqual(64 * 8);
    }
    synchronous.container.destroy({ children: true });
    startup.container.destroy({ children: true });
  }, TRACK_RENDER_TEST_TIMEOUT_MS);

  test('startup cancellation checks before clearing or allocating display objects', async () => {
    const track = buildTrackModel(TRACK);
    const asset = new ProceduralTrackAsset();
    const previous = new Container();
    asset.container.addChild(previous);
    const cancelled = new Error('startup cancelled');

    await expect(asset.renderAsync(track, { checkpoint() { throw cancelled; } })).rejects.toBe(cancelled);

    expect(asset.container.children).toEqual([previous]);
    expect(previous.destroyed).toBe(false);
    asset.container.destroy({ children: true });
  });

  test('destroying startup during a border pause owns partial graphics and prevents more drawing or queries', async () => {
    const track = buildTrackModel(TRACK);
    const asset = new ProceduralTrackAsset();
    const cancelled = new Error('startup destroyed');
    let releasePause;
    let reachedPause;
    const paused = new Promise((resolve) => { reachedPause = resolve; });
    const waiting = new Promise((resolve) => { releasePause = resolve; });
    let borderQueries = null;
    const rendering = asset.renderAsync(track, {
      checkpoint() {
        if (asset.container.destroyed) throw cancelled;
        if (asset.container.children.at(-1)?.label !== 'track-borders') return null;
        const queries = snapshotTrackQueryStats(track).nearestQueries;
        borderQueries ??= queries;
        if (queries - borderQueries < 64) return null;
        reachedPause();
        return waiting;
      },
    });
    await paused;
    const children = [...asset.container.children];
    const queriesAtDestroy = snapshotTrackQueryStats(track).nearestQueries;
    asset.container.destroy({ children: true, texture: false, textureSource: false });
    releasePause();

    await expect(rendering).rejects.toBe(cancelled);
    expect(children.every((child) => child.destroyed)).toBe(true);
    expect(snapshotTrackQueryStats(track).nearestQueries).toBe(queriesAtDestroy);
  }, TRACK_RENDER_TEST_TIMEOUT_MS);

  test('uses the default sampling step when offset stroke callers omit it', () => {
    const track = buildTrackModel(TRACK);
    const options = { side: 1, offset: track.width / 2 };
    const segments = getOffsetStrokeSegments(track, options);

    expect(segments.length).toBeGreaterThan(0);
    expect(segments).toEqual(getOffsetStrokeSegments(track, { ...options, step: 2 }));
  });

  test('renders normal offset edge segments but rejects non-local inside-corner chords', () => {
    const track = buildTrackModel(TRACK);
    const samples = track.samples.slice(0, -1);
    const offset = track.width / 2 + track.kerbWidth * 0.5;
    const current = samples[120];
    const next = samples[124];
    const start = offsetTrackPoint(current, offset);
    const end = offsetTrackPoint(next, offset);

    expect(offsetSegmentIsSafe(track, current, next, start, end, offset)).toBe(true);

    const farStart = offsetTrackPoint(samples[900], offset);
    const farEnd = offsetTrackPoint(samples[904], offset);
    expect(offsetSegmentIsSafe(track, current, next, farStart, farEnd, offset)).toBe(false);
  });

  test('rejects decorative edge segments that cut back over the road surface', () => {
    const track = buildTrackModel(TRACK);
    const samples = track.samples.slice(0, -1);
    const offset = track.width / 2 + track.kerbWidth * 0.5;
    const current = samples[360];
    const next = samples[364];
    const start = offsetTrackPoint(current, metersToSimUnits(2));
    const end = offsetTrackPoint(next, metersToSimUnits(2));

    expect(offsetSegmentIsSafe(track, current, next, start, end, offset)).toBe(false);
  });

  test('rejects offset decorations that intrude into a nearby non-adjacent road band', () => {
    const track = buildTrackModel(TRACK);
    const samples = track.samples.slice(0, -1);
    const offset = track.width / 2 + track.kerbWidth * 0.5;
    const current = samples[120];
    const next = samples[124];
    const nonLocalRoad = samples.find((sample) => (
      Math.abs(sample.distance - current.distance) > metersToSimUnits(70) &&
      Math.hypot(sample.x - current.x, sample.y - current.y) < metersToSimUnits(80)
    ));

    expect(nonLocalRoad).toBeTruthy();

    const start = offsetTrackPoint(nonLocalRoad, 0);
    const end = offsetTrackPoint(nonLocalRoad, track.width * 0.18);

    expect(offsetSegmentIsSafe(track, current, next, start, end, offset)).toBe(false);
  });

  test('bridges only tiny decorative gaps created by inside-corner clipping', () => {
    const track = buildTrackModel(TRACK);
    const samples = track.samples.slice(0, -1);
    const segments = getOffsetStrokeSegments(track, {
      side: 1,
      offset: track.width / 2,
      step: 4,
    });
    const bridgeWidth = metersToSimUnits(2.4);
    const bridges = getOffsetGapBridges(track, segments, bridgeWidth);

    expect(segments.filter((segment) => !segment.safe).length).toBeLessThanOrEqual(1);
    expect(bridges).toEqual([]);
    bridges.forEach((bridge) => {
      expect(offsetGapBridgeIsSafe(track, bridge.start, bridge.end, bridgeWidth)).toBe(true);
    });

    const longStart = offsetTrackPoint(samples[40], track.width / 2);
    const longEnd = offsetTrackPoint(samples[300], track.width / 2);
    expect(offsetGapBridgeIsSafe(track, longStart, longEnd, bridgeWidth)).toBe(false);
  });

  test('destroys old display children before rerendering the generated track asset', () => {
    const track = buildTrackModel(TRACK);
    const asset = new ProceduralTrackAsset();
    const oldChild = new Container();
    asset.container.addChild(oldChild);
    const destroySpy = vi.spyOn(oldChild, 'destroy');

    asset.render(track);

    expect(destroySpy).toHaveBeenCalledWith({ children: true, texture: false, textureSource: false });
    expect(asset.container.children.length).toBeGreaterThan(0);
  });

  test('renders the model-owned pit lane layer', () => {
    const track = buildTrackModel(TRACK);
    const asset = new ProceduralTrackAsset();

    asset.render(track);

    expect(track.pitLane?.boxes).toHaveLength(20);
    const runoffIndex = asset.container.children.findIndex((child) => child.label === 'pit-lane-runoff');
    const roadIndex = asset.container.children.findIndex((child) => child.label === 'pit-lane');

    expect(runoffIndex).toBeGreaterThanOrEqual(0);
    expect(roadIndex).toBeGreaterThan(runoffIndex);
  });

  test('renders grass far beyond the simulated world for deep zoom-out', () => {
    const track = buildTrackModel(TRACK);
    const asset = new ProceduralTrackAsset();

    asset.render(track);

    const grass = asset.container.children.find((child) => child.label === 'world-grass');

    expect(grass).toBeTruthy();
    expect(grass.worldGrassBounds).toEqual(expect.objectContaining({
      x: expect.any(Number),
      y: expect.any(Number),
      width: expect.any(Number),
      height: expect.any(Number),
    }));
    const expectedPadding = Math.max(WORLD.width, WORLD.height) * 8;
    expect(grass.worldGrassBounds.x).toBeLessThanOrEqual(-expectedPadding);
    expect(grass.worldGrassBounds.y).toBeLessThanOrEqual(-expectedPadding);
    expect(grass.worldGrassBounds.width).toBeGreaterThanOrEqual(WORLD.width + expectedPadding * 2);
    expect(grass.worldGrassBounds.height).toBeGreaterThanOrEqual(WORLD.height + expectedPadding * 2);
  });

  test('renders material bands from the same offsets used by simulation surfaces', () => {
    const track = buildTrackModel(TRACK);
    const bands = getTrackMaterialBands(track);

    expect(bands.kerb.inner).toBe(track.width / 2);
    expect(bands.kerb.outer).toBe(track.width / 2 + track.kerbWidth);
    expect(bands.gravel.inner).toBe(bands.kerb.outer);
    expect(bands.gravel.outer).toBe(bands.kerb.outer + track.gravelWidth);
    expect(bands.runoff.inner).toBe(bands.gravel.outer);
    expect(bands.runoff.outer).toBe(bands.gravel.outer + track.runoffWidth);
    expect(bands.barrier.center).toBe(bands.runoff.outer);
    expect(bands.barrier.inner).toBe(bands.runoff.outer - track.barrierWidth / 2);

    const asset = new ProceduralTrackAsset();
    asset.render(track);

    const gravelIndex = asset.container.children.findIndex((child) => child.label === 'track-gravel');
    const runoffIndex = asset.container.children.findIndex((child) => child.label === 'track-runoff');
    const barrierIndex = asset.container.children.findIndex((child) => child.label === 'track-barriers');
    const borderIndex = asset.container.children.findIndex((child) => child.label === 'track-borders');

    expect(gravelIndex).toBeGreaterThanOrEqual(0);
    expect(runoffIndex).toBeGreaterThan(gravelIndex);
    expect(barrierIndex).toBeGreaterThan(borderIndex);
  });

  test('renders main track asphalt and kerbs above pit-lane asphalt at crossings', () => {
    const track = buildTrackModel(TRACK);
    const asset = new ProceduralTrackAsset();

    asset.render(track);

    const roadIndex = asset.container.children.findIndex((child) => child.label === 'pit-lane');
    const asphaltIndex = asset.container.children.findIndex((child) => child.label === 'track-asphalt');
    const kerbIndex = asset.container.children.findIndex((child) => child.label === 'track-kerbs');
    const borderIndex = asset.container.children.findIndex((child) => child.label === 'track-borders');

    expect(roadIndex).toBeGreaterThanOrEqual(0);
    expect(asphaltIndex).toBeGreaterThan(roadIndex);
    expect(kerbIndex).toBeGreaterThan(roadIndex);
    expect(borderIndex).toBeGreaterThan(roadIndex);
  }, TRACK_RENDER_TEST_TIMEOUT_MS);
});
