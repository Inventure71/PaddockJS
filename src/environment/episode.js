export function createEpisodeState() {
  return {
    step: 0,
    drivers: new Map(),
    previousSnapshot: null,
    lastResult: null,
  };
}

export function initializeDriverEpisodes(episodeState, driverIds = []) {
  episodeState.drivers = new Map(driverIds.map((driverId) => [driverId, createDriverEpisodeState()]));
}

export function advanceDriverEpisodes(episodeState, driverIds = []) {
  driverIds.forEach((driverId) => {
    const state = ensureDriverEpisodeState(episodeState, driverId);
    if (!state.terminated && !state.truncated) state.episodeStep += 1;
  });
}

export function resetDriverEpisodes(episodeState, driverIds = []) {
  driverIds.forEach((driverId) => {
    const state = ensureDriverEpisodeState(episodeState, driverId);
    state.episodeId += 1;
    state.episodeStep = 0;
    state.terminated = false;
    state.truncated = false;
    state.endReason = null;
  });
}

export function buildDriverEpisodeInfo(episodeState, options, episode) {
  return Object.fromEntries(options.controlledDrivers.map((driverId) => {
    const state = ensureDriverEpisodeState(episodeState, driverId);
    const maxStepTruncated = state.episodeStep >= options.episode.maxSteps;
    const terminated = Boolean(state.terminated || episode.terminated);
    const truncated = Boolean(state.truncated || maxStepTruncated || episode.truncated);
    const endReason = state.endReason ??
      (terminated ? episode.endReason : null) ??
      (maxStepTruncated ? 'max-steps' : null) ??
      (truncated ? episode.endReason : null);
    return [driverId, {
      terminated,
      truncated,
      endReason,
      episodeStep: state.episodeStep,
      episodeId: state.episodeId,
    }];
  }));
}

export function evaluateEpisode(snapshot, options, episodeState) {
  if (snapshot.raceControl.finished && options.episode.endOnRaceFinish) {
    return { terminated: true, truncated: false, endReason: 'race-finish' };
  }
  if (episodeState.step >= options.episode.maxSteps) {
    return { terminated: false, truncated: true, endReason: 'max-steps' };
  }
  return { terminated: false, truncated: false, endReason: null };
}

function createDriverEpisodeState() {
  return {
    episodeStep: 0,
    episodeId: 0,
    terminated: false,
    truncated: false,
    endReason: null,
  };
}

function ensureDriverEpisodeState(episodeState, driverId) {
  if (!episodeState.drivers) episodeState.drivers = new Map();
  if (!episodeState.drivers.has(driverId)) episodeState.drivers.set(driverId, createDriverEpisodeState());
  return episodeState.drivers.get(driverId);
}
