import { describe, expect, test } from 'vitest';
import { PROJECT_DRIVERS } from '../data/demoDrivers.js';
import { createRaceSimulation, FIXED_STEP } from '../simulation/raceSimulation.js';
import { pointAt } from '../simulation/track/trackModel.js';
import { kphToSimSpeed, metersToSimUnits, simUnitsToMeters } from '../simulation/units.js';
import { decideDriverControls } from '../simulation/driver/driverController.js';
import { advancedRacingOffset } from '../simulation/driver/advancedRacingControls.js';
import { VEHICLE_LIMITS } from '../simulation/vehicle/vehiclePhysics.js';
import { planRacingLine } from '../simulation/driver/racingLinePlan.js';
import { followingSpeedLimit, mainTrackCenterOffset, physicalTrafficGap, scanNearbyTraffic, laneMovementBounds } from '../simulation/driver/trafficScan.js';
import { resolveTrackStatePitOverride } from '../simulation/track/spatialQueries.js';

function scenario(physicsMode, { followerDistance = 100, leaderDistance = 120, followerLaps = 0, leaderLaps = 0, offsets = [0, 0], speedKph = 72, startLine = false } = {}) {
  const sim = createRaceSimulation({
    seed: 100, trackSeed: 20260427, physicsMode, totalLaps: 5,
    drivers: PROJECT_DRIVERS.slice(0, 2),
    rules: { standingStart: false, modules: { tireDegradation: { enabled: false } } },
  });
  if (startLine) {
    followerDistance = simUnitsToMeters(sim.track.length) - 12;
    leaderDistance = 8;
  }
  const [follower, leader] = sim.cars;
  for (const [index, car, distance, laps, speed] of [
    [0, follower, followerDistance, followerLaps, speedKph],
    [1, leader, leaderDistance, leaderLaps, 0],
  ]) {
    const point = pointAt(sim.track, metersToSimUnits(distance));
    sim.setCarState(car.id, {
      x: point.x + point.normalX * metersToSimUnits(offsets[index]),
      y: point.y + point.normalY * metersToSimUnits(offsets[index]),
      heading: point.heading, speed: kphToSimSpeed(speed),
      progress: point.distance, raceDistance: point.distance + laps * sim.track.length,
      desiredOffset: metersToSimUnits(offsets[index]),
    });
  }
  sim.setCarControls(leader.id, { steering: 0, throttle: 0, brake: 1 });
  sim.recalculateRaceState({ updateDrs: false });
  return { sim, follower, leader };
}

function controls(sim, car) {
  const race = sim.driverRaceContext();
  return decideDriverControls({ car, orderIndex: race.orderedCars.indexOf(car), race });
}

describe('physical traffic contract', () => {
  test.each([1, -1, 3])('recognizes traffic separated by %s classification laps', (lapDifference) => {
    const { sim, follower, leader } = scenario('arcade', { followerLaps: Math.max(0, lapDifference), leaderLaps: Math.max(0, -lapDifference) });
    const entries = scanNearbyTraffic(follower, sim.driverRaceContext());
    expect(entries).toHaveLength(1);
    expect(entries[0].car).toBe(leader);
    expect(simUnitsToMeters(entries[0].gap)).toBeCloseTo(20, 8);
    expect(followingSpeedLimit(follower, sim.cars, sim.track.length)).toBeLessThan(simUnitsToMeters(follower.speed));
  });

  test('recognizes forward and rearward traffic across the start line', () => {
    const length = metersToSimUnits(1000);
    const behindLine = { progress: metersToSimUnits(990), raceDistance: metersToSimUnits(2990) };
    const aheadLine = { progress: metersToSimUnits(10), raceDistance: metersToSimUnits(1010) };
    expect(simUnitsToMeters(physicalTrafficGap(behindLine, aheadLine, length))).toBe(20);
    expect(simUnitsToMeters(physicalTrafficGap(aheadLine, behindLine, length))).toBe(-20);
    expect(simUnitsToMeters(physicalTrafficGap(behindLine, aheadLine))).toBe(-1980);
  });

  test('commits to passing the physically ahead car when classification says it is behind', () => {
    const { sim, follower, leader } = scenario('arcade', { followerLaps: 1 });
    const race = sim.driverRaceContext();
    expect(race.orderedCars[0]).toBe(follower);
    expect(follower.gapAhead).toBe(Infinity);
    const plan = planRacingLine(follower, 0, race);
    expect(plan.attackCommitted).toBe(true);
    expect(plan.actualLaneAhead.car).toBe(leader);
    expect(Math.abs(simUnitsToMeters(plan.offset))).toBeGreaterThan(1);
  });

  test('alongside clearance constrains the final path while a passing intent can persist', () => {
    const { sim, follower } = scenario('arcade', { leaderDistance: 102, offsets: [0, 2.5] });
    follower.attackSide = 1;
    follower.attackCommitmentFrames = 150;
    const race = sim.driverRaceContext();
    const traffic = scanNearbyTraffic(follower, race);
    const bounds = laneMovementBounds(traffic, 0);
    expect(simUnitsToMeters(bounds.maximum)).toBeCloseTo(0.6, 8);
    expect(bounds.minimum).toBe(-Infinity);
    const plan = planRacingLine(follower, 1, race);
    expect(plan.maximumOffset).toBe(bounds.maximum);
    expect(plan.minimumOffset).toBe(bounds.minimum);
  });

  test('advanced passing preserves an alongside car through actual control and motion', () => {
    const { sim, follower } = scenario('advanced', { leaderDistance: 102, offsets: [0, 2.5], speedKph: 72 });
    follower.attackSide = 1;
    follower.attackCommitmentFrames = 150;
    let contacts = 0;
    for (let frame = 0; frame < 3 / FIXED_STEP; frame += 1) {
      sim.step(FIXED_STEP);
      contacts += sim.events.filter((event) => event.type === 'contact').length;
      expect(follower.trackState.onTrack).toBe(true);
    }
    expect(contacts).toBe(0);
    expect(follower.destroyed || follower.outOfRace).toBeFalsy();
  });

  test('a loaded advanced corner still corrects an excursion inward without crossing sides', () => {
    const { sim, follower } = scenario('advanced', { offsets: [6, 0], speedKph: 180 });
    follower.yawRate = 1;
    const current = mainTrackCenterOffset(follower);
    const sameSideCorrection = advancedRacingOffset(follower, metersToSimUnits(-5), sim.track.width);
    expect(sameSideCorrection).toBeGreaterThan(0);
    expect(sameSideCorrection).toBeLessThan(current);
    expect(Math.abs(sameSideCorrection)).toBeLessThanOrEqual(sim.track.width / 2 - VEHICLE_LIMITS.carWidth);
  });

  test('a narrow custom road corrects toward the center without a negative comfort margin', () => {
    const { follower } = scenario('advanced', { offsets: [2, 0], speedKph: 180 });
    follower.yawRate = 1;
    expect(advancedRacingOffset(follower, 0, metersToSimUnits(6))).toBeGreaterThanOrEqual(0);
  });

  test('uses chassis centers when opposite-side outer wheels exaggerate clearance', () => {
    const { sim, follower, leader } = scenario('arcade', { offsets: [-0.3, 0.3] });
    expect(simUnitsToMeters(Math.abs(leader.trackState.signedOffset - follower.trackState.signedOffset))).toBeGreaterThan(2.4);
    expect(simUnitsToMeters(mainTrackCenterOffset(leader) - mainTrackCenterOffset(follower))).toBeCloseTo(0.6, 8);
    const entry = scanNearbyTraffic(follower, sim.driverRaceContext())[0];
    expect(simUnitsToMeters(entry.signedOffset)).toBeCloseTo(0.3, 8);
    expect(followingSpeedLimit(follower, sim.cars, sim.track.length)).toBeLessThan(simUnitsToMeters(follower.speed));
  });

  test.each([
    { surface: 'pit-lane', followerOffset: 0, pitOffset: 20, blocks: false },
    { surface: 'pit-entry', followerOffset: 9, pitOffset: 10.5, blocks: true },
  ])('retains the road-frame offset for $surface traffic', ({ surface, followerOffset, pitOffset, blocks }) => {
    const state = { x: 0, y: 0, normalX: 0, normalY: 1, onTrack: true, surface: 'track' };
    const follower = { x: 0, y: metersToSimUnits(followerOffset), speed: kphToSimSpeed(72), raceDistance: 0, trackState: state };
    const pitCar = { x: 0, y: metersToSimUnits(pitOffset), speed: 0, raceDistance: metersToSimUnits(20) };
    pitCar.trackState = resolveTrackStatePitOverride(
      { width: metersToSimUnits(20), kerbWidth: 0 },
      { ...state, signedOffset: pitCar.y, crossTrackError: Math.abs(pitCar.y) },
      { x: 0, y: pitCar.y, normalX: 0, normalY: 1, signedOffset: 0, crossTrackError: 0, surface, inPitLane: true, onTrack: true },
    );
    expect(scanNearbyTraffic(follower, { cars: [follower, pitCar] })[0].signedOffset).toBe(pitCar.y);
    const limit = followingSpeedLimit(follower, [follower, pitCar]);
    if (blocks) expect(limit).toBeLessThan(simUnitsToMeters(follower.speed));
    else expect(limit).toBe(followingSpeedLimit(follower, [follower]));
  });
});

describe.each(['arcade', 'advanced'])('%s racecraft through production controls and physics', (physicsMode) => {
  test.each([
    { name: 'lapped leader', followerLaps: 1 },
    { name: 'leader across the start line', startLine: true },
    { name: 'leader one lap ahead', leaderLaps: 1 },
    { name: 'same-lap opposite-side overlap', offsets: [-0.3, 0.3] },
  ])('brakes and avoids contact with a stopped $name', (placement) => {
    const { sim, follower } = scenario(physicsMode, placement);
    const initial = controls(sim, follower);
    expect(initial.throttle).toBe(0);
    expect(initial.brake).toBeGreaterThan(0);
    let contacts = 0;
    for (let frame = 0; frame < 3 / FIXED_STEP; frame += 1) {
      sim.step(FIXED_STEP);
      contacts += sim.events.filter((event) => event.type === 'contact').length;
    }
    expect(contacts).toBe(0);
    expect(follower.destroyed || follower.outOfRace).toBeFalsy();
    expect(follower.trackState.onTrack).toBe(true);
  });

  test('can slow below maneuvering pace for close stopped traffic', () => {
    const { sim, follower } = scenario(physicsMode, { leaderDistance: 112, speedKph: 40 });
    const initial = controls(sim, follower);
    expect(initial.throttle).toBe(0);
    expect(initial.brake).toBeGreaterThan(0);
    let contacts = 0;
    let lowestSpeed = follower.speed;
    for (let frame = 0; frame < 2 / FIXED_STEP; frame += 1) {
      sim.step(FIXED_STEP);
      lowestSpeed = Math.min(lowestSpeed, follower.speed);
      contacts += sim.events.filter((event) => event.type === 'contact').length;
    }
    expect(contacts).toBe(0);
    expect(lowestSpeed).toBeLessThan(kphToSimSpeed(30));
  });

  test.each(['retired', 'destroyed', 'phantom', 'isolated'])('does not dodge or slow for a %s participant', (status) => {
    const { sim, follower, leader } = scenario(physicsMode);
    follower.aggression = 0.5;
    if (status === 'retired') leader.outOfRace = true;
    if (status === 'destroyed') leader.destroyed = true;
    if (status === 'phantom' || status === 'isolated') leader.interaction = { collidable: false, detectableAsNearby: status === 'phantom' };
    expect(scanNearbyTraffic(follower, sim.driverRaceContext())).toHaveLength(0);
    const actual = controls(sim, follower);
    const otherRace = { ...sim.driverRaceContext(), cars: [follower] };
    follower.desiredOffset = 0;
    follower.attackSide = 0;
    follower.attackCommitmentFrames = 0;
    const alone = decideDriverControls({ car: follower, orderIndex: 0, race: otherRace });
    expect(actual).toEqual(alone);
    expect(actual.brake).toBe(0);
    expect(actual.throttle).toBeGreaterThan(0);
  });

  test('does not defend against a physically rearward car that is lapping it', () => {
    const { sim, follower } = scenario(physicsMode, { leaderDistance: 80, leaderLaps: 1, offsets: [0, 3] });
    follower.aggression = 0.9;
    const plan = planRacingLine(follower, 1, sim.driverRaceContext());
    expect(plan.attackCommitted).toBe(false);
    expect(plan.offset).toBe(0);
  });

  test.each([false, true])('a separated pit car ahead=%s does not create attacking or defensive movement', (ahead) => {
    const { sim, follower, leader } = scenario(physicsMode, { leaderDistance: ahead ? 120 : 80 });
    const offset = sim.track.width / 2 + metersToSimUnits(12);
    const point = pointAt(sim.track, leader.progress);
    leader.x = point.x + point.normalX * offset;
    leader.y = point.y + point.normalY * offset;
    leader.trackState = {
      ...point, x: leader.x, y: leader.y, surface: 'pit-lane', onTrack: true,
      signedOffset: 0, mainTrackSignedOffset: offset,
    };
    follower.aggression = 0.9;
    const race = sim.driverRaceContext();
    expect(scanNearbyTraffic(follower, race)).toHaveLength(1);
    const plan = planRacingLine(follower, 1, race);
    expect(plan.attackCommitted).toBe(false);
    expect(plan.offset).toBe(0);
    expect(controls(sim, follower).brake).toBe(0);
  });

  test('an overlapping pit-entry car is still a physical passing target', () => {
    const { sim, follower, leader } = scenario(physicsMode);
    const offset = sim.track.width / 2 + metersToSimUnits(0.5);
    leader.trackState = { ...leader.trackState, surface: 'pit-entry', mainTrackSignedOffset: offset };
    const plan = planRacingLine(follower, 1, sim.driverRaceContext());
    expect(plan.attackCommitted).toBe(true);
    expect(Math.abs(plan.offset)).toBeGreaterThan(0);
  });

  test('releases the following limit after actual lateral clearance', () => {
    const { sim, follower } = scenario(physicsMode, { offsets: [0, 6] });
    expect(followingSpeedLimit(follower, sim.cars, sim.track.length)).toBe(followingSpeedLimit(follower, [follower], sim.track.length));
    const input = controls(sim, follower);
    expect(input.brake).toBe(0);
    expect(input.throttle).toBeGreaterThan(0);
  });
});
