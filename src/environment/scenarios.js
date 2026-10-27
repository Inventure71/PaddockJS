import { applyEnvironmentPlacements } from './scenarioPlacements.js';
import { buildPresetPlacements } from './scenarioPresets.js';
export { ENVIRONMENT_SCENARIO_PRESETS } from './scenarioPresets.js';
export { resolveScenarioPlacementConfig, normalizeEnvironmentPlacements } from './scenarioOptions.js';
export { applyEnvironmentPlacements } from './scenarioPlacements.js';

export function applyEnvironmentScenario(sim, options) {
  const scenario = options.scenario ?? {};
  if (!scenario.preset && Object.keys(scenario.placements ?? {}).length === 0 && (scenario.traffic ?? []).length === 0) {
    return;
  }

  const snapshot = sim.snapshot();
  const carsById = new Map(snapshot.cars.map((car) => [car.id, car]));
  const placements = {
    ...buildPresetPlacements(snapshot, options),
    ...(scenario.placements ?? {}),
  };

  applyEnvironmentPlacements(sim, snapshot.track, carsById, placements);

  const nextSnapshot = sim.snapshot();
  const nextCarsById = new Map(nextSnapshot.cars.map((car) => [car.id, car]));
  scenario.traffic?.forEach((trafficPlacement) => {
    const reference = nextCarsById.get(trafficPlacement.relativeTo);
    const car = nextCarsById.get(trafficPlacement.driverId);
    if (!reference || !car) return;
    applyEnvironmentPlacements(sim, nextSnapshot.track, nextCarsById, {
      [trafficPlacement.driverId]: {
      distanceMeters: reference.distanceMeters + trafficPlacement.deltaDistanceMeters,
      offsetMeters: trafficPlacement.offsetMeters,
      speedKph: trafficPlacement.speedKph ?? reference.speedKph,
      headingErrorRadians: trafficPlacement.headingErrorRadians ?? 0,
      },
    });
  });
}
