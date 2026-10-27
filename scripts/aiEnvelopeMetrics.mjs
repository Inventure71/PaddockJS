// Fixed-size diagnostic accumulators. Histogram quantiles are intervals, not
// exact percentiles; raw contact/state histories are deliberately not retained.
export const UTILIZATION_EDGES = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.25, 1.5, 2, 3, 5, 10];

function distribution() {
  return { count: 0, sum: 0, minimum: Infinity, maximum: -Infinity, bins: UTILIZATION_EDGES.map(() => 0) };
}

function sample(metric, value) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid envelope sample: ${value}`);
  metric.count += 1;
  metric.sum += value;
  metric.minimum = Math.min(metric.minimum, value);
  metric.maximum = Math.max(metric.maximum, value);
  let bin = UTILIZATION_EDGES.length - 1;
  while (value < UTILIZATION_EDGES[bin]) bin -= 1;
  metric.bins[bin] += 1;
}

function summarize(metric) {
  const quantiles = {};
  for (const [name, fraction] of [['p50', 0.5], ['p90', 0.9], ['p95', 0.95]]) {
    let count = 0;
    quantiles[name] = null;
    if (!metric.count) continue;
    for (let bin = 0; bin < metric.bins.length; bin += 1) {
      count += metric.bins[bin];
      if (count >= Math.ceil(metric.count * fraction)) {
        quantiles[name] = { lowerInclusive: UTILIZATION_EDGES[bin], upperExclusive: UTILIZATION_EDGES[bin + 1] ?? null };
        break;
      }
    }
  }
  return { count: metric.count, mean: metric.count ? metric.sum / metric.count : null,
    minimum: metric.count ? metric.minimum : null, maximum: metric.count ? metric.maximum : null,
    quantileIntervals: quantiles, histogramCounts: metric.bins };
}

const FORCE_METRICS = ['deliveredCombined', 'deliveredLateral', 'deliveredLongitudinal',
  'frontDeliveredCombined', 'rearDeliveredCombined', 'maximumWheelDeliveredCombined', 'maximumWheelDemand'];

export function createEnvelopeGroup() {
  return {
    frames: 0, seconds: 0, speedSum: 0, maximumSpeedKph: 0, maximumBodySlipRadians: 0,
    throttleSum: 0, brakeSum: 0, longitudinalSum: 0, speedAccelerationSum: 0, lateralAbsSum: 0,
    throttleActive: 0, fullThrottle: 0, brakeActive: 0, coasting: 0, pedalOverlap: 0,
    steeringAtLimit: 0, steeringRateLimited: 0, tractionLimited: 0, atSpeedCeiling: 0,
    arcadeDeliveredLateral: distribution(), contacts: 0, contactSeconds: 0, unloadedContacts: 0,
    demandOverCapacity: 0, longitudinalDemandOverCapacity: 0, deliveredNearCapacity: 0, substeps: 0,
    forces: Object.fromEntries(FORCE_METRICS.map((name) => [name, distribution()])),
  };
}

export function recordEnvelopeFrame(group, car, before, dt, units, limits, mode) {
  const { throttle, brake, steering } = car.appliedControls;
  const speed = units.simSpeedToKph(car.speed);
  group.frames += 1;
  group.seconds += dt;
  group.speedSum += speed;
  group.maximumSpeedKph = Math.max(group.maximumSpeedKph, speed);
  group.atSpeedCeiling += car.speed >= limits.maxSpeed * 0.98;
  group.maximumBodySlipRadians = Math.max(group.maximumBodySlipRadians, Math.abs(car.slipAngleRadians ?? 0));
  group.throttleSum += throttle;
  group.brakeSum += brake;
  group.longitudinalSum += car.longitudinalAcceleration ?? 0;
  group.speedAccelerationSum += (units.simUnitsToMeters(car.speed) - before.speed) / dt;
  group.lateralAbsSum += Math.abs(car.lateralAcceleration ?? 0);
  group.throttleActive += throttle > 0.05;
  group.fullThrottle += throttle >= 0.98;
  group.brakeActive += brake > 0.05;
  group.coasting += throttle <= 0.01 && brake <= 0.01;
  group.pedalOverlap += throttle > 0.05 && brake > 0.05;
  group.steeringAtLimit += Math.abs(steering) >= limits.maxSteer * 0.99;
  group.steeringRateLimited += Math.abs(steering - before.steeringAngle) > limits.steerRate * dt + 1e-9;
  group.tractionLimited += Boolean(car.tractionLimited);
  if (mode === 'arcade') sample(group.arcadeDeliveredLateral, car.gripUsage ?? 0);
}

export function recordEnvelopeContacts(group, buffer, count, wheelCount) {
  if (count % wheelCount) throw new Error('Incomplete observed wheel substep');
  for (let base = 0; base < count; base += wheelCount) {
    let capacity = 0, combined = 0, lateral = 0, longitudinal = 0;
    let frontCapacity = 0, frontCombined = 0, rearCapacity = 0, rearCombined = 0;
    let maxDelivered = 0, maxDemand = 0;
    group.substeps += 1;
    for (let index = 0; index < wheelCount; index += 1) {
      const contact = buffer[base + index];
      group.contacts += 1;
      group.contactSeconds += contact.dt;
      if (!(contact.capacity > 0)) {
        group.unloadedContacts += 1;
        continue;
      }
      const magnitude = Math.hypot(contact.longitudinal, contact.lateral);
      const usage = magnitude / contact.capacity;
      if (usage > 1 + 1e-8) throw new Error(`Delivered contact force exceeds capacity: ${usage}`);
      capacity += contact.capacity;
      combined += magnitude;
      lateral += Math.abs(contact.lateral);
      longitudinal += Math.abs(contact.longitudinal);
      if (contact.front) { frontCapacity += contact.capacity; frontCombined += magnitude; }
      else { rearCapacity += contact.capacity; rearCombined += magnitude; }
      maxDelivered = Math.max(maxDelivered, usage);
      maxDemand = Math.max(maxDemand, contact.demandUsage);
      group.demandOverCapacity += contact.demandUsage > 1;
      group.longitudinalDemandOverCapacity += Math.abs(contact.longitudinalDemand) > contact.capacity;
      group.deliveredNearCapacity += usage >= 0.99;
    }
    if (capacity > 0) {
      sample(group.forces.deliveredCombined, combined / capacity);
      sample(group.forces.deliveredLateral, lateral / capacity);
      sample(group.forces.deliveredLongitudinal, longitudinal / capacity);
      sample(group.forces.maximumWheelDeliveredCombined, maxDelivered);
      sample(group.forces.maximumWheelDemand, maxDemand);
    }
    if (frontCapacity > 0) sample(group.forces.frontDeliveredCombined, frontCombined / frontCapacity);
    if (rearCapacity > 0) sample(group.forces.rearDeliveredCombined, rearCombined / rearCapacity);
  }
}

export function summarizeEnvelopeGroup(group, mode, observing) {
  const fraction = (count) => group.frames ? count / group.frames : null;
  const loaded = group.contacts - group.unloadedContacts;
  return {
    frames: group.frames, seconds: group.seconds,
    motion: { meanSpeedKph: group.frames ? group.speedSum / group.frames : null, maximumSpeedKph: group.maximumSpeedKph,
      atSpeedCeilingFraction: fraction(group.atSpeedCeiling),
      maximumBodySlipRadians: mode === 'advanced' ? group.maximumBodySlipRadians : null,
      meanSpeedAccelerationMps2: group.frames ? group.speedAccelerationSum / group.frames : null,
      meanNetLongitudinalAccelerationMps2: group.frames ? group.longitudinalSum / group.frames : null,
      meanAbsoluteLateralAccelerationMps2: group.frames ? group.lateralAbsSum / group.frames : null },
    controls: { meanThrottle: group.frames ? group.throttleSum / group.frames : null, meanBrake: group.frames ? group.brakeSum / group.frames : null,
      throttleActiveFraction: fraction(group.throttleActive), fullThrottleFraction: fraction(group.fullThrottle),
      brakeActiveFraction: fraction(group.brakeActive), coastingFraction: fraction(group.coasting), pedalOverlapFraction: fraction(group.pedalOverlap),
      steeringAtLimitFraction: fraction(group.steeringAtLimit), steeringActuatorRateLimitedFraction: fraction(group.steeringRateLimited) },
    arcadeYawRequestClippedFraction: mode === 'arcade' ? fraction(group.tractionLimited) : null,
    arcadeDeliveredLateralAccelerationUsage: mode === 'arcade' ? summarize(group.arcadeDeliveredLateral) : null,
    wheelForces: mode === 'advanced' && observing ? {
      wheelContacts: group.contacts, summedWheelContactSeconds: group.contactSeconds, unloadedContacts: group.unloadedContacts, substeps: group.substeps,
      demandedCombinedOverCapacityFraction: loaded ? group.demandOverCapacity / loaded : null,
      longitudinalDemandOverCapacityFraction: loaded ? group.longitudinalDemandOverCapacity / loaded : null,
      deliveredCombinedAtLeast99PercentFraction: loaded ? group.deliveredNearCapacity / loaded : null,
      distributions: Object.fromEntries(FORCE_METRICS.map((name) => [name, summarize(group.forces[name])])),
    } : null,
  };
}
