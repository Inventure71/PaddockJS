export function querySimulatorDom(root) {
  const readouts = {
    timingTower: root.querySelector('[data-timing-tower]'),
    mode: root.querySelector('[data-race-mode]'),
    startLights: root.querySelector('[data-start-lights]'),
    startLightsLabel: root.querySelector('[data-start-lights-label]'),
    towerLap: root.querySelector('[data-tower-lap-readout]'),
    towerTotalLaps: root.querySelector('[data-tower-total-laps]'),
    towerSafetyBanner: root.querySelector('[data-tower-safety-banner]'),
    timingGapLabel: root.querySelector('[data-timing-gap-label]'),
    lap: root.querySelector('[data-lap-readout]'),
    drs: root.querySelector('[data-drs-readout]'),
    contacts: root.querySelector('[data-contact-readout]'),
    camera: root.querySelector('[data-camera-readout]'),
    fps: root.querySelector('[data-fps-readout]'),
    selectedCode: root.querySelectorAll('[data-selected-code]'),
    selectedName: root.querySelectorAll('[data-selected-name]'),
    speed: root.querySelectorAll('[data-telemetry-speed]'),
    throttle: root.querySelectorAll('[data-telemetry-throttle]'),
    brake: root.querySelectorAll('[data-telemetry-brake]'),
    tyres: root.querySelectorAll('[data-telemetry-tyres]'),
    selectedDrs: root.querySelectorAll('[data-telemetry-drs]'),
    surface: root.querySelectorAll('[data-telemetry-surface]'),
    gap: root.querySelectorAll('[data-telemetry-gap]'),
    leaderGap: root.querySelectorAll('[data-telemetry-leader-gap]'),
    currentSector: root.querySelectorAll('[data-telemetry-current-sector]'),
    completedLaps: root.querySelectorAll('[data-telemetry-completed-laps]'),
    currentLapTime: root.querySelectorAll('[data-telemetry-current-lap-time]'),
    lastLapTime: root.querySelectorAll('[data-telemetry-last-lap-time]'),
    bestLapTime: root.querySelectorAll('[data-telemetry-best-lap-time]'),
    telemetrySectorBars: root.querySelectorAll('[data-telemetry-sector-bar]'),
    telemetrySectorTimes: root.querySelectorAll('[data-telemetry-sector-time]'),
    telemetrySectorLast: root.querySelectorAll('[data-telemetry-sector-last]'),
    telemetrySectorBest: root.querySelectorAll('[data-telemetry-sector-best]'),
    telemetrySectorBanners: root.querySelectorAll('[data-telemetry-sector-banner]'),
    carOverview: root.querySelector('[data-paddock-component="car-driver-overview"]'),
    carOverviewTitle: root.querySelector('[data-car-overview-title]'),
    carOverviewDiagram: root.querySelector('.car-overview-diagram'),
    carOverviewCode: root.querySelector('[data-car-overview-code]'),
    carOverviewIcon: root.querySelector('[data-car-overview-icon]'),
    carOverviewImage: root.querySelector('[data-car-overview-image]'),
    carOverviewNumber: root.querySelector('[data-car-overview-number]'),
    carOverviewCoreStat: root.querySelector('[data-car-overview-core-stat]'),
    carOverviewFields: root.querySelectorAll('[data-overview-field]'),
    telemetryDrawerWorkbench: root.querySelector('[data-race-telemetry-drawer]'),
    telemetryDrawer: root.querySelector('[data-telemetry-drawer]'),
    telemetryDrawerToggle: root.querySelector('[data-telemetry-drawer-toggle]'),
    stewardMessage: root.querySelector('[data-steward-message]'),
    stewardMessageKicker: root.querySelector('[data-steward-message-kicker]'),
    stewardMessageTitle: root.querySelector('[data-steward-message-title]'),
    stewardMessageDetail: root.querySelector('[data-steward-message-detail]'),
    raceDataPanel: root.querySelector('[data-race-data-panel]'),
    raceDataKicker: root.querySelector('[data-race-data-kicker]'),
    raceDataTitle: root.querySelector('[data-race-data-title]'),
    raceDataNumber: root.querySelector('[data-race-data-number]'),
    raceDataSubtitle: root.querySelector('[data-race-data-subtitle]'),
    raceDataOpen: root.querySelector('[data-race-data-open]'),
    finishPanel: root.querySelector('[data-race-finish-panel]'),
    finishWinner: root.querySelector('[data-race-finish-winner]'),
    finishClassification: root.querySelector('[data-race-finish-classification]'),
  };

  return {
    canvasHost: root.querySelector('[data-track-canvas]'),
    safetyButtons: root.querySelectorAll('[data-safety-car]'),
    restartButton: root.querySelector('[data-restart-race]'),
    openButton: root.querySelector('[data-race-data-open]'),
    timingList: root.querySelector('[data-timing-list]'),
    timingGapModeButtons: root.querySelectorAll('[data-timing-gap-mode]'),
    cameraButtons: root.querySelectorAll('[data-camera-mode]'),
    overviewModeButtons: root.querySelectorAll('[data-overview-mode]'),
    zoomInButton: root.querySelector('[data-zoom-in]'),
    zoomOutButton: root.querySelector('[data-zoom-out]'),
    readouts,
    startLightNodes: [...(readouts.startLights?.querySelectorAll('.start-lights__gantry span') ?? [])],
  };
}

export function setText(node, value) {
  if (!node) return;
  const nextValue = String(value ?? '');
  if (node.textContent !== nextValue) node.textContent = nextValue;
}

export function setTextAll(nodes, value) {
  if (!nodes) return;
  if (typeof nodes.forEach === 'function') {
    nodes.forEach((node) => setText(node, value));
    return;
  }
  setText(nodes, value);
}
