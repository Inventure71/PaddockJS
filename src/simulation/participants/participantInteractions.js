export const PARTICIPANT_INTERACTION_PROFILES = Object.freeze({
  normal: Object.freeze({
    profile: 'normal',
    collidable: true,
    detectableByRays: true,
    detectableAsNearby: true,
    blocksPitLane: true,
    affectsRaceOrder: true,
  }),
  'isolated-training': Object.freeze({
    profile: 'isolated-training',
    collidable: false,
    detectableByRays: false,
    detectableAsNearby: false,
    blocksPitLane: false,
    affectsRaceOrder: true,
  }),
  'batch-training': Object.freeze({
    profile: 'batch-training',
    collidable: false,
    detectableByRays: false,
    detectableAsNearby: false,
    blocksPitLane: false,
    affectsRaceOrder: false,
  }),
  'phantom-race': Object.freeze({
    profile: 'phantom-race',
    collidable: false,
    detectableByRays: true,
    detectableAsNearby: true,
    blocksPitLane: false,
    affectsRaceOrder: true,
  }),
  'time-trial-overlay': Object.freeze({
    profile: 'time-trial-overlay',
    collidable: false,
    detectableByRays: false,
    detectableAsNearby: false,
    blocksPitLane: false,
    affectsRaceOrder: false,
  }),
});

export function normalizeParticipantInteractions(options = {}) {
  const defaultProfile = resolveProfileName(options.defaultProfile);
  const defaultInteraction = { ...PARTICIPANT_INTERACTION_PROFILES[defaultProfile] };
  const drivers = {};
  Object.entries(options.drivers ?? {}).forEach(([driverId, override]) => {
    drivers[driverId] = resolveInteraction(override, defaultProfile);
  });
  return {
    defaultProfile,
    defaultInteraction,
    drivers,
  };
}

export function attachParticipantInteractions(cars = [], options = {}) {
  const normalized = normalizeParticipantInteractions(options);
  cars.forEach((car) => {
    car.interaction = normalized.drivers[car.id] ?? { ...normalized.defaultInteraction };
  });
  return normalized;
}

export function resolveInteraction(override = {}, fallbackProfile = 'normal') {
  const profile = resolveProfileName(override?.profile ?? fallbackProfile);
  const base = PARTICIPANT_INTERACTION_PROFILES[profile];
  return {
    profile,
    collidable: override?.collidable != null ? Boolean(override.collidable) : base.collidable,
    detectableByRays: override?.detectableByRays != null ? Boolean(override.detectableByRays) : base.detectableByRays,
    detectableAsNearby: override?.detectableAsNearby != null ? Boolean(override.detectableAsNearby) : base.detectableAsNearby,
    blocksPitLane: override?.blocksPitLane != null ? Boolean(override.blocksPitLane) : base.blocksPitLane,
    affectsRaceOrder: override?.affectsRaceOrder != null ? Boolean(override.affectsRaceOrder) : base.affectsRaceOrder,
  };
}

export function canCollide(first, second) {
  return isCollidable(first) && isCollidable(second);
}

export function isCollidable(car) {
  if (car?.destroyed || car?.outOfRace) return false;
  return car?.interaction?.collidable !== false;
}

export function isRayDetectable(car) {
  if (car?.destroyed || car?.outOfRace) return false;
  return car?.interaction?.detectableByRays !== false;
}

export function isNearbyDetectable(car) {
  if (car?.destroyed || car?.outOfRace) return false;
  return car?.interaction?.detectableAsNearby !== false;
}

export function blocksPitLane(car) {
  if (car?.destroyed || car?.outOfRace) return false;
  return car?.interaction?.blocksPitLane !== false;
}

export function affectsRaceOrder(car) {
  if (car?.destroyed || car?.outOfRace) return false;
  return car?.interaction?.affectsRaceOrder !== false;
}

export function serializeParticipantInteraction(interaction) {
  return resolveInteraction(interaction ?? {}, interaction?.profile ?? 'normal');
}

const SERIALIZED_INTERACTION_SOURCE = Symbol('serializedInteractionSource');
const SERIALIZED_INTERACTION_VALUE = Symbol('serializedInteractionValue');

// Render snapshots are pooled and rebuilt every frame; the interaction config
// only changes when a new object is attached, so cache the serialized form per
// car keyed on the interaction reference.
export function serializeParticipantInteractionCached(car) {
  if (car[SERIALIZED_INTERACTION_SOURCE] !== car.interaction || !car[SERIALIZED_INTERACTION_VALUE]) {
    car[SERIALIZED_INTERACTION_SOURCE] = car.interaction;
    car[SERIALIZED_INTERACTION_VALUE] = serializeParticipantInteraction(car.interaction);
  }
  return car[SERIALIZED_INTERACTION_VALUE];
}

function resolveProfileName(profile) {
  const key = String(profile ?? 'normal');
  return PARTICIPANT_INTERACTION_PROFILES[key] ? key : 'normal';
}
