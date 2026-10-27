#!/usr/bin/env node
// Observational characterization, not a CPU benchmark. Requires Node >=20.19.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { register } from 'node:module';
import { arch, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { UTILIZATION_EDGES, createEnvelopeGroup, recordEnvelopeFrame, recordEnvelopeContacts, summarizeEnvelopeGroup } from './aiEnvelopeMetrics.mjs';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  'physics-mode': { type: 'string', default: 'advanced' },
  'driver-profile': { type: 'string', default: 'project' },
  seed: { type: 'string', default: '100' },
  'max-seconds': { type: 'string', default: '900' },
  repeats: { type: 'string', default: '1' },
  'without-wheel-observer': { type: 'boolean', default: false },
  help: { type: 'boolean' },
} });
if (values.help) {
  console.log('Usage: node scripts/benchmark-ai-envelope.mjs [source-root] [track-seeds] [--physics-mode advanced|arcade] [--driver-profile project|novice|expert|expert-risky|skilled-cautious|skilled-risky] [--seed 100] [--max-seconds 900] [--repeats 1] [--without-wheel-observer]\nThree production solo laps; flying diagnostics use laps 2/3 on road. Named profiles normalize DriverData ratings and share explicit fixed vehicle coefficients; project preserves the legacy bundled driver. Node >=20.19; instrumentation time is not CPU performance evidence.');
  process.exit(0);
}
if (positionals.length > 2) throw new Error('Expected source-root and optional comma-separated track seeds');
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = realpathSync(resolve(positionals[0] ?? repository));
const mode = values['physics-mode'];
if (!['advanced', 'arcade'].includes(mode)) throw new Error('--physics-mode must be advanced or arcade');
const driverProfile = values['driver-profile'];
const PROFILE_RATINGS = {
  novice: { pace: 20, racecraft: 20, consistency: 20, aggression: 20, riskTolerance: 20, patience: 70 },
  expert: { pace: 100, racecraft: 100, consistency: 100, aggression: 75, riskTolerance: 75, patience: 60 },
  'expert-risky': { pace: 100, racecraft: 100, consistency: 100, aggression: 95, riskTolerance: 95, patience: 20 },
  'skilled-cautious': { pace: 100, racecraft: 100, consistency: 100, aggression: 20, riskTolerance: 20, patience: 85 },
  'skilled-risky': { pace: 90, racecraft: 90, consistency: 35, aggression: 95, riskTolerance: 95, patience: 20 },
};
const FIXED_VEHICLE = { mass: 798, powerNewtons: 43000, brakeNewtons: 59000,
  downforceCoefficient: 6.1, dragCoefficient: 0.33, tireGrip: 2.4, tireCare: 1 };
if (driverProfile !== 'project' && !Object.hasOwn(PROFILE_RATINGS, driverProfile)) throw new Error('Unknown --driver-profile');
const seed = Number(values.seed);
const seedTokens = (positionals[1] ?? '12,7110,7203').split(',');
const seeds = seedTokens.map(Number);
if (!seedTokens.every((token) => token.trim().length) || ![seed, ...seeds].every((number) => Number.isSafeInteger(number) && number >= 0 && number <= 0xffffffff) || !seeds.length || seeds.length > 64) {
  throw new Error('Seed values must be uint32 integers; supply 1-64 track seeds');
}
const maxSeconds = Number(values['max-seconds']);
const repeats = Number(values.repeats);
if (!(maxSeconds > 0) || !Number.isFinite(maxSeconds)) throw new Error('--max-seconds must be positive and finite');
if (!Number.isSafeInteger(repeats) || repeats < 1) throw new Error('--repeats must be a positive integer');
const observing = mode === 'advanced' && !values['without-wheel-observer'];
const OBSERVER_KEY = 'paddockjs.ai-envelope.contact.v1';
const marker = '      const wheelFx = tire.longitudinal - rolling;';
const observation = `      globalThis[Symbol.for(${JSON.stringify(OBSERVER_KEY)})]?.(car.id, step, index, h, wheel.front, tire.longitudinal, tire.lateral, tire.capacity, tire.usage, tire.slipAngle, engine - braking);\n`;
if (observing) {
  const targetUrl = pathToFileURL(realpathSync(join(root, 'src/simulation/vehicle/advancedVehiclePhysics.js'))).href;
  const loader = `let config; export function initialize(data) { config = data; }
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (url !== config.targetUrl) return result;
  const source = String(result.source);
  if (result.format !== 'module' || source.split(config.marker).length !== 2) throw new Error('Unsupported advanced contact diagnostic insertion point');
  return { ...result, source: source.replace(config.marker, config.observation + config.marker) };
}`;
  register(`data:text/javascript;base64,${Buffer.from(loader).toString('base64')}`, import.meta.url, { data: { targetUrl, marker, observation } });
}
const { createRaceSimulation, FIXED_STEP } = await import(pathToFileURL(join(root, 'src/simulation/raceSimulation.js')));
if (Math.floor(maxSeconds / FIXED_STEP) < 1) throw new Error('--max-seconds must include at least one fixed step');
const { PROJECT_DRIVERS } = await import(pathToFileURL(join(root, 'src/data/demoDrivers.js')));
const { DriverData } = await import(pathToFileURL(join(root, 'src/data/driverData.js')));
const { VehicleData, VEHICLE_STAT_DEFINITIONS } = await import(pathToFileURL(join(root, 'src/data/vehicleData.js')));
const { normalizeSimulatorDrivers } = await import(pathToFileURL(join(root, 'src/data/normalizeDrivers.js')));
const units = await import(pathToFileURL(join(root, 'src/simulation/units.js')));
const { VEHICLE_LIMITS } = await import(pathToFileURL(join(root, 'src/simulation/vehicle/vehiclePhysics.js')));
const { pointAt } = await import(pathToFileURL(join(root, 'src/simulation/track/trackModel.js')));
const { getTimingLineCrossingTime } = await import(pathToFileURL(join(root, 'src/simulation/timing/timingLines.js')));
const { ADVANCED_VEHICLE_MODEL, ADVANCED_WHEELS } = await import(pathToFileURL(join(root, 'src/simulation/vehicle/advancedVehicleModel.js')));
const wheelCount = ADVANCED_WHEELS.length;
const contactsPerFrame = Math.ceil(FIXED_STEP / ADVANCED_VEHICLE_MODEL.maxIntegrationStep) * wheelCount;
if (!Number.isSafeInteger(contactsPerFrame) || contactsPerFrame < 1 || contactsPerFrame > 4096) throw new Error('Unsupported bounded contact sample count');
const buffer = Array.from({ length: contactsPerFrame }, () => ({}));
let currentFrame = null;
globalThis[Symbol.for(OBSERVER_KEY)] = (id, substep, wheel, dt, front, longitudinal, lateral, capacity, demandUsage, slipAngle, longitudinalDemand) => {
  if (!currentFrame?.active) return;
  if (id !== currentFrame.carId || currentFrame.contactCount !== substep * wheelCount + wheel || currentFrame.contactCount >= buffer.length) {
    throw new Error('Duplicate, reordered or unbounded contact observation');
  }
  const contact = buffer[currentFrame.contactCount++];
  contact.dt = dt; contact.front = front; contact.longitudinal = longitudinal; contact.lateral = lateral;
  contact.capacity = capacity; contact.demandUsage = demandUsage; contact.slipAngle = slipAngle; contact.longitudinalDemand = longitudinalDemand;
};
const hash = (value) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const sourceHasher = createHash('sha256');
function hashDirectory(relative) {
  for (const entry of readdirSync(join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(relative, entry.name);
    if (entry.isDirectory()) hashDirectory(path);
    else if (entry.isFile() && entry.name.endsWith('.js')) sourceHasher.update(path).update('\0').update(readFileSync(join(root, path))).update('\0');
  }
}
hashDirectory('src/simulation');
hashDirectory('src/data');
const sourceHash = sourceHasher.digest('hex');
const harnessHash = hash(readFileSync(fileURLToPath(import.meta.url), 'utf8') + '\0' + readFileSync(new URL('./aiEnvelopeMetrics.mjs', import.meta.url), 'utf8'));
function buildDrivers() {
  if (driverProfile === 'project') return PROJECT_DRIVERS.slice(0, 1);
  const vehicleRatings = Object.fromEntries(Object.entries(VEHICLE_STAT_DEFINITIONS).map(([name, definition]) => {
    const scaled = (FIXED_VEHICLE[definition.output] - definition.base) / (definition.variance * (definition.direction ?? 1));
    return [name, definition.neutral + scaled * (definition.maximum - definition.neutral)];
  }));
  const drivers = normalizeSimulatorDrivers([
    { id: 'envelope-pilot', name: 'Envelope Pilot', color: '#e10600', tire: 'M' },
  ], { entries: [{ driverId: 'envelope-pilot', driverNumber: 1,
    driver: new DriverData(PROFILE_RATINGS[driverProfile]),
    vehicle: new VehicleData({ id: 'envelope-fixed-car', name: 'Envelope Fixed Car', ...vehicleRatings }) }], caller: 'benchmark-ai-envelope' });
  const vehicle = drivers[0].vehicle;
  for (const [name, value] of Object.entries(FIXED_VEHICLE)) {
    if (!Number.isFinite(vehicle[name]) || Math.abs(vehicle[name] - value) > 1e-9) throw new Error(`Source cannot normalize fixed vehicle coefficient ${name}`);
    // Remove roundoff from the inverse rating conversion. Both vehicle and
    // constructorArgs.vehicle reference this normalized constructor payload.
    vehicle[name] = value;
  }
  return drivers;
}
const definitions = {
  driverProfiles: { project: 'Original PROJECT_DRIVERS[0], without normalization; legacy seeded vehicle/trait fallback behavior is preserved.',
    ratings: PROFILE_RATINGS, namedVehicleCoefficients: FIXED_VEHICLE,
    normalization: 'Named profiles use DriverData + VehicleData entries through normalizeSimulatorDrivers. Inverse vehicle ratings produce the fixed coefficients, validated then rounded to their explicit targets before createCar. Actual resolved car parameters are recorded and checked; no seeded pace/racecraft vehicle fallback is allowed.' },
  measuredScope: 'Each metric group samples active fixed frames starting in flying lap 2/3, on track, outside pit routing/pit lane, speed >=8m/s. Frame predicates overlap; each contact is counted once per matching group.',
  phases: { allFlyingOnRoad: 'all eligible frames', straight: 'absolute pre-frame centerline curvature <=0.0003/m',
    accelerating: 'throttle>0.05, brake<=0.02, finite-difference speed acceleration>1m/s²', braking: 'brake>0.05',
    corner: 'absolute pre-frame centerline curvature>=0.002/m', steadyCorner: 'corner, brake<=0.02, absolute finite-difference speed acceleration<=1m/s²',
    tightCorner: 'absolute pre-frame centerline curvature>=0.0075/m (centerline radius<=133.333m); distinguishes tighter geometry, not proof that grip is the active speed limit',
    steadyTightCorner: 'tightCorner, brake<=0.02, absolute finite-difference speed acceleration<=1m/s²',
    speedCappedCorner: 'corner, actual post-frame car speed>=0.98*VEHICLE_LIMITS.maxSpeed' },
  phaseDenominators: 'Each group has its own eligible flying/on-road frame count and seconds; overlapping groups must not be summed. atSpeedCeilingFraction uses that group\'s frame count and actual post-frame speed>=0.98*VEHICLE_LIMITS.maxSpeed. Empty groups return null fractions/means. Tight geometry alone does not distinguish tire-, power-, path- or braking-limited speed; inspect force utilization, pedal use and ceiling fraction together.',
  deliveredCombined: 'Per actual physics substep: sum(hypot(delivered tire longitudinal,lateral))/sum(actual contact capacities). Rolling resistance and aerodynamic forces excluded; not net chassis resultant or demanded grip.',
  deliveredLateral: 'Per substep: sum(abs(delivered tire lateral))/sum(actual contact capacities), in individual tire frames.',
  deliveredLongitudinal: 'Per substep: sum(abs(delivered tire longitudinal))/sum(actual contact capacities), in individual tire frames.',
  axleCombined: 'Same sum-of-contact-force-magnitudes/capacity ratio for front/rear contacts separately.',
  maximumWheelDemand: 'Max advancedTireForce.usage among loaded wheels in each substep: requested combined force before longitudinal clamp and nonlinear lateral brush response, divided by capacity. Values>1 are demand, never delivered utilization.',
  forceFractions: 'Loaded-wheel-contact denominators. DemandOverCapacity is tire.usage>1; longitudinal demand is actual engine-braking request>capacity in magnitude; near-capacity is delivered combined/capacity>=0.99. All integration substeps observed.',
  frameControls: 'Applied controls after public driver-input clamps. throttleActive/brakeActive>0.05; fullThrottle>=0.98; coast both<=0.01. Steering limit abs(command)>=0.99*maxSteer; actuator rate limited if abs(command-pre-frame angle)>steerRate*dt+1e-9. No unbounded controller requests are available.',
  motion: 'Speed acceleration=(post-frame speed-pre-frame speed)/dt. Separate net longitudinal acceleration is body-axis post-frame telemetry including resistance/aerodynamic effects, not tire force/capacity or speed derivative. Body slip uses actual advanced velocity-heading telemetry; arcade has no physical lateral slip state.',
  arcade: 'No combined contact friction circle is exposed or implemented. car.gripUsage is delivered lateral acceleration divided by the arcade yaw-law capacity, bounded to1; tractionLimited indicates raw steering-yaw request clipping. No advanced force/capacity estimate is substituted.',
  histogram: 'Lower-inclusive utilization bin edges shared by all histograms; last upper boundary is infinity. Quantiles are enclosing bin intervals; null upper means infinity. Fixed-size histograms, no raw traces.',
  offRoad: 'Full-race active interval counted when post-frame wheel-derived trackState.onTrack=false, outside active pit routing/pit lane.',
  lapTimes: 'Production timing-line crossings; flying laps are laps2/3, first interval starts at lights-out. Whole-step terminal intervals retain physics observations but post-frame motion may be frozen by finish handling.',
};
const pitControlled = (car) => ['entering', 'queued', 'servicing', 'exiting'].includes(car.pitStop?.status);
const phaseNames = Object.keys(definitions.phases);
for (const trackSeed of seeds) {
  let expectedBehaviorHash = null, expectedMetricsHash = null;
  for (let repeat = 1; repeat <= repeats; repeat += 1) {
    const options = { seed, trackSeed, physicsMode: mode, drivers: buildDrivers(), totalLaps: 3,
      rules: { standingStart: false, modules: { tireDegradation: { enabled: false }, pitStops: { enabled: false } } } };
    const sim = createRaceSimulation(options);
    const car = sim.cars[0];
    const actualVehicle = Object.fromEntries(Object.keys(FIXED_VEHICLE).map((name) => [name, car[name]]));
    if (driverProfile !== 'project') {
      for (const [name, value] of Object.entries(FIXED_VEHICLE)) if (actualVehicle[name] !== value) throw new Error(`Fixed vehicle changed during construction: ${name}`);
    }
    const profile = { name: driverProfile, inputRatings: PROFILE_RATINGS[driverProfile] ?? null,
      normalizedDriver: options.drivers[0].constructorArgs?.driver ?? null,
      vehicleRatings: options.drivers[0].vehicle?.ratings ?? null,
      fixedVehicle: driverProfile === 'project' ? null : FIXED_VEHICLE, actualVehicle,
      initialDriver: { pace: car.pace, racecraft: car.racecraft, consistency: car.consistency,
        personality: { ...car.personality }, driverNumber: car.driverNumber, tire: car.tire } };
    const groups = Object.fromEntries(phaseNames.map((name) => [name, createEnvelopeGroup()]));
    const trajectoryHasher = createHash('sha256'), eventHasher = createHash('sha256');
    const crossings = [];
    let frames = 0, offRoadFrames = 0, contacts = 0, maxSpeedKph = 0, maxBodySlip = 0, maxTireSlip = 0;
    let observedContacts = 0, activePhysicsFrames = 0, eligibleFrames = 0;
    const maximumFrames = Math.floor(maxSeconds / FIXED_STEP);
    for (; frames < maximumFrames && !car.finished && !car.outOfRace && !car.destroyed; frames += 1) {
      const before = { steeringAngle: car.steeringAngle, active: !pitControlled(car), onRoad: car.trackState.onTrack && !car.trackState.inPitLane,
        flying: car.raceDistance >= sim.track.length && car.raceDistance < sim.track.length * 3,
        speed: units.simUnitsToMeters(car.speed), curvature: Math.abs(pointAt(sim.track, car.progress).curvature) * units.SIM_UNITS_PER_METER };
      currentFrame = { active: before.active, carId: car.id, contactCount: 0 };
      sim.step(FIXED_STEP);
      if (observing && before.active) {
        if (currentFrame.contactCount !== contactsPerFrame) throw new Error(`Expected ${contactsPerFrame} wheel contacts, got ${currentFrame.contactCount}`);
        observedContacts += currentFrame.contactCount;
        activePhysicsFrames += 1;
        for (let index = 0; index < currentFrame.contactCount; index += 1) maxTireSlip = Math.max(maxTireSlip, Math.abs(buffer[index].slipAngle));
      }
      const postRoad = car.trackState.onTrack && !car.trackState.inPitLane && !pitControlled(car);
      if (before.active && !pitControlled(car) && !car.trackState.inPitLane && !car.trackState.onTrack) offRoadFrames += 1;
      maxSpeedKph = Math.max(maxSpeedKph, units.simSpeedToKph(car.speed));
      maxBodySlip = Math.max(maxBodySlip, Math.abs(car.slipAngleRadians ?? 0));
      for (const event of sim.events) { contacts += event.type === 'contact'; eventHasher.update(JSON.stringify([frames + 1, event])); }
      while (crossings.length < 3) {
        const at = getTimingLineCrossingTime(car, (crossings.length + 1) * sim.track.timingLines.count);
        if (at == null) break;
        crossings.push(at);
      }
      if (before.active && before.flying && before.onRoad && postRoad && before.speed >= 8) {
        eligibleFrames += 1;
        const command = car.appliedControls;
        const speedAcceleration = (units.simUnitsToMeters(car.speed) - before.speed) / FIXED_STEP;
        const phases = { allFlyingOnRoad: true, straight: before.curvature <= 0.0003,
          accelerating: command.throttle > 0.05 && command.brake <= 0.02 && speedAcceleration > 1,
          braking: command.brake > 0.05, corner: before.curvature >= 0.002,
          steadyCorner: before.curvature >= 0.002 && command.brake <= 0.02 && Math.abs(speedAcceleration) <= 1,
          tightCorner: before.curvature >= 0.0075,
          steadyTightCorner: before.curvature >= 0.0075 && command.brake <= 0.02 && Math.abs(speedAcceleration) <= 1,
          speedCappedCorner: before.curvature >= 0.002 && car.speed >= VEHICLE_LIMITS.maxSpeed * 0.98 };
        for (const name of phaseNames) if (phases[name]) {
          recordEnvelopeFrame(groups[name], car, before, FIXED_STEP, units, VEHICLE_LIMITS, mode);
          if (observing) recordEnvelopeContacts(groups[name], buffer, currentFrame.contactCount, wheelCount);
        }
      }
      trajectoryHasher.update(JSON.stringify([frames + 1, car.x, car.y, car.heading, car.speed, car.velocityX, car.velocityY,
        car.yawRate, car.steeringAngle, car.progress, car.raceDistance, car.tireEnergy, car.appliedControls, car.trackState.surface,
        car.finished, car.outOfRace, car.destroyed]));
    }
    currentFrame = null;
    if (car.finished && crossings.length !== 3) throw new Error('Finished race is missing production finish-line crossings');
    const raceStartedAt = sim.raceControl.start?.releasedAt ?? 0;
    const laps = crossings.map((at, index) => at - (crossings[index - 1] ?? raceStartedAt));
    const behavior = { laps, flyingLaps: laps.slice(1, 3), elapsedSeconds: sim.time, frames,
      finished: Boolean(car.finished), dnf: Boolean(car.outOfRace || car.destroyed), dnfReason: car.dnfReason ?? car.destroyReason ?? null,
      offRoadSeconds: offRoadFrames * FIXED_STEP, contacts, maximumSpeedKph: maxSpeedKph,
      maximumBodySlipRadians: mode === 'advanced' ? maxBodySlip : null,
      trajectoryHash: trajectoryHasher.digest('hex'), eventHash: eventHasher.digest('hex') };
    const metrics = Object.fromEntries(Object.entries(groups).map(([name, group]) => [name, summarizeEnvelopeGroup(group, mode, observing)]));
    const behaviorHash = hash(behavior), metricsHash = hash(metrics);
    const deterministicMatch = expectedBehaviorHash == null ? null : expectedBehaviorHash === behaviorHash && expectedMetricsHash === metricsHash;
    expectedBehaviorHash ??= behaviorHash; expectedMetricsHash ??= metricsHash;
    console.log(JSON.stringify({ benchmarkVersion: 1, root, sourceHash, harnessHash, optionsHash: hash({ options, profile }), options, mode, driverProfile, profile, seed, trackSeed,
      fixedStep: FIXED_STEP, maximumSeconds: maxSeconds, trackLengthMeters: units.simUnitsToMeters(sim.track.length),
      environment: { node: process.version, platform: platform(), arch: arch() },
      wheelObserver: { enabled: observing, hookHash: hash(observation), contactsPerFrame: observing ? contactsPerFrame : null,
        activePhysicsFrames, observedContacts, maximumTireSlipRadians: observing ? maxTireSlip : null,
        available: observing, unavailableReason: observing ? null : mode === 'arcade' ? 'Arcade has no per-wheel combined contact capacity' : 'Disabled for behavior-equivalence verification' },
      utilizationHistogramEdges: UTILIZATION_EDGES, definitions, eligibleFlyingOnRoadFrames: eligibleFrames,
      repeat, deterministicMatch, ...behavior, metrics, behaviorHash, metricsHash }));
    if (deterministicMatch === false) process.exitCode = 1;
  }
}
delete globalThis[Symbol.for(OBSERVER_KEY)];
