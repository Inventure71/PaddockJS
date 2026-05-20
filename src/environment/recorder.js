export function createRolloutRecorder() {
  const transitions = [];
  return {
    recordStep(previousResult, action, nextResult) {
      const transition = createRolloutTransition(previousResult, action, nextResult);
      transitions.push(transition);
      return transition;
    },
    clear() {
      transitions.length = 0;
    },
    toJSON() {
      return transitions.map((entry) => cloneTrainingValue(entry));
    },
  };
}

export function createRolloutTransition(previousResult, action, nextResult) {
  return {
    observation: cloneTrainingValue(previousResult.observation),
    action: cloneTrainingValue(action),
    reward: cloneTrainingValue(nextResult.reward),
    nextObservation: cloneTrainingValue(nextResult.observation),
    terminated: nextResult.terminated,
    truncated: nextResult.truncated,
    info: cloneTrainingValue(nextResult.info),
  };
}

function cloneTrainingValue(value) {
  if (value == null || typeof value !== 'object') return value;
  if (ArrayBuffer.isView(value)) return Array.from(value);
  if (Array.isArray(value)) return value.map(cloneTrainingValue);
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneTrainingValue(entry)]));
}
