function uniqueNodes(nodes = []) {
  return [...new Set([...nodes].filter(Boolean))];
}

// Bind DOM gestures to commands without owning race state or a simulation.
export function bindWorkbenchControls(nodes, commands, signal) {
  const eventOptions = { signal };
  nodes.safetyButtons.forEach((button) => {
    button.addEventListener('click', commands.toggleSafetyCar, eventOptions);
  });
  uniqueNodes(nodes.restartButtons?.length ? nodes.restartButtons : [nodes.restartButton]).forEach((button) => button.addEventListener('click', commands.restart, eventOptions));
  nodes.cameraButtons.forEach((button) => {
    button.addEventListener('click', () => commands.setCameraMode(button.dataset.cameraMode), eventOptions);
  });
  for (const [buttons, fallback, direction] of [[nodes.zoomInButtons, nodes.zoomInButton, 1], [nodes.zoomOutButtons, nodes.zoomOutButton, -1]]) {
    uniqueNodes(buttons?.length ? buttons : [fallback]).forEach((button) => button.addEventListener('click', () => commands.adjustCameraZoom(direction), eventOptions));
  }
  nodes.simulationSpeedButtons?.forEach((button) => {
    button.addEventListener('click', commands.cycleSimulationSpeed, eventOptions);
  });
  commands.updateSimulationSpeedControls();
  nodes.bannerMuteButtons?.forEach((button) => {
    button.addEventListener('click', commands.toggleRaceDataBanners, eventOptions);
  });
  nodes.overviewModeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      commands.setOverviewMode(button.dataset.overviewMode === 'driver' ? 'driver' : 'vehicle');
    }, eventOptions);
  });
  nodes.timingGapModeButtons.forEach((button) => {
    button.addEventListener('click', commands.toggleTimingGapMode, eventOptions);
  });
  nodes.timingLists?.forEach?.((timingList) => {
    timingList.addEventListener?.('click', (event) => {
      const row = event.target instanceof Element ? event.target.closest('[data-driver-id]') : null;
      if (row) commands.selectCar(row.dataset.driverId);
    }, eventOptions);
  });
  nodes.timingPanelToggles?.forEach?.((toggle) => {
    toggle.addEventListener?.('click', () => {
      const racePanel = toggle.closest?.('.sim-canvas-panel');
      commands.setTimingPanelOpen(!racePanel?.classList?.contains?.('is-timing-panel-open'), racePanel);
    }, eventOptions);
  });
  const openButtons = uniqueNodes(nodes.raceDataOpens?.length ? nodes.raceDataOpens : [nodes.openButton]);
  openButtons.forEach((button) => button.addEventListener('click', commands.openDriver, eventOptions));
  const dismissButtons = uniqueNodes(nodes.raceDataDismisses?.length ? nodes.raceDataDismisses : [nodes.raceDataDismiss]);
  dismissButtons.forEach((button) => button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    commands.dismissRaceDataPanel(performance.now());
  }, eventOptions));
  nodes.telemetryDrawerToggle?.addEventListener('click', commands.toggleTelemetryDrawer, eventOptions);
}

export function bindCameraWheelControls(canvasHost, adjustCameraZoom, eventOptions, isEnabled = () => true) {
  if (!canvasHost?.addEventListener) return;
  canvasHost.addEventListener('wheel', (event) => {
    if (!isEnabled() || event.ctrlKey || event.metaKey || !Number.isFinite(event.deltaY) || event.deltaY === 0) return;
    event.preventDefault?.();
    adjustCameraZoom(event.deltaY > 0 ? -1 : 1);
  }, { ...eventOptions, passive: false });
}
