const DEFAULT_WARMUP_POLICY = 'config-change';
const DEFAULT_WARMUP_STEPS = Object.freeze({
  simulation: 20,
  browser: 20,
  environment: 20,
});
const SUPPORTED_WARMUP_POLICIES = new Set(['config-change', 'always', 'never']);
const MAX_CACHE_ENTRIES_PER_SURFACE = 256;
const warmupFingerprintCache = new Map();

export function normalizeWarmupOptions(input, surface = 'simulation') {
  const fallbackSteps = DEFAULT_WARMUP_STEPS[surface] ?? DEFAULT_WARMUP_STEPS.simulation;
  if (input === false) {
    return {
      enabled: false,
      policy: 'never',
      steps: fallbackSteps,
      surface,
    };
  }
  if (input === true || input == null) {
    return {
      enabled: true,
      policy: DEFAULT_WARMUP_POLICY,
      steps: fallbackSteps,
      surface,
    };
  }
  const enabled = input.enabled == null ? true : Boolean(input.enabled);
  const policy = normalizeWarmupPolicy(input.policy, enabled);
  return {
    enabled,
    policy,
    steps: normalizeWarmupSteps(input.steps, fallbackSteps),
    surface: typeof input.surface === 'string' && input.surface.length > 0 ? input.surface : surface,
  };
}

export function withWarmupSurfaceOptions(options = {}, surface = 'simulation') {
  return {
    ...options,
    warmup: normalizeWarmupOptions(options.warmup, surface),
  };
}

export function disableWarmupOptions(options = {}, surface = 'simulation') {
  const warmup = normalizeWarmupOptions(options.warmup, surface);
  return {
    ...options,
    warmup: {
      ...warmup,
      enabled: false,
      policy: 'never',
      surface,
    },
  };
}

export function runWarmupWithGuard({
  options = {},
  surface = 'simulation',
  execute,
} = {}) {
  const warmup = normalizeWarmupOptions(options.warmup, surface);
  const fingerprint = createWarmupFingerprint(options, {
    surface: warmup.surface,
    steps: warmup.steps,
  });
  if (!shouldRunWarmup(warmup, fingerprint)) {
    return { ran: false, warmup, fingerprint };
  }
  try {
    execute?.({ warmup, fingerprint });
    markWarmupComplete(warmup.surface, fingerprint);
    return { ran: true, warmup, fingerprint };
  } catch {
    return { ran: false, warmup, fingerprint };
  }
}

export function resetWarmupRuntimeCache() {
  warmupFingerprintCache.clear();
}

function shouldRunWarmup(warmup, fingerprint) {
  if (!warmup.enabled) return false;
  if (warmup.policy === 'never') return false;
  if (warmup.policy === 'always') return true;
  return !hasWarmupFingerprint(warmup.surface, fingerprint);
}

function hasWarmupFingerprint(surface, fingerprint) {
  return warmupFingerprintCache.get(surface)?.has(fingerprint) ?? false;
}

function markWarmupComplete(surface, fingerprint) {
  let entries = warmupFingerprintCache.get(surface);
  if (!entries) {
    entries = new Map();
    warmupFingerprintCache.set(surface, entries);
  }
  entries.set(fingerprint, Date.now());
  while (entries.size > MAX_CACHE_ENTRIES_PER_SURFACE) {
    const firstKey = entries.keys().next().value;
    entries.delete(firstKey);
  }
}

function createWarmupFingerprint(options, { surface, steps }) {
  return stableStringify({
    surface,
    steps,
    seed: finiteOrNull(options.seed),
    trackSeed: finiteOrNull(options.trackSeed),
    totalLaps: finiteOrNull(options.totalLaps),
    trackGeneration: options.trackGeneration ?? null,
    track: summarizeTrack(options.track),
    physicsMode: options.physicsMode ?? null,
    trackQueryIndex: options.trackQueryIndex !== false,
    rules: options.rules ?? null,
    participantInteractions: options.participantInteractions ?? null,
    replayGhosts: summarizeReplayGhosts(options.replayGhosts),
    drivers: summarizeDrivers(options.drivers),
    entries: summarizeEntries(options.entries),
    controlledDrivers: summarizeStringArray(options.controlledDrivers),
    sensors: options.sensors ?? null,
    sensorsByDriver: summarizeSensorsByDriver(options.sensorsByDriver),
    scenario: summarizeScenario(options.scenario),
    frameSkip: finiteOrNull(options.frameSkip),
  });
}

function normalizeWarmupPolicy(value, enabled) {
  if (!enabled) return 'never';
  if (typeof value !== 'string') return DEFAULT_WARMUP_POLICY;
  return SUPPORTED_WARMUP_POLICIES.has(value) ? value : DEFAULT_WARMUP_POLICY;
}

function normalizeWarmupSteps(value, fallback) {
  if (value == null) return fallback;
  const steps = Math.floor(Number(value));
  if (!Number.isFinite(steps) || steps < 1) return fallback;
  return steps;
}

function summarizeTrack(track) {
  if (!track || typeof track !== 'object') return null;
  const samples = Array.isArray(track.samples) ? track.samples.length : null;
  const centerlineControls = Array.isArray(track.centerlineControls) ? track.centerlineControls.length : null;
  const drsZones = Array.isArray(track.drsZones) ? track.drsZones.length : null;
  return {
    name: track.name ?? null,
    seed: finiteOrNull(track.seed),
    length: finiteOrNull(track.length),
    width: finiteOrNull(track.width),
    sampleCount: finiteOrNull(track.sampleCount) ?? samples,
    centerlineControls,
    drsZones,
    hasPitLane: Boolean(track.pitLane?.enabled),
  };
}

function summarizeReplayGhosts(replayGhosts) {
  if (!Array.isArray(replayGhosts)) return null;
  return replayGhosts.map((ghost) => ({
    id: ghost?.id ?? null,
    visible: ghost?.visible !== false,
    samples: Array.isArray(ghost?.trajectory) ? ghost.trajectory.length : 0,
  }));
}

function summarizeDrivers(drivers) {
  if (!Array.isArray(drivers)) return null;
  return {
    count: drivers.length,
    ids: drivers.map((driver) => driver?.id ?? null),
  };
}

function summarizeEntries(entries) {
  if (!Array.isArray(entries)) return null;
  return {
    count: entries.length,
    driverIds: entries.map((entry) => entry?.driverId ?? null),
  };
}

function summarizeStringArray(values) {
  if (!Array.isArray(values)) return null;
  return values.map((value) => String(value));
}

function summarizeSensorsByDriver(sensorsByDriver) {
  if (!sensorsByDriver || typeof sensorsByDriver !== 'object') return null;
  const ids = Object.keys(sensorsByDriver);
  return {
    count: ids.length,
    ids: ids.sort(),
  };
}

function summarizeScenario(scenario) {
  if (!scenario || typeof scenario !== 'object') return null;
  return {
    participants: scenario.participants ?? null,
    preset: scenario.preset ?? null,
    placements: scenario.placements ?? null,
    traffic: scenario.traffic ?? null,
  };
}

function stableStringify(value) {
  if (value == null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  if (typeof value !== 'object') return JSON.stringify(String(value));
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function finiteOrNull(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}
