// Render only the active observation contract; no simulation or diagnostic queries.
export function renderPolicySenses(root, observation, policy = null, driverId = null, physicsMode = 'arcade') {
  if (!root) return;
  const object = observation?.object;
  if (!object && observation?.vector) {
    root.replaceChildren(
      textElement('h2', 'Active observation senses'),
      metricGrid([
        ['Profile', 'compact-vector'],
        ['Vector', `${observation.vector.length ?? 0} values`],
        ['Schema', `${observation.schema?.length ?? 0} fields`],
        ['Ray channels', 'vector-only'],
        ['Physics', physicsMode],
        ['Memory bin', policy?.debugStateFor?.(driverId)?.memoryBin ?? policy?.debugState?.memoryBin ?? 'n/a'],
        ['Memory writes', policy?.debugStateFor?.(driverId)?.memoryWrites ?? policy?.debugState?.memoryWrites ?? 'n/a'],
      ]),
    );
    return;
  }
  if (!object) {
    root.replaceChildren(textElement('h2', 'Active observation senses'), textElement('p', 'Select a controlled car to show its active senses.'));
    return;
  }

  root.replaceChildren(
    textElement('h2', 'Active observation senses'),
    metricGrid([
      ['Profile', object.profile ?? 'default'],
      ['Vector', `${observation.vector?.length ?? 0} values`],
      ['Schema', `${observation.schema?.length ?? 0} fields`],
      ['Ray channels', activeRayChannelNames(object.rays).join(', ') || 'none'],
      ['Physics', physicsMode],
      ['Memory bin', policy?.debugStateFor?.(driverId)?.memoryBin ?? policy?.debugState?.memoryBin ?? 'n/a'],
      ['Memory writes', policy?.debugStateFor?.(driverId)?.memoryWrites ?? policy?.debugState?.memoryWrites ?? 'n/a'],
    ]),
    senseSection('Car body', [
      ['Speed', formatNumber(object.self.speedKph, 'kph')],
      ['Steering', formatRadians(object.self.steeringAngleRadians)],
      ['Throttle', formatPercent(object.self.throttle)],
      ['Brake', formatPercent(object.self.brake)],
      ['Yaw rate', `${formatNumber(object.self.yawRateRadiansPerSecond, 'rad/s')}`],
      ['Lateral G', formatNumber(object.self.lateralG, 'g')],
      ['Longitudinal G', formatNumber(object.self.longitudinalG, 'g')],
      ['Grip usage', formatNumber(object.self.gripUsage)],
      ['Slip angle', formatRadians(object.self.slipAngleRadians)],
      ['Stability', object.self.stabilityState],
      ['Destroyed', object.self.destroyed ? (object.self.destroyReason ?? 'yes') : 'no'],
      ['Traction limit', object.self.tractionLimited ? 'yes' : 'no'],
    ]),
    senseSection('Track relationship', [
      ['Offset', formatNumber(object.trackRelation?.lateralOffsetMeters, 'm')],
      ['Heading error', formatRadians(object.trackRelation?.headingErrorRadians)],
      ['Left boundary', formatNumber(object.trackRelation?.leftBoundaryMeters, 'm')],
      ['Right boundary', formatNumber(object.trackRelation?.rightBoundaryMeters, 'm')],
      ['Legal width', formatNumber(object.trackRelation?.legalWidthMeters, 'm')],
      ['Surface', object.trackRelation?.surface ?? object.self.surface],
      ['Legal surface', object.trackRelation?.onLegalSurface ? 'yes' : 'no'],
    ]),
    senseSection('Contact patches', (object.contactPatches ?? []).map((patch) => [
      patch.id,
      `${patch.surface}${patch.onLegalSurface ? ' legal' : ' illegal'} · ${formatNumber(patch.signedOffsetMeters, 'm')}`,
    ])),
    senseSection('Opponent radar', (object.nearbyCars ?? []).slice(0, 6).map((car) => [
      car.id,
      [
        `${formatNumber(car.relativeForwardMeters, 'm')} fwd`,
        `${formatNumber(car.relativeRightMeters, 'm')} right`,
        `${formatNumber(car.relativeSpeedKph, 'kph')} rel`,
        `${formatNumber(car.closingRateMetersPerSecond, 'm/s')} closing`,
        car.leftOverlap ? 'left overlap' : null,
        car.rightOverlap ? 'right overlap' : null,
      ].filter(Boolean).join(' · '),
    ])),
    senseSection('Rays', (object.rays ?? []).map((ray) => [
      ray.id ?? `${ray.angleDegrees}deg`,
      [
        `${formatNumber(ray.angleDegrees, 'deg')}`,
        `edge ${formatRayHit(ray.track)}`,
        `kerb ${formatRayHit(ray.kerb)}`,
        `illegalSurface ${formatRayHit(ray.illegalSurface)}`,
        `car ${formatRayHit(ray.car)}`,
      ].join(' · '),
    ])),
  );
}

function activeRayChannelNames(rays) {
  const firstRay = Array.isArray(rays) ? rays[0] : null;
  if (!firstRay) return [];
  return ['track', 'kerb', 'illegalSurface', 'car'].filter((channel) => firstRay[channel]);
}

function senseSection(title, rows) {
  const section = document.createElement('section');
  section.className = 'policy-senses-section';
  section.append(textElement('h3', title));
  if (!rows.length) {
    section.append(textElement('p', 'No current readings.'));
    return section;
  }
  const dl = document.createElement('dl');
  rows.forEach(([label, value]) => {
    dl.append(textElement('dt', label), textElement('dd', value));
  });
  section.append(dl);
  return section;
}

function metricGrid(rows) {
  const grid = document.createElement('dl');
  grid.className = 'policy-senses-metrics';
  rows.forEach(([label, value]) => {
    grid.append(textElement('dt', label), textElement('dd', value));
  });
  return grid;
}

function textElement(tag, text) {
  const node = document.createElement(tag);
  node.textContent = text == null ? 'n/a' : String(text);
  return node;
}

function formatRayHit(hit) {
  if (!hit?.hit) return 'clear';
  const suffix = hit.surface ? ` ${hit.surface}` : hit.kind ? ` ${hit.kind}` : '';
  return `${formatNumber(hit.distanceMeters, 'm')}${suffix}`;
}

function formatRadians(value) {
  return formatNumber(value, 'rad');
}

function formatPercent(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

function formatNumber(value, unit = '') {
  const number = Number(value);
  if (!Number.isFinite(number)) return 'n/a';
  const digits = Math.abs(number) >= 100 ? 0 : Math.abs(number) >= 10 ? 1 : 2;
  return `${number.toFixed(digits)}${unit ? ` ${unit}` : ''}`;
}
