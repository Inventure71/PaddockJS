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

describe('procedural track asset geometry', () => {
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

    asset.render(track);
    const oldChildren = [...asset.container.children];
    const destroySpies = oldChildren.map((child) => vi.spyOn(child, 'destroy'));

    asset.render(track);

    expect(oldChildren.length).toBeGreaterThan(0);
    destroySpies.forEach((spy) => {
      expect(spy).toHaveBeenCalledWith({ children: true, texture: false, textureSource: false });
    });
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
  });
});
