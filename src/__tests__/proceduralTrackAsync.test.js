import { afterEach, describe, expect, test, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
});

async function coldTrackModules() {
  vi.resetModules();
  const [procedural, builder, validation, cache, centerline] = await Promise.all([
    import('../simulation/track/proceduralTrack.js'),
    import('../simulation/track/trackBuilder.js'),
    import('../simulation/track/trackValidation.js'),
    import('../simulation/track/trackModelCache.js'),
    import('../simulation/track/proceduralCenterline.js'),
  ]);
  return { ...procedural, builder, validation, cache, centerline };
}

describe('async procedural track preparation', () => {
  test.each([
    ['primary candidate', 71, {}, 71],
    ['later primary candidate', 7110, {}, 387284027],
    ['accepted fallback', 3, { attempts: { primary: 1, fallback: 4 } }, 2246822516],
    ['safe fallback', 71, {
      attempts: { primary: 1, fallback: 1 },
      length: { minMeters: 1, maxMeters: 2 },
    }, 71],
    ['training profile overrides', 4101, {
      profile: 'training-short',
      length: { minMeters: 1, maxMeters: 10000 },
      validation: {
        minClearanceMultiplier: 0,
        minShapeVariation: 0,
        minNonAdjacentArcMeters: 0,
        maxLocalTurnRadians: 100,
        maxSampleHeadingDeltaRadians: 100,
      },
      attempts: { primary: 1, fallback: 1 },
    }, 4101],
  ])('matches cold synchronous output for %s', async (path, seed, options, expectedSeed) => {
    const sync = await coldTrackModules();
    const expected = sync.createProceduralTrack(seed, options);
    const expectedModel = sync.builder.buildTrackModel(expected);
    const async = await coldTrackModules();
    const checkpoint = vi.fn(() => null);
    const actual = await async.createProceduralTrackAsync(seed, options, { checkpoint });

    expect(actual).not.toBe(expected);
    expect(actual).toEqual(expected);
    expect(actual.seed).toBe(expectedSeed);
    expect(async.builder.buildTrackModel(actual).samples).toEqual(expectedModel.samples);
    expect(Object.isFrozen(actual)).toBe(true);
    expect(Object.isFrozen(actual.centerlineControls[0])).toBe(true);
    expect(async.createProceduralTrack(seed, options)).toBe(actual);
    expect(checkpoint.mock.calls.length).toBeGreaterThan(2);
    if (path === 'safe fallback') {
      expect(actual.centerlineControls).toEqual(async.centerline.generateSafeFallbackCenterlineControls(seed, actual.generationOptions.shape));
    }
  });

  test('allows another event-loop task between every candidate build', async () => {
    const modules = await coldTrackModules();
    const build = modules.builder.buildTrackModel;
    let completedTasks = 0;
    let resumed = false;
    const candidateTasks = [];
    vi.spyOn(modules.builder, 'buildTrackModel').mockImplementation((...args) => {
      candidateTasks.push(completedTasks);
      return build(...args);
    });
    const checkpoint = vi.fn(() => {
      if (resumed) {
        resumed = false;
        return null;
      }
      return new Promise((resolve) => {
        setTimeout(() => {
          completedTasks += 1;
          resumed = true;
          resolve();
        }, 0);
      });
    });

    const track = await modules.createProceduralTrackAsync(7110, {}, { checkpoint });

    expect(track.seed).toBe(387284027);
    expect(candidateTasks).toHaveLength(6);
    expect(candidateTasks[0]).toBeGreaterThan(0);
    expect(new Set(candidateTasks).size).toBe(candidateTasks.length);
    expect(completedTasks).toBeGreaterThan(candidateTasks.at(-1));
    expect(modules.createProceduralTrack(7110)).toBe(track);
    expect(candidateTasks).toHaveLength(6);
  });

  test.each(['before work', 'after build', 'before cache commit', 'while paused before cache commit'])('cancellation %s leaves no partial cached track', async (boundary) => {
    const modules = await coldTrackModules();
    const builds = vi.spyOn(modules.builder, 'buildTrackModel');
    const validations = vi.spyOn(modules.validation, 'isValidProceduralTrackModel');
    const commits = vi.spyOn(modules.cache, 'cacheProceduralTrackDefinition');
    const cancelled = new Error('Preparation cancelled');
    let cancelledWhilePaused = false;
    const checkpoint = () => {
      if (cancelledWhilePaused) throw cancelled;
      if (boundary === 'before work') throw cancelled;
      if (boundary === 'after build' && builds.mock.calls.length > 0) throw cancelled;
      if (boundary === 'before cache commit' && validations.mock.calls.length > 0) {
        return Promise.reject(cancelled);
      }
      if (boundary === 'while paused before cache commit' && validations.mock.calls.length > 0) {
        return Promise.resolve().then(() => {
          cancelledWhilePaused = true;
        });
      }
      return null;
    };

    await expect(modules.createProceduralTrackAsync(71, {}, { checkpoint })).rejects.toBe(cancelled);

    expect(builds).toHaveBeenCalledTimes(boundary === 'before work' ? 0 : 1);
    expect(validations).toHaveBeenCalledTimes(boundary.includes('cache commit') ? 1 : 0);
    expect(commits).not.toHaveBeenCalled();
    const buildsBeforeRetry = builds.mock.calls.length;
    const recovered = modules.createProceduralTrack(71);
    expect(builds).toHaveBeenCalledTimes(buildsBeforeRetry + 1);
    expect(commits).toHaveBeenCalledTimes(1);
    expect(modules.createProceduralTrack(71)).toBe(recovered);
    expect(await modules.createProceduralTrackAsync(71)).toBe(recovered);
  });
});
