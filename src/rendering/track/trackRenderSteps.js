// Both render paths consume the same ordered work; only startup may pause it.
export function finishTrackRenderSteps(steps) {
  let result = steps.next();
  while (!result.done) result = steps.next();
  return result.value;
}

export async function finishTrackRenderStepsAsync(steps, checkpoint) {
  try {
    while (true) {
      // Recheck after a pause: destruction may have happened while yielding.
      let pause;
      do {
        pause = checkpoint();
        if (pause) await pause;
      } while (pause);
      const result = steps.next();
      if (result.done) return result.value;
    }
  } finally {
    steps.return();
  }
}
