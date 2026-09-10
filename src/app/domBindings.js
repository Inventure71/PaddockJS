function toArray(nodes) {
  return [...(nodes ?? [])];
}

export function resolveNodes(nodes, fallbackNode = null) {
  const resolved = [];
  if (typeof nodes?.forEach === 'function') {
    nodes.forEach((node) => {
      if (node && !resolved.includes(node)) resolved.push(node);
    });
  }
  if (resolved.length === 0 && fallbackNode) resolved.push(fallbackNode);
  return resolved;
}

function queryRaceDataPanelBindings(root) {
  const panelSelector = '[data-race-data-panel]';
  const panels = toArray(root.querySelectorAll(panelSelector));
  const fallbackPanel = panels.length ? null : root.querySelector(panelSelector);
  const raceDataPanels = panels.length ? panels : (fallbackPanel ? [fallbackPanel] : []);

  const findInPanel = (panel, selector) => panel?.querySelector?.(selector) ?? null;
  const findFallback = (panel, selector) => findInPanel(panel, selector) ?? root.querySelector(selector);
  const bindings = raceDataPanels.map((panel) => ({
    panel,
    kicker: findFallback(panel, '[data-race-data-kicker]'),
    title: findFallback(panel, '[data-race-data-title]'),
    number: findFallback(panel, '[data-race-data-number]'),
    subtitle: findFallback(panel, '[data-race-data-subtitle]'),
    open: findFallback(panel, '[data-race-data-open]'),
    dismiss: findFallback(panel, '[data-race-data-dismiss]'),
  }));

  const first = bindings[0] ?? {};
  const fallbackOpen = first.open ?? root.querySelector('[data-race-data-open]');
  const fallbackDismiss = first.dismiss ?? root.querySelector('[data-race-data-dismiss]');
  return {
    raceDataPanelBindings: bindings,
    raceDataOpens: bindings.map((binding) => binding.open).filter(Boolean),
    raceDataDismisses: bindings.map((binding) => binding.dismiss).filter(Boolean),
    raceDataPanel: first.panel ?? null,
    raceDataKicker: first.kicker ?? null,
    raceDataTitle: first.title ?? null,
    raceDataNumber: first.number ?? null,
    raceDataSubtitle: first.subtitle ?? null,
    raceDataOpen: fallbackOpen ?? null,
    raceDataDismiss: fallbackDismiss ?? null,
  };
}

function queryCarOverviewFieldBindings(root) {
  const fields = toArray(root.querySelectorAll('[data-overview-field]'));
  return fields.map((field) => ({
    field,
    label: field.querySelector?.('[data-overview-field-label]') ?? null,
    value: field.querySelector?.('[data-overview-field-value]') ?? null,
  }));
}

export function querySimulatorDom(root) {
  const raceDataBindings = queryRaceDataPanelBindings(root);
  const carOverviewFieldBindings = queryCarOverviewFieldBindings(root);
  const readouts = {
    timingTower: root.querySelector('[data-timing-tower]'),
    timingTowers: root.querySelectorAll('[data-timing-tower]'),
    timingPanelToggle: root.querySelector('[data-timing-panel-toggle]'),
    timingPanelToggles: root.querySelectorAll('[data-timing-panel-toggle]'),
    mode: root.querySelector('[data-race-mode]'),
    startLights: root.querySelector('[data-start-lights]'),
    startLightsLabel: root.querySelector('[data-start-lights-label]'),
    towerLap: root.querySelector('[data-tower-lap-readout]'),
    towerLaps: root.querySelectorAll('[data-tower-lap-readout]'),
    towerTotalLaps: root.querySelector('[data-tower-total-laps]'),
    towerTotalLapsAll: root.querySelectorAll('[data-tower-total-laps]'),
    towerRaceControlBanner: root.querySelector('[data-tower-race-control-banner]'),
    towerRaceControlBanners: root.querySelectorAll('[data-tower-race-control-banner]'),
    towerRaceControlKicker: root.querySelector('[data-tower-race-control-kicker]'),
    towerRaceControlKickers: root.querySelectorAll('[data-tower-race-control-kicker]'),
    towerRaceControlTitle: root.querySelector('[data-tower-race-control-title]'),
    towerRaceControlTitles: root.querySelectorAll('[data-tower-race-control-title]'),
    timingGapLabel: root.querySelector('[data-timing-gap-label]'),
    timingGapLabels: root.querySelectorAll('[data-timing-gap-label]'),
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
    grip: root.querySelectorAll('[data-telemetry-grip]'),
    lateralG: root.querySelectorAll('[data-telemetry-lateral-g]'),
    slipAngle: root.querySelectorAll('[data-telemetry-slip-angle]'),
    stability: root.querySelectorAll('[data-telemetry-stability]'),
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
    carOverviewFieldBindings,
    telemetryDrawerWorkbench: root.querySelector('[data-race-telemetry-drawer]'),
    telemetryDrawer: root.querySelector('[data-telemetry-drawer]'),
    telemetryDrawerToggle: root.querySelector('[data-telemetry-drawer-toggle]'),
    stewardMessage: root.querySelector('[data-steward-message]'),
    stewardMessageKicker: root.querySelector('[data-steward-message-kicker]'),
    stewardMessageTitle: root.querySelector('[data-steward-message-title]'),
    stewardMessageDetail: root.querySelector('[data-steward-message-detail]'),
    ...raceDataBindings,
    finishPanel: root.querySelector('[data-race-finish-panel]'),
    finishWinner: root.querySelector('[data-race-finish-winner]'),
    finishClassification: root.querySelector('[data-race-finish-classification]'),
  };

  return {
    canvasHost: root.querySelector('[data-track-canvas]'),
    safetyButtons: root.querySelectorAll('[data-safety-car]'),
    restartButton: root.querySelector('[data-restart-race]'),
    openButton: raceDataBindings.raceDataOpen,
    timingList: root.querySelector('[data-timing-list]'),
    timingGapModeButtons: root.querySelectorAll('[data-timing-gap-toggle]'),
    cameraButtons: root.querySelectorAll('[data-camera-mode]'),
    overviewModeButtons: root.querySelectorAll('[data-overview-mode]'),
    bannerMuteButtons: root.querySelectorAll('[data-race-data-banners-muted]'),
    simulationSpeedButtons: root.querySelectorAll('[data-simulation-speed]'),
    zoomInButton: root.querySelector('[data-zoom-in]'),
    zoomOutButton: root.querySelector('[data-zoom-out]'),
    timingLists: root.querySelectorAll('[data-timing-list]'),
    readouts,
    startLightNodes: [...(readouts.startLights?.querySelectorAll('.start-lights__gantry span') ?? [])],
  };
}

export function setText(node, value) {
  if (!node) return;
  const nextValue = String(value ?? '');
  if (node.textContent !== nextValue) node.textContent = nextValue;
}

export function setStyleProperty(node, name, value) {
  if (!node?.style?.setProperty) return;
  const nextValue = String(value ?? '');
  const currentValue = typeof node.style.getPropertyValue === 'function'
    ? node.style.getPropertyValue(name)
    : null;
  if (currentValue !== nextValue) node.style.setProperty(name, nextValue);
}

export function setTextAll(nodes, value) {
  if (!nodes) return;
  if (typeof nodes.forEach === 'function') {
    nodes.forEach((node) => setText(node, value));
    return;
  }
  setText(nodes, value);
}
