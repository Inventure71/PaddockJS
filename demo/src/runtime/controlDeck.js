export function installControlDeck({ controller, primaryDriverId, readout, buttons }) {
  let restartIndex = 0;

  const byAction = new Map(buttons.map((button) => [button.dataset.raceAction, button]));

  const listeners = [];
  function bindAction(action, callback) {
    const button = byAction.get(action);
    if (!button) return;
    button.addEventListener('click', callback);
    listeners.push({ button, callback });
  }

  function syncButtons(snapshot = controller.getSnapshot()) {
    const raceControl = snapshot?.raceControl;
    const safetyCar = raceControl?.mode === 'safety-car';
    const redFlag = Boolean(raceControl?.redFlag);
    const pitLaneOpen = raceControl?.pitLaneOpen ?? true;
    const lightTheme = controller.getTheme().activeMode === 'light';
    byAction.get('safety-car')?.setAttribute('aria-pressed', String(safetyCar));
    byAction.get('red-flag')?.setAttribute('aria-pressed', String(redFlag));
    byAction.get('pit-lane')?.setAttribute('aria-pressed', String(pitLaneOpen));
    const pitButton = byAction.get('pit-lane');
    if (pitButton) pitButton.textContent = pitLaneOpen ? 'Pit lane open' : 'Pit lane closed';
    const themeButton = byAction.get('theme');
    if (themeButton) themeButton.textContent = `Theme: ${lightTheme ? 'light' : 'dark'}`;
    const timingButton = byAction.get('timing-gap');
    if (timingButton) timingButton.textContent = `Timing: ${controller.getTimingGapMode()}`;
    const pitStopButton = byAction.get('pit-stop');
    if (pitStopButton) {
      pitStopButton.textContent = controller.getPitIntent(primaryDriverId) === 2
        ? `Pit committed · ${controller.getPitTargetCompound(primaryDriverId)}`
        : 'Call pit stop';
    }
  }

  bindAction('safety-car', () => {
    controller.setSafetyCarDeployed(controller.getSnapshot()?.raceControl?.mode !== 'safety-car');
    syncButtons();
  });
  bindAction('red-flag', () => {
    controller.setRedFlagDeployed(!controller.getSnapshot()?.raceControl?.redFlag);
    syncButtons();
  });
  bindAction('pit-lane', () => {
    controller.setPitLaneOpen(!(controller.getSnapshot()?.raceControl?.pitLaneOpen ?? true));
    syncButtons();
  });
  bindAction('timing-gap', () => {
    controller.toggleTimingGapMode();
    syncButtons();
  });
  bindAction('pit-stop', () => {
    const currentTarget = controller.getPitTargetCompound(primaryDriverId);
    const target = currentTarget === 'H' ? 'M' : 'H';
    controller.setPitIntent(primaryDriverId, 2, target);
    syncButtons();
  });
  bindAction('theme', () => {
    controller.setThemeMode(controller.getTheme().activeMode === 'light' ? 'dark' : 'light');
    syncButtons();
  });
  bindAction('restart', () => {
    restartIndex += 1;
    controller.restart({
      seed: 71 + restartIndex,
      trackSeed: 7109 + restartIndex,
    });
    syncButtons();
  });

  const updateReadout = () => {
    const snapshot = controller.getSnapshot();
    if (!snapshot) return;
    const leader = snapshot.cars?.[0];
    const lap = leader?.lap ?? 0;
    const mode = snapshot.raceControl?.mode ?? 'pre-start';
    const leaderName = leader?.name ?? leader?.driverId ?? 'forming grid';
    readout.textContent = `Lap ${lap}/${snapshot.totalLaps ?? 5} · ${mode} · ${leaderName} leads`;
    syncButtons(snapshot);
  };
  const readoutInterval = window.setInterval(updateReadout, 750);
  updateReadout();

  return () => {
    window.clearInterval(readoutInterval);
    listeners.forEach(({ button, callback }) => button.removeEventListener('click', callback));
  };
}
