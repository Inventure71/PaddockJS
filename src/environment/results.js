import { buildDriverEpisodeInfo, evaluateEpisode, markDestroyedDriverEpisodes } from './episode.js';
import { buildDriverMetrics } from './metrics.js';
import { buildEnvironmentObservation } from './observations.js';

export function buildEnvironmentResult({
  host,
  episodeState,
  events,
  actionErrors,
  actions = {},
  controlledDrivers = null,
  stateOutput = null,
  rewardEnabled = false,
}) {
  const options = host.getOptions();
  const sim = host.getSimulation();
  const resultDrivers = controlledDrivers ?? options.controlledDrivers;
  const resolvedStateOutput = stateOutput ?? options.result.stateOutput;
  const observationSnapshot = snapshotForResult(sim, options, resolvedStateOutput);
  markDestroyedDriverEpisodes(episodeState, options.controlledDrivers, observationSnapshot);
  const observation = buildEnvironmentObservation({
    snapshot: observationSnapshot,
    options,
    events,
    controlledDrivers: resultDrivers,
    scratch: episodeState.observationScratch,
  });
  const episode = evaluateEpisode(observationSnapshot, options, episodeState, resultDrivers);
  const metrics = buildDriverMetrics({
    snapshot: observationSnapshot,
    previousSnapshot: episodeState.previousSnapshot,
    options: { ...options, controlledDrivers: resultDrivers },
    events,
    scratch: episodeState.metricScratch,
  });
  const rewardEpisodeInfo = buildDriverEpisodeInfo(episodeState, {
    ...options,
    controlledDrivers: resultDrivers,
  }, episode);
  const driverEpisode = resultDrivers === options.controlledDrivers
    ? episode
    : evaluateEpisode(observationSnapshot, options, episodeState, options.controlledDrivers);
  const driverEpisodeInfo = buildDriverEpisodeInfo(episodeState, options, driverEpisode);
  const { state, rewardSnapshot } = buildResultState(sim, observationSnapshot, resolvedStateOutput);
  const reward = rewardEnabled
    ? computeReward({
      options: { ...options, controlledDrivers: resultDrivers },
      observation,
      events,
      snapshot: rewardSnapshot,
      actions,
      previousSnapshot: episodeState.previousSnapshot,
      metrics,
      driverEpisodeInfo: rewardEpisodeInfo,
    })
    : null;
  episodeState.lastObservationSnapshot = observationSnapshot;
  episodeState.lastRewardSnapshot = rewardSnapshot;
  return {
    observation,
    reward,
    metrics,
    terminated: episode.terminated,
    truncated: episode.truncated,
    done: episode.terminated || episode.truncated,
    events,
    state,
    info: {
      step: episodeState.step,
      elapsedSeconds: observationSnapshot.time,
      seed: options.seed,
      trackSeed: options.trackSeed,
      controlledDrivers: [...resultDrivers],
      actionErrors,
      endReason: episode.endReason,
      drivers: driverEpisodeInfo,
    },
  };
}

function buildResultState(sim, observationSnapshot, stateOutput) {
  if (stateOutput === 'none') return { state: null, rewardSnapshot: observationSnapshot };
  if (stateOutput === 'minimal') return { state: { snapshot: observationSnapshot }, rewardSnapshot: observationSnapshot };
  const snapshot = sim.snapshot();
  return { state: { snapshot }, rewardSnapshot: snapshot };
}

export function snapshotForResult(sim, options, stateOutput) {
  if (canUseTrainingSnapshot(options, stateOutput) && !hasExternalRenderer(options)) {
    return sim.snapshotTraining?.() ?? sim.snapshotObservation?.() ?? sim.snapshot();
  }
  return sim.snapshotObservation?.() ?? sim.snapshot();
}

function hasExternalRenderer(options) {
  return typeof options?.externalRenderer?.onFrame === 'function';
}

function canUseTrainingSnapshot(options, stateOutput) {
  return stateOutput === 'none' &&
    options.observation?.output === 'vector' &&
    options.observation?.includeSchema === false;
}

function computeReward({ options, observation, events, snapshot, actions, previousSnapshot, metrics, driverEpisodeInfo }) {
  if (!options.reward) return null;
  return Object.fromEntries(options.controlledDrivers.map((driverId) => [
    driverId,
    normalizeRewardValue(options.reward({
      driverId,
      previous: previousSnapshot,
      current: observation[driverId],
      action: actions?.[driverId],
      events: observation[driverId]?.events ?? events,
      state: { snapshot },
      metrics: metrics?.[driverId] ?? null,
      episode: driverEpisodeInfo?.[driverId] ?? null,
    })),
  ]));
}

function normalizeRewardValue(value) {
  const reward = Number(value ?? 0);
  return Number.isFinite(reward) ? reward : 0;
}
