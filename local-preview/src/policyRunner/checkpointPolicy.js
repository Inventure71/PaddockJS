import {
  encodeHybridObservation,
  encodeSoloRayHybridObservation,
} from './observationEncoders.js';
import {
  attentionPool,
  clampPolicyAction,
  fitCheckpointInput,
  meanRows,
  reluVector,
  runCheckpointActor,
  runLinear,
  sigmoid,
  zeros,
} from './numeric.js';

export function checkpointPolicyUrl(policyPath) {
  if (policyPath.startsWith('/')) return policyPath;
  return `/local-checkpoints/${policyPath}`;
}

export async function loadCheckpointPolicyPayload(url) {
  let response = null;
  try {
    response = await fetch(url, { cache: 'no-store' });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const payload = await response.json();
  if (!['paddockjs-training-lab-hybrid-policy-v1', 'paddockjs-training-lab-sac-actor-v1'].includes(payload?.format)) {
    throw new Error(`Unsupported checkpoint policy format: ${payload?.format ?? 'unknown'}.`);
  }
  if (payload.format === 'paddockjs-training-lab-sac-actor-v1' && (!Array.isArray(payload.layers) || payload.layers.length !== 4)) {
    throw new Error('Checkpoint policy must contain four exported actor layers.');
  }
  if (payload.format === 'paddockjs-training-lab-hybrid-policy-v1' && !payload.weights) {
    throw new Error('Hybrid checkpoint policy must contain exported weights.');
  }
  return payload;
}

export function createCheckpointPolicy(payload) {
  if (payload.format === 'paddockjs-training-lab-hybrid-policy-v1') {
    return createHybridCheckpointPolicy(payload);
  }
  return createLegacySacCheckpointPolicy(payload);
}

function createLegacySacCheckpointPolicy(payload) {
  const states = new Map();

  function stateFor(observation, driverId = null) {
    const key = driverId ?? observation?.object?.self?.id ?? 'default';
    if (!states.has(key)) {
      states.set(key, { previousAction: [0, 0], previousSpeed: 0, previousOffset: 0 });
    }
    return states.get(key);
  }

  return {
    resetState() {
      states.clear();
    },
    predict(observation, driverId = null) {
      const state = stateFor(observation, driverId);
      const self = observation.object.self;
      const speed = Number(self?.speedKph ?? 0);
      const offset = Number(self?.trackOffsetMeters ?? 0);
      const vector = Array.from(observation.vector ?? []);
      vector.push(
        state.previousAction[0],
        state.previousAction[1],
        (speed - state.previousSpeed) / 100,
        (offset - state.previousOffset) / 20,
      );
      const input = fitCheckpointInput(vector, payload.obsDim);
      const actorOutput = runCheckpointActor(input, payload.layers);
      const steering = clampPolicyAction(actorOutput[0] ?? 0, -1, 1);
      const accel = clampPolicyAction(actorOutput[1] ?? 0, -1, 1);
      state.previousAction = [steering, accel];
      state.previousSpeed = speed;
      state.previousOffset = offset;
      return actionFromSteeringAccel(steering, accel);
    },
  };
}

function createHybridCheckpointPolicy(payload) {
  const model = payload.model;
  const weights = payload.weights;
  const states = new Map();
  const debugState = { memoryBin: 0, memoryWrites: 0 };

  function createState() {
    return {
      hidden: zeros(model.hiddenSize),
      lapMemory: Array.from({ length: model.memoryBins }, () => zeros(model.memoryDim)),
      previousAction: [0, 0],
      previousSpeed: 0,
      previousOffset: 0,
      debugState: { memoryBin: 0, memoryWrites: 0 },
    };
  }

  function stateFor(observation, driverId = null) {
    const key = driverId ?? observation?.object?.self?.id ?? 'default';
    if (!states.has(key)) states.set(key, createState());
    return states.get(key);
  }

  return {
    debugState,
    debugStateFor(driverId) {
      return states.get(driverId)?.debugState ?? debugState;
    },
    resetState(driverId = null) {
      if (driverId) {
        states.delete(driverId);
      } else {
        states.clear();
      }
      debugState.memoryBin = 0;
      debugState.memoryWrites = 0;
    },
    predict(observation, driverId = null) {
      const state = stateFor(observation, driverId);
      const tensors = model.inputProfile === 'solo-ray-v1' || model.inputProfile === 'solo-ray-track-v1'
        ? encodeSoloRayHybridObservation(
          observation,
          state.previousAction,
          state.previousSpeed,
          state.previousOffset,
          model.inputProfile === 'solo-ray-track-v1',
          {
            rayLayout: model.rayLayout ?? payload.rayLayout ?? 'driver-front-heavy',
            rayCount: model.groups?.rayCount ?? model.rayCount,
          },
        )
        : encodeHybridObservation(observation, state.previousAction, state.previousSpeed, state.previousOffset, model);
      const memoryProgress = clampPolicyAction(tensors.memory[0], 0, 0.999999);
      const memoryBin = Math.min(model.memoryBins - 1, Math.max(0, Math.floor(memoryProgress * model.memoryBins)));
      const memoryValue = state.lapMemory[memoryBin];
      const encoded = runHybridEncoder(tensors, memoryValue, weights);
      const previousHidden = model.recurrentMode === 'stateless' ? zeros(model.hiddenSize) : state.hidden;
      const nextHidden = runGruCell(encoded, previousHidden, weights, 'gru');
      state.hidden = model.recurrentMode === 'stateless' ? zeros(model.hiddenSize) : nextHidden;
      const mean = runLinear(state.hidden, weights['action_mean.weight'], weights['action_mean.bias']).map(Math.tanh);
      const gate = runLinear(state.hidden, weights['memory_gate.weight'], weights['memory_gate.bias']).map(sigmoid);
      const write = runLinear(state.hidden, weights['memory_write.weight'], weights['memory_write.bias']).map(Math.tanh);
      state.lapMemory[memoryBin] = memoryValue.map((value, index) => (1 - gate[index]) * value + gate[index] * write[index]);
      const steering = clampPolicyAction(mean[0] ?? 0, -1, 1);
      const accel = clampPolicyAction(mean[1] ?? 0, -1, 1);
      const self = observation.object.self;
      state.previousAction = [steering, accel];
      state.previousSpeed = Number(self?.speedKph ?? 0);
      state.previousOffset = Number(observation.object.trackRelation?.lateralOffsetMeters ?? self?.trackOffsetMeters ?? 0);
      state.debugState.memoryBin = memoryBin;
      state.debugState.memoryWrites += gate.reduce((sum, value) => sum + value, 0) / Math.max(1, gate.length);
      debugState.memoryBin = memoryBin;
      debugState.memoryWrites = state.debugState.memoryWrites;
      return actionFromSteeringAccel(steering, accel);
    },
  };
}

function actionFromSteeringAccel(steering, accel) {
  return {
    steering,
    throttle: accel >= 0 ? accel : 0,
    brake: accel < 0 ? -accel : 0,
  };
}

function runHybridEncoder(tensors, memoryValue, weights) {
  const body = runMlp(tensors.body, weights, 'body_encoder');
  const track = runMlp(tensors.track, weights, 'track_encoder');
  const patches = meanRows(tensors.contact_patches.map((row) => runMlp(row, weights, 'patch_encoder')));
  const rayInputSize = Number(weights['ray_encoder.0.weight']?.[0]?.length ?? 0);
  const flatRayInput = tensors.rays.flat();
  const rays = rayInputSize === flatRayInput.length
    ? runMlp(flatRayInput, weights, 'ray_encoder')
    : runLegacyRayAttention(tensors.rays, weights);
  const opponentRows = tensors.opponents.map((row) => runMlp(row, weights, 'opponent_encoder'));
  const opponentMask = tensors.opponents.map((row) => row[0] > 0.5);
  const opponents = attentionPool(opponentRows, opponentRows.map((row) => runLinear(row, weights['opponent_score.weight'], weights['opponent_score.bias'])[0]), opponentMask);
  const race = runMlp(tensors.race, weights, 'race_encoder');
  return runMlp([...body, ...track, ...patches, ...rays, ...opponents, ...race, ...memoryValue], weights, 'fusion');
}

function runLegacyRayAttention(rays, weights) {
  const rayRows = rays.map((row) => runMlp(row, weights, 'ray_encoder'));
  return attentionPool(rayRows, rayRows.map((row) => runLinear(row, weights['ray_score.weight'], weights['ray_score.bias'])[0]));
}

function runMlp(input, weights, prefix) {
  return reluVector(runLinear(
    reluVector(runLinear(input, weights[`${prefix}.0.weight`], weights[`${prefix}.0.bias`])),
    weights[`${prefix}.2.weight`],
    weights[`${prefix}.2.bias`],
  ));
}

function runGruCell(input, previousHidden, weights, prefix) {
  const inputGates = runLinear(input, weights[`${prefix}.weight_ih`], weights[`${prefix}.bias_ih`]);
  const hiddenGates = runLinear(previousHidden, weights[`${prefix}.weight_hh`], weights[`${prefix}.bias_hh`]);
  const hiddenSize = previousHidden.length;
  const reset = zeros(hiddenSize);
  const update = zeros(hiddenSize);
  const next = zeros(hiddenSize);
  for (let index = 0; index < hiddenSize; index += 1) {
    reset[index] = sigmoid(inputGates[index] + hiddenGates[index]);
    update[index] = sigmoid(inputGates[hiddenSize + index] + hiddenGates[hiddenSize + index]);
    next[index] = Math.tanh(inputGates[hiddenSize * 2 + index] + reset[index] * hiddenGates[hiddenSize * 2 + index]);
  }
  return previousHidden.map((value, index) => (1 - update[index]) * next[index] + update[index] * value);
}
