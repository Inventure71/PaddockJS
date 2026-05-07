#!/usr/bin/env node

import { createPaddockEnvironment, createProgressReward } from '@inventure71/paddockjs/environment';
import { TRAINING_DEMO_DRIVERS, TRAINING_DEMO_ENTRIES } from './trainingData.mjs';

const DEFAULT_OPTIONS = Object.freeze({
  generations: 4,
  candidates: 5,
  episodes: 1,
  steps: 240,
  frameSkip: 4,
  seed: 71,
  traffic: false,
  evalOnly: false,
});

const INITIAL_POLICY = Object.freeze({
  steeringHeading: -1.2,
  steeringOffset: -0.35,
  steeringRayBalance: 0.45,
  throttleBias: 0.72,
  throttleFrontClearance: 0.28,
  throttleSpeedDamping: 0.18,
  brakeBias: 0,
  brakeFrontDanger: 0.65,
  brakeOffTrack: 0.2,
});

const POLICY_KEYS = Object.keys(INITIAL_POLICY);

main();

function main() {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const driverId = TRAINING_DEMO_DRIVERS[0].id;
  const rng = createSeededRandom(options.seed);
  const reward = createProgressReward();
  const evaluate = (policy, seedOffset = 0) => evaluatePolicy({
    policy,
    driverId,
    reward,
    options,
    seedOffset,
  });

  if (options.evalOnly) {
    const baseline = evaluate(INITIAL_POLICY);
    printSummary({ options, driverId, bestPolicy: INITIAL_POLICY, best: baseline });
    return;
  }

  let bestPolicy = { ...INITIAL_POLICY };
  let best = evaluate(bestPolicy);

  console.log(formatGenerationLine(0, best));

  for (let generation = 1; generation <= options.generations; generation += 1) {
    const mutationScale = 0.45 / Math.sqrt(generation);
    const candidates = [{ policy: bestPolicy, scoreSeedOffset: generation * 1000 }];

    for (let index = 1; index < options.candidates; index += 1) {
      candidates.push({
        policy: mutatePolicy(bestPolicy, rng, mutationScale),
        scoreSeedOffset: generation * 1000 + index * 100,
      });
    }

    for (const candidate of candidates) {
      const score = evaluate(candidate.policy, candidate.scoreSeedOffset);
      if (score.averageReward > best.averageReward) {
        best = score;
        bestPolicy = candidate.policy;
      }
    }

    console.log(formatGenerationLine(generation, best));
  }

  printSummary({ options, driverId, bestPolicy, best });
}

function evaluatePolicy({ policy, driverId, reward, options, seedOffset = 0 }) {
  let totalReward = 0;
  let totalDistanceMeters = 0;
  let totalCollisions = 0;
  let totalOffTrackSteps = 0;
  let completedEpisodes = 0;

  for (let episode = 0; episode < options.episodes; episode += 1) {
    const env = createTrainingEnvironment({ driverId, reward, options, episode, seedOffset });
    let result = env.reset();
    let episodeReward = 0;

    for (let step = 0; step < options.steps && !result.done; step += 1) {
      const observation = result.observation[driverId];
      const action = chooseAction(policy, observation);
      result = env.step({ [driverId]: action });
      episodeReward += result.reward?.[driverId] ?? 0;
      totalCollisions += result.events.filter((event) => event.type === 'collision').length;
      if (result.observation[driverId]?.object?.self?.onTrack === false) totalOffTrackSteps += 1;
    }

    const car = result.state.snapshot.cars.find((entry) => entry.id === driverId);
    totalReward += episodeReward;
    totalDistanceMeters += Number(car?.distanceMeters ?? 0);
    completedEpisodes += 1;
    env.destroy();
  }

  return {
    averageReward: totalReward / Math.max(1, completedEpisodes),
    averageDistanceMeters: totalDistanceMeters / Math.max(1, completedEpisodes),
    collisions: totalCollisions,
    offTrackSteps: totalOffTrackSteps,
  };
}

function createTrainingEnvironment({ driverId, reward, options, episode, seedOffset }) {
  const drivers = options.traffic ? TRAINING_DEMO_DRIVERS.slice(0, 8) : TRAINING_DEMO_DRIVERS.slice(0, 1);
  return createPaddockEnvironment({
    drivers,
    entries: TRAINING_DEMO_ENTRIES,
    controlledDrivers: [driverId],
    seed: options.seed + seedOffset + episode,
    trackSeed: options.seed + 2026 + seedOffset + episode,
    totalLaps: 3,
    frameSkip: options.frameSkip,
    scenario: {
      participants: options.traffic ? 'all' : 'controlled-only',
      nonControlled: 'ai',
    },
    episode: {
      maxSteps: options.steps,
      endOnRaceFinish: true,
    },
    rules: {
      standingStart: false,
    },
    reward,
  });
}

function chooseAction(policy, observation) {
  const self = observation.object.self;
  const frontRay = getRayDistance(observation, 0);
  const leftRay = getRayDistance(observation, -60);
  const rightRay = getRayDistance(observation, 60);
  const frontDanger = clamp01((35 - frontRay) / 35);
  const rayBalanceMeters = rightRay - leftRay;

  const steering = clamp(
    policy.steeringHeading * self.trackHeadingErrorRadians +
      policy.steeringOffset * (self.trackOffsetMeters / 12) +
      policy.steeringRayBalance * (rayBalanceMeters / 120),
    -1,
    1,
  );
  const throttle = clamp01(
    policy.throttleBias +
      policy.throttleFrontClearance * (frontRay / 120) -
      policy.throttleSpeedDamping * (self.speedKph / 320) -
      (self.onTrack ? 0 : 0.35),
  );
  const brake = clamp01(
    policy.brakeBias +
      policy.brakeFrontDanger * frontDanger +
      (self.onTrack ? 0 : policy.brakeOffTrack),
  );

  return { steering, throttle, brake };
}

function getRayDistance(observation, angleDegrees) {
  const ray = observation.object.rays.find((entry) => entry.angleDegrees === angleDegrees);
  return Number(ray?.track?.distanceMeters ?? ray?.lengthMeters ?? 120);
}

function mutatePolicy(policy, rng, scale) {
  return Object.fromEntries(POLICY_KEYS.map((key) => [
    key,
    policy[key] + randomNormal(rng) * scale,
  ]));
}

function parseCliArgs(argv) {
  const options = { ...DEFAULT_OPTIONS };

  for (const arg of argv) {
    const [name, rawValue] = arg.split('=');
    if (name === '--help' || name === '-h') options.help = true;
    else if (name === '--eval-only') options.evalOnly = true;
    else if (name === '--traffic') options.traffic = true;
    else if (name === '--no-traffic') options.traffic = false;
    else if (name === '--generations') options.generations = parsePositiveInt(rawValue, name);
    else if (name === '--candidates') options.candidates = parsePositiveInt(rawValue, name);
    else if (name === '--episodes') options.episodes = parsePositiveInt(rawValue, name);
    else if (name === '--steps') options.steps = parsePositiveInt(rawValue, name);
    else if (name === '--frame-skip') options.frameSkip = parsePositiveInt(rawValue, name);
    else if (name === '--seed') options.seed = parsePositiveInt(rawValue, name);
    else throw new Error(`Unknown option: ${name}`);
  }

  return options;
}

function parsePositiveInt(value, optionName) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${optionName} requires a positive integer value.`);
  }
  return parsed;
}

function createSeededRandom(seed) {
  let state = seed >>> 0;
  return function random() {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function randomNormal(rng) {
  const a = Math.max(Number.EPSILON, rng());
  const b = Math.max(Number.EPSILON, rng());
  return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function formatGenerationLine(generation, score) {
  return [
    `generation=${generation}`,
    `reward=${score.averageReward.toFixed(2)}`,
    `distanceMeters=${score.averageDistanceMeters.toFixed(1)}`,
    `collisions=${score.collisions}`,
    `offTrackSteps=${score.offTrackSteps}`,
  ].join(' ');
}

function printSummary({ options, driverId, bestPolicy, best }) {
  console.log(JSON.stringify({
    driverId,
    options,
    best,
    bestPolicy,
  }, null, 2));
}

function printHelp() {
  console.log(`Usage: node examples/train-basic-policy.mjs [options]

Options:
  --generations=N   Random-search generations. Default: ${DEFAULT_OPTIONS.generations}
  --candidates=N    Candidate policies per generation. Default: ${DEFAULT_OPTIONS.candidates}
  --episodes=N      Episodes per policy evaluation. Default: ${DEFAULT_OPTIONS.episodes}
  --steps=N         Maximum manual environment steps per episode. Default: ${DEFAULT_OPTIONS.steps}
  --frame-skip=N    Simulator frames advanced by each step(action). Default: ${DEFAULT_OPTIONS.frameSkip}
  --seed=N          Deterministic random seed. Default: ${DEFAULT_OPTIONS.seed}
  --traffic         Keep built-in AI traffic on track during training.
  --eval-only       Evaluate the starter policy without training.
`);
}
