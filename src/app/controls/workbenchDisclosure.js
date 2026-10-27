export function renderTelemetryDrawerDisclosure({ workbench, drawer, toggle }, open) {
  workbench?.classList?.toggle?.('is-telemetry-open', open);
  if (open) {
    drawer?.removeAttribute?.('inert');
    drawer?.setAttribute?.('aria-hidden', 'false');
  } else {
    drawer?.setAttribute?.('inert', '');
    drawer?.setAttribute?.('aria-hidden', 'true');
  }
  toggle?.setAttribute?.('aria-expanded', String(open));
  if (toggle) {
    toggle.textContent = open ? 'Close' : 'Telemetry';
    toggle.setAttribute('aria-label', open ? 'Close telemetry' : 'Open telemetry');
  }
}

export function isTimingPanelDisclosureMode(toggle) {
  if (!toggle) return false;
  const style = getComputedStyle(toggle);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

export function syncTimingPanelDisclosureState({ toggles, targetPanel = null, isDisclosureMode = isTimingPanelDisclosureMode }) {
  for (const toggle of [...(toggles ?? [])]) {
    const racePanel = toggle.closest?.('.sim-canvas-panel');
    if (targetPanel && racePanel !== targetPanel) continue;
    const tower = racePanel?.querySelector?.('[data-timing-tower]');
    const disclosureMode = isDisclosureMode(toggle);
    const open = disclosureMode && Boolean(racePanel?.classList?.contains?.('is-timing-panel-open'));
    racePanel?.classList?.toggle?.('is-timing-panel-open', open);
    if (!disclosureMode || open) {
      tower?.removeAttribute?.('inert');
      tower?.setAttribute?.('aria-hidden', 'false');
    } else {
      tower?.setAttribute?.('inert', '');
      tower?.setAttribute?.('aria-hidden', 'true');
    }
    toggle.setAttribute?.('aria-expanded', String(open));
  }
}
