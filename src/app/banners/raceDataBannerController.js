import { formatDriverNumber } from '../../data/championship.js';
import { setText } from '../domBindings.js';

export const RACE_DATA_SELECTED_VISIBLE_MS = 5200;
export const RADIO_BREAK_MIN_MS = 4800;
export const RADIO_BREAK_MAX_MS = 11800;
export const RADIO_VISIBLE_MIN_MS = 6200;
export const RADIO_VISIBLE_MAX_MS = 9200;
export const RADIO_SCHEDULE_CATCHUP_LIMIT_MS = 30000;

export function shouldAutoHideActiveRaceData({ activeRaceDataId, options, readouts }) {
  return Boolean(
    activeRaceDataId &&
    !(
      options.ui?.raceDataTelemetryDetail ||
      readouts.raceDataPanel?.classList?.contains?.('race-data-panel--with-telemetry')
    ),
  );
}

export function renderRaceData({ car, drivers, readouts, options }) {
  if (!car || !readouts.raceDataPanel) return false;
  if (typeof options.isRaceDataBannerEnabled === 'function' && !options.isRaceDataBannerEnabled('project')) return false;
  const driver = drivers.find((item) => item.id === car.id);
  if (!driver) return false;

  readouts.raceDataPanel.style.setProperty('--driver-color', driver.color);
  readouts.raceDataPanel.classList.remove('is-hidden');
  readouts.raceDataPanel.classList.add('is-project-mode');
  readouts.raceDataPanel.classList.remove('is-radio-mode');
  readouts.raceDataPanel.removeAttribute('data-idle-mode');
  setText(readouts.raceDataKicker, 'Project');
  setText(readouts.raceDataTitle, driver.name);
  if (readouts.raceDataNumber) {
    readouts.raceDataNumber.textContent = formatDriverNumber(car.driverNumber ?? driver.driverNumber);
  }
  if (readouts.raceDataSubtitle) {
    readouts.raceDataSubtitle.textContent = `${car.code} - P${car.rank} - ${driver.raceData?.[0] ?? 'Project entry'}`;
  }
  if (readouts.raceDataOpen) {
    readouts.raceDataOpen.hidden = typeof options.onDriverOpen !== 'function';
  }
  return true;
}

export function hideRaceDataPanel(readouts) {
  if (!readouts.raceDataPanel) return;
  readouts.raceDataPanel.classList.add('is-hidden');
  readouts.raceDataPanel.classList.remove('is-project-mode', 'is-radio-mode');
  readouts.raceDataPanel.removeAttribute('data-idle-mode');
  if (readouts.raceDataOpen) readouts.raceDataOpen.hidden = true;
}

export function getProjectRadioQuote({ drivers, radioState }) {
  const driver = drivers[radioState.driverIndex] ?? drivers[0];
  const quote = driver.raceData?.[radioState.quoteIndex] ?? 'Project entry';

  return {
    color: driver.color,
    title: driver.name,
    subtitle: `${driver.code} - "${quote}"`,
  };
}

export function renderProjectRadio({ readouts, radio }) {
  if (!readouts.raceDataPanel) return;
  readouts.raceDataPanel.style.setProperty('--driver-color', radio.color);
  readouts.raceDataPanel.classList.remove('is-hidden');
  readouts.raceDataPanel.classList.add('is-radio-mode');
  readouts.raceDataPanel.classList.remove('is-project-mode');
  readouts.raceDataPanel.dataset.idleMode = 'quote';
  setText(readouts.raceDataKicker, 'Project radio');
  setText(readouts.raceDataTitle, radio.title);
  setText(readouts.raceDataNumber, '');
  setText(readouts.raceDataSubtitle, radio.subtitle);
  if (readouts.raceDataOpen) readouts.raceDataOpen.hidden = true;
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
