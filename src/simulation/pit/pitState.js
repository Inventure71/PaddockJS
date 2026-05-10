import { metersToSimUnits } from '../units.js';
import { firstDifferentCompound } from './pitIntent.js';

const PIT_ENTRY_APPROACH_DISTANCE = metersToSimUnits(250);

export function normalizePitCrewStats(value) {
  const source = value && typeof value === 'object' ? value : {};
  const rating = (entry) => {
    const numeric = Number(entry);
    return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0.5;
  };
  return {
    speed: rating(source.speed ?? source.pace),
    consistency: rating(source.consistency),
    reliability: rating(source.reliability),
  };
}

export function assignPitLaneTeams({ cars, pitLane }) {
  if (!pitLane?.enabled || !Array.isArray(pitLane.boxes)) return;
  const boxesPerTeam = pitLane.boxesPerTeam ?? 2;
  const teamCount = pitLane.teamCount ?? Math.ceil(pitLane.boxes.length / boxesPerTeam);

  pitLane.teams = Array.from({ length: teamCount }, (_, teamIndex) => {
    const primary = cars[teamIndex * boxesPerTeam] ?? cars[teamIndex] ?? null;
    const secondary = cars[teamIndex * boxesPerTeam + 1] ?? null;
    const team = primary?.team ?? secondary?.team ?? null;
    const id = team?.id ?? `team-${teamIndex + 1}`;
    const name = team?.name ?? (primary ? `${primary.name} Team` : `Team ${teamIndex + 1}`);
    const color = team?.color ?? primary?.color ?? secondary?.color ?? '#f8fafc';
    const pitCrew = normalizePitCrewStats(
      team?.pitCrew ?? team?.pitCrewStats ?? primary?.team?.pitCrew ?? secondary?.team?.pitCrew,
    );
    const boxIds = pitLane.boxes
      .filter((box) => box.teamIndex === teamIndex)
      .map((box) => box.id);

    pitLane.boxes
      .filter((box) => box.teamIndex === teamIndex)
      .forEach((box) => {
        box.teamId = id;
        box.teamName = name;
        box.teamColor = color;
      });
    const serviceArea = pitLane.serviceAreas?.[teamIndex] ?? null;
    if (serviceArea) {
      serviceArea.teamId = id;
      serviceArea.teamName = name;
      serviceArea.teamColor = color;
      serviceArea.pitCrew = pitCrew;
    }

    return {
      id,
      name,
      color,
      index: teamIndex,
      boxIds,
      serviceAreaId: serviceArea?.id ?? null,
      pitCrew,
    };
  });
}

export function initializePitStops({ cars, pitLane, pitStops, totalLaps, trackLength, tireCompounds, PIT_INTENT_NONE }) {
  if (!pitStops?.enabled || !pitLane?.enabled || !Array.isArray(pitLane.boxes) || totalLaps < 2) return;
  const boxesPerTeam = pitLane.boxesPerTeam ?? 2;
  const maxConcurrentPitLaneCars = Math.max(1, Math.floor(pitStops.maxConcurrentPitLaneCars ?? 3));
  const pitWindowLapCount = Math.max(1, Math.min(
    totalLaps - 1,
    Math.ceil(cars.length / maxConcurrentPitLaneCars),
  ));

  cars.forEach((car, index) => {
    const stopLapBase = trackLength * (1 + (index % pitWindowLapCount));
    const trainPosition = Math.floor(index / pitWindowLapCount);
    const teamIndex = Math.floor(index / boxesPerTeam);
    const teamBoxIndex = index % boxesPerTeam;
    const garageBoxIndex = Math.min(pitLane.boxes.length - 1, teamIndex * boxesPerTeam + teamBoxIndex);
    const garageBox = pitLane.boxes[garageBoxIndex] ?? pitLane.boxes[index % pitLane.boxes.length];
    const serviceArea = pitLane.serviceAreas?.[teamIndex] ??
      pitLane.serviceAreas?.[index % pitLane.serviceAreas.length] ??
      garageBox;
    car.pitStop = {
      status: 'pending',
      phase: null,
      boxIndex: serviceArea.index,
      boxId: serviceArea.id,
      garageBoxIndex,
      garageBoxId: garageBox.id,
      teamId: serviceArea.teamId ?? garageBox.teamId ?? null,
      teamColor: serviceArea.teamColor ?? garageBox.teamColor ?? null,
      stopsCompleted: 0,
      entryRaceDistance: stopLapBase + pitLane.entry.distanceFromStart,
      plannedRaceDistance: stopLapBase + pitLane.entry.distanceFromStart -
        PIT_ENTRY_APPROACH_DISTANCE,
      trainPosition,
      lapBase: stopLapBase,
      serviceRemaining: 0,
      penaltyServiceRemaining: 0,
      penaltyServiceTotal: 0,
      servingPenaltyIds: [],
      serviceProfile: null,
      queueingForService: false,
      route: null,
      routeProgress: 0,
      routeStartRaceDistance: null,
      routeEndRaceDistance: null,
      targetTire: firstDifferentCompound(car.tire, tireCompounds),
      intent: PIT_INTENT_NONE,
    };
  });
}
