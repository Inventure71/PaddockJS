export function createEpisodeState() {
  return {
    step: 0,
    previousSnapshot: null,
    lastResult: null,
  };
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
