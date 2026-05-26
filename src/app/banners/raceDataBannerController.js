import { formatDriverNumber } from '../../data/championship.js';
import { formatCssColor } from '../../config/cssValues.js';
import { setStyleProperty, setText } from '../domBindings.js';

export const RACE_DATA_SELECTED_VISIBLE_MS = 5200;
export const RADIO_BREAK_MIN_MS = 4800;
export const RADIO_BREAK_MAX_MS = 11800;
export const RADIO_VISIBLE_MIN_MS = 6200;
export const RADIO_VISIBLE_MAX_MS = 9200;
export const RADIO_SCHEDULE_CATCHUP_LIMIT_MS = 30000;

function getRaceDataPanelBindings(readouts) {
  if (readouts.raceDataPanelBindings?.length) return readouts.raceDataPanelBindings;
  if (!readouts.raceDataPanel) return [];
  return [{
    panel: readouts.raceDataPanel,
    kicker: readouts.raceDataKicker,
    title: readouts.raceDataTitle,
    number: readouts.raceDataNumber,
    subtitle: readouts.raceDataSubtitle,
    open: readouts.raceDataOpen,
    dismiss: readouts.raceDataDismiss,
  }];
}

function hasTelemetryDetailPanel(readouts) {
  return getRaceDataPanelBindings(readouts).some((binding) => (
    binding.panel?.classList?.contains?.('race-data-panel--with-telemetry')
  ));
}

function clearRaceDataIdleMode(panel) {
  panel?.removeAttribute?.('data-idle-mode');
  if (panel?.dataset) delete panel.dataset.idleMode;
}

function setRaceDataIdleMode(panel, mode) {
  if (panel?.dataset) {
    panel.dataset.idleMode = mode;
    return;
  }
  panel?.setAttribute?.('data-idle-mode', mode);
}

export function shouldAutoHideActiveRaceData({ activeRaceDataId, options, readouts }) {
  return Boolean(
    activeRaceDataId &&
    !(
      options.ui?.raceDataTelemetryDetail ||
      hasTelemetryDetailPanel(readouts)
    ),
  );
}

export function renderRaceData({ car, drivers, readouts, options }) {
  const panels = getRaceDataPanelBindings(readouts);
  if (!car || !panels.length) return false;
  if (typeof options.isRaceDataBannerEnabled === 'function' && !options.isRaceDataBannerEnabled('project')) return false;
  const driver = drivers.find((item) => item.id === car.id);
  if (!driver) return false;

  panels.forEach((binding) => {
    setStyleProperty(binding.panel, '--driver-color', formatCssColor(driver.color));
    binding.panel.classList.remove('is-hidden');
    binding.panel.classList.add('is-project-mode');
    binding.panel.classList.remove('is-radio-mode');
    clearRaceDataIdleMode(binding.panel);
    setText(binding.kicker, 'Project');
    setText(binding.title, driver.name);
    setText(binding.number, formatDriverNumber(car.driverNumber ?? driver.driverNumber));
    setText(binding.subtitle, `${car.code} - P${car.rank} - ${driver.raceData?.[0] ?? 'Project entry'}`);
    if (binding.open) {
      binding.open.hidden = typeof options.onDriverOpen !== 'function';
    }
  });
  return true;
}

export function hideRaceDataPanel(readouts) {
  getRaceDataPanelBindings(readouts).forEach((binding) => {
    binding.panel.classList.add('is-hidden');
    binding.panel.classList.remove('is-project-mode', 'is-radio-mode');
    clearRaceDataIdleMode(binding.panel);
    if (binding.open) binding.open.hidden = true;
  });
}

export function getProjectRadioQuote({ drivers, radioState }) {
  const driver = drivers[radioState.driverIndex] ?? drivers[0];
  const quote = driver.raceData?.[radioState.quoteIndex] ?? 'Project entry';

  return {
    color: formatCssColor(driver.color),
    title: driver.name,
    subtitle: `${driver.code} - "${quote}"`,
  };
}

export function renderProjectRadio({ readouts, radio }) {
  getRaceDataPanelBindings(readouts).forEach((binding) => {
    setStyleProperty(binding.panel, '--driver-color', formatCssColor(radio.color));
    binding.panel.classList.remove('is-hidden');
    binding.panel.classList.add('is-radio-mode');
    binding.panel.classList.remove('is-project-mode');
    setRaceDataIdleMode(binding.panel, 'quote');
    setText(binding.kicker, 'Project radio');
    setText(binding.title, radio.title);
    setText(binding.number, '');
    setText(binding.subtitle, radio.subtitle);
    if (binding.open) binding.open.hidden = true;
  });
}

export function randomRadioRange(nextRandom, min, max) {
  return min + nextRandom() * (max - min);
}

export function getNextRadioBreakTime({ now, isEnabled, nextRandom }) {
  return isEnabled('radio')
    ? now + randomRadioRange(nextRandom, RADIO_BREAK_MIN_MS, RADIO_BREAK_MAX_MS)
    : Number.POSITIVE_INFINITY;
}

export function scheduleRadioBreak({ radioState, now, isEnabled, nextRandom }) {
  radioState.visible = false;
  radioState.nextChangeAt = getNextRadioBreakTime({ now, isEnabled, nextRandom });
}

export function scheduleRadioPopup({ radioState, now, drivers, isEnabled, nextRandom }) {
  if (!isEnabled('radio')) {
    scheduleRadioBreak({ radioState, now, isEnabled, nextRandom });
    return;
  }
  const driverIndex = Math.floor(nextRandom() * drivers.length);
  const driver = drivers[driverIndex] ?? drivers[0];
  const quoteCount = Math.max(1, driver.raceData?.length ?? 1);
  radioState.visible = true;
  radioState.driverIndex = driverIndex;
  radioState.quoteIndex = Math.floor(nextRandom() * quoteCount);
  radioState.nextChangeAt = now + randomRadioRange(nextRandom, RADIO_VISIBLE_MIN_MS, RADIO_VISIBLE_MAX_MS);
}

export function updateRadioSchedule({ radioState, now, drivers, isEnabled, nextRandom }) {
  if (!isEnabled('radio')) {
    radioState.visible = false;
    radioState.nextChangeAt = Number.POSITIVE_INFINITY;
    return;
  }
  if (
    Number.isFinite(radioState.nextChangeAt) &&
    now - radioState.nextChangeAt > RADIO_SCHEDULE_CATCHUP_LIMIT_MS
  ) {
    if (radioState.visible) scheduleRadioBreak({ radioState, now, isEnabled, nextRandom });
    else scheduleRadioPopup({ radioState, now, drivers, isEnabled, nextRandom });
    return;
  }
  while (now >= radioState.nextChangeAt) {
    if (radioState.visible) {
      scheduleRadioBreak({ radioState, now: radioState.nextChangeAt, isEnabled, nextRandom });
    } else {
      scheduleRadioPopup({ radioState, now: radioState.nextChangeAt, drivers, isEnabled, nextRandom });
    }
  }
}

export function resetRaceDataBannerState({ state, now, initialMode, selectedId, isEnabled, nextRandom }) {
  state.activeRaceDataId = isEnabled('project') && initialMode === 'project' ? selectedId : null;
  state.lastRaceDataInteraction = now;
  const showInitialRadio = isEnabled('radio') && initialMode === 'radio';
  state.radioState.visible = showInitialRadio;
  state.radioState.nextChangeAt = showInitialRadio
    ? now + randomRadioRange(nextRandom, RADIO_VISIBLE_MIN_MS, RADIO_VISIBLE_MAX_MS)
    : getNextRadioBreakTime({ now, isEnabled, nextRandom });
  state.radioState.driverIndex = 0;
  state.radioState.quoteIndex = 0;
}
