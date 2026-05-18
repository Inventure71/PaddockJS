import { clamp } from '../simMath.js';
import { normalizePitCrewStats } from './pitState.js';
import { getPitStopBox } from './pitOccupancy.js';

export function calculatePitServiceProfile(sim, car) {
  const pitStops = sim.rules.modules?.pitStops ?? {};
  const variability = pitStops.variability ?? {};
  const baseSeconds = Math.max(0, Number(pitStops.defaultStopSeconds) || 2.8);
  const box = getPitStopBox(sim, car?.pitStop);
  const team = sim.track.pitLane?.teams?.find((entry) => entry.id === car?.pitStop?.teamId);
  const pitCrew = normalizePitCrewStats(
    box?.pitCrew ?? team?.pitCrew ?? car?.team?.pitCrew ?? car?.team?.pitCrewStats,
  );
  const profile = {
    baseSeconds,
    seconds: baseSeconds,
    perfect: Boolean(variability.perfect),
    variabilityEnabled: Boolean(variability.enabled),
    teamId: car?.pitStop?.teamId ?? box?.teamId ?? null,
    pitCrew,
    speedDeltaSeconds: 0,
    consistencyDeltaSeconds: 0,
    issueDelaySeconds: 0,
    issue: null,
  };

  if (!variability.enabled || variability.perfect) return profile;

  const speedImpact = Math.max(0, Number(variability.speedImpactSeconds) || 0);
  const jitterImpact = Math.max(0, Number(variability.consistencyJitterSeconds) || 0);
  const issueChance = clamp(Number(variability.issueChance) || 0, 0, 1);
  const issueMaxDelay = Math.max(0, Number(variability.issueMaxDelaySeconds) || 0);
  profile.speedDeltaSeconds = (0.5 - pitCrew.speed) * speedImpact;
  profile.consistencyDeltaSeconds = (sim.random() - 0.5) * (1 - pitCrew.consistency) * jitterImpact;
  const effectiveIssueChance = issueChance * (1 - pitCrew.reliability);
  if (sim.random() < effectiveIssueChance) {
    profile.issueDelaySeconds = 0.35 + sim.random() * issueMaxDelay * (1 - pitCrew.reliability);
    profile.issue = 'slow-stop';
  }
  profile.seconds = Math.max(
    Math.min(1.6, baseSeconds),
    baseSeconds + profile.speedDeltaSeconds + profile.consistencyDeltaSeconds + profile.issueDelaySeconds,
  );
  return profile;
}
