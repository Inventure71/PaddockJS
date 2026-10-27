import { describe, expect, test } from 'vitest';
import {
  advanceDriverEpisodes,
  buildDriverEpisodeInfo,
  createEpisodeState,
  evaluateEpisode,
  initializeDriverEpisodes,
} from '../environment/episode.js';

describe('batched driver episode horizons', () => {
  test.each([['active', 'capped'], ['capped', 'active']])('latches every driver horizon regardless of order: %j, %j', (...controlledDrivers) => {
    const state = createEpisodeState();
    initializeDriverEpisodes(state, controlledDrivers);
    state.drivers.get('capped').episodeStep = 3;
    const options = { controlledDrivers, episode: { maxSteps: 3, endOnRaceFinish: false } };
    const episode = evaluateEpisode({ raceControl: { finished: false } }, options, state);
    expect(episode).toEqual({ terminated: false, truncated: false, endReason: null });
    expect(buildDriverEpisodeInfo(state, options, episode).capped).toMatchObject({ truncated: true, episodeStep: 3 });
    advanceDriverEpisodes(state, controlledDrivers);
    expect(state.drivers.get('capped')).toMatchObject({ truncated: true, episodeStep: 3, endReason: 'max-steps' });
    expect(state.drivers.get('active')).toMatchObject({ truncated: false, episodeStep: 1 });
  });
});
