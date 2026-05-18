const SURFACE_PRIORITY = {
  track: 0,
  'pit-entry': 1,
  'pit-exit': 1,
  'pit-lane': 2,
  'pit-box': 3,
  kerb: 4,
  grass: 5,
  gravel: 6,
  barrier: 7,
};

export function priority(surface) {
  return SURFACE_PRIORITY[surface] ?? SURFACE_PRIORITY.barrier;
}

export function worstState(states) {
  return states.reduce((worst, state) => (
    priority(state.surface) > priority(worst.surface) ? state : worst
  ), states[0]);
}

export function getEffectiveSurface(wheels = []) {
  if (!wheels.length) return 'track';
  return wheels.reduce((surface, wheel) => (
    priority(wheel.surface) > priority(surface) ? wheel.surface : surface
  ), 'track');
}
