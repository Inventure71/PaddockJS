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
      return transitions.map((entry) => ({ ...entry }));
    },
  };
}

export function createRolloutTransition(previousResult, action, nextResult) {
  return {
    observation: previousResult.observation,
    action,
    reward: nextResult.reward,
    nextObservation: nextResult.observation,
    terminated: nextResult.terminated,
    truncated: nextResult.truncated,
    info: nextResult.info,
  };
}
