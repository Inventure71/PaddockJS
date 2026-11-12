import { createProceduralTrackAsync } from '../../simulation/track/proceduralTrack.js';

export async function prepareBrowserSimulation(app, checkpoint) {
  await checkpoint(true);
  // Populate the existing immutable geometry cache cooperatively. The normal
  // simulation factory still owns warmup, RNG and mutable per-race state.
  await createProceduralTrackAsync(app.options.trackSeed ?? app.trackSeed,
    app.options.trackGeneration, { checkpoint });
  await checkpoint(true);
  return app.createRaceSimulation();
}
