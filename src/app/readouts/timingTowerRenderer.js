import { getNextTimingGapMode, getTimingGapModeLabel, normalizeTimingGapMode } from '../../config/timingGapMode.js';
import { setText, setTextAll } from '../domBindings.js';
import {
  escapeHtml,
  formatCssColor,
  formatLapGap,
  formatRaceGap,
  getTireClass,
} from './readoutFormatters.js';

function formatPenaltyHeadline(penalty) {
  const serviceType = penalty?.serviceType;
  if (serviceType === 'driveThrough') {
    return penalty?.unserved ? 'unserved drive-through penalty' : 'drive-through penalty';
  }
  if (serviceType === 'stopGo') {
    return penalty?.unserved ? 'unserved stop-go penalty' : 'stop-go penalty';
  }
  const positionDrop = Number(penalty?.positionDrop);
  if (Number.isFinite(positionDrop) && positionDrop > 0) {
    return `${positionDrop}-place position drop`;
  }
  const gridDrop = Number(penalty?.gridDrop);
  if (Number.isFinite(gridDrop) && gridDrop > 0) {
    return `${gridDrop}-place grid drop`;
  }
  if (penalty?.disqualified) return 'disqualification';
  const seconds = Number(penalty?.penaltySeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Penalty decision';
  const unit = seconds === 1 ? 'second' : 'seconds';
  return `+${seconds} ${unit} time penalty`;
}

function formatPenaltyBadgeLabel(penalty) {
  const seconds = Number(penalty?.penaltySeconds);
  const timeLabel = Number.isFinite(seconds) && seconds > 0 ? `${seconds}s ` : '';
  if (Number.isFinite(seconds) && seconds > 0 && !penalty?.serviceType) {
    return `Penalty: ${timeLabel}${String(penalty?.type ?? 'decision')}`;
  }
  return `Penalty: ${timeLabel}${formatPenaltyHeadline(penalty)}`;
}

export function hasVisiblePenaltyEffect(penalty) {
  if (!penalty || penalty.status === 'cancelled') return false;
  if (penalty.serviceRequired && penalty.status === 'served') return false;
  const penaltySeconds = Number(penalty.penaltySeconds);
  const pendingPenaltySeconds = Number(penalty.pendingPenaltySeconds);
  const positionDrop = Number(penalty.positionDrop);
  const gridDrop = Number(penalty.gridDrop);
  return penalty.serviceRequired ||
    (Number.isFinite(penaltySeconds) && penaltySeconds > 0) ||
    (Number.isFinite(pendingPenaltySeconds) && pendingPenaltySeconds > 0) ||
    (Number.isFinite(positionDrop) && positionDrop > 0) ||
    (Number.isFinite(gridDrop) && gridDrop > 0) ||
    Boolean(penalty.disqualified);
}

export function isWavedFlagCar(car) {
  return Boolean(car?.wavedFlag || car?.raceStatus === 'waved-flag' || car?.status === 'waved-flag');
}

export function isDnfCar(car) {
  return Boolean(car?.dnf || car?.destroyed || car?.outOfRace || car?.raceStatus === 'destroyed' || car?.status === 'destroyed');
}

export function getPenaltyByDriver(penalties = []) {
  const byDriver = new Map();
  penalties.forEach((penalty) => {
    if (!penalty?.driverId || byDriver.has(penalty.driverId)) return;
    if (!hasVisiblePenaltyEffect(penalty)) return;
    byDriver.set(penalty.driverId, penalty);
  });
  return byDriver;
}

export function getTimingPenaltyKey(penalties = [], { timingPenaltyBadgesEnabled = false } = {}) {
  if (!timingPenaltyBadgesEnabled) return '';
  return penalties
    .filter(hasVisiblePenaltyEffect)
    .map((penalty) => [
      penalty.id,
      penalty.driverId,
      penalty.status,
      penalty.penaltySeconds,
      penalty.pendingPenaltySeconds,
      penalty.positionDrop,
      penalty.gridDrop,
      penalty.disqualified,
    ].join(':'))
    .join('|');
}

export function getTimingOrderKey(cars = [], { timingGapMode = 'interval' } = {}) {
  return cars.map((car) => [
    car.id,
    car.rank,
    car.lap,
    formatRaceGap(car, timingGapMode),
    car.penaltySeconds ?? 0,
    car.classifiedRank ?? 0,
    car.finishRank ?? 0,
    car.dnf ? 1 : 0,
    car.destroyed ? 1 : 0,
    car.outOfRace ? 1 : 0,
    car.dnfOrder ?? 0,
    car.dnfReason ?? car.destroyReason ?? '',
    car.raceStatus ?? car.status ?? '',
    car.wavedFlag ? 1 : 0,
    car.tire ?? '',
  ].join(':')).join('|');
}

export function syncTimingGapModeControls({ readouts, buttons, timingGapMode }) {
  const normalizedMode = normalizeTimingGapMode(timingGapMode);
  const label = getTimingGapModeLabel(normalizedMode);
  const nextLabel = getTimingGapModeLabel(getNextTimingGapMode(normalizedMode));
  setTextAll(readouts.timingGapLabels ?? readouts.timingGapLabel, label);
  buttons.forEach((button) => {
    const leaderMode = normalizedMode === 'leader';
    setText(button, label);
    button.setAttribute('aria-pressed', String(leaderMode));
    button.setAttribute('aria-label', `Timing gap mode ${label}; switch to ${nextLabel}`);
    button.setAttribute('title', `Switch to ${nextLabel}`);
    button.classList?.toggle?.('is-active', leaderMode);
  });
}

function timingGapForCar(car, raceMode, timingGapMode) {
  if (isDnfCar(car)) return 'DNF';
  if (isWavedFlagCar(car) && raceMode !== 'finished') return 'WAVED';
  if (raceMode === 'finished') return car.rank === 1 ? 'Winner' : 'FIN';
  if (raceMode === 'safety-car' && car.rank > 1) return 'SC';
  if (raceMode === 'pre-start') return car.rank === 1 ? 'Pole' : 'Grid';
  if (car.rank > 1) return formatRaceGap(car, timingGapMode);
  return 'Leader';
}

function timingRowModel({ car, driver, raceMode, selectedId, timingGapMode, penalty }) {
  const dnf = isDnfCar(car);
  const tire = car.tire ?? driver?.tire ?? 'M';
  const timingCode = car.timingCode ?? driver?.timingCode ?? car.code;
  const team = car.team ?? driver?.team ?? null;
  const icon = team?.icon ?? car.icon ?? driver?.icon ?? timingCode;
  const driverColor = formatCssColor(car.color);
  const iconColor = formatCssColor(team?.color ?? car.color, driverColor);
  const penaltyLabel = penalty ? formatPenaltyBadgeLabel(penalty) : '';

  return {
    id: car.id,
    rank: car.rank,
    name: car.name,
    selected: car.id === selectedId,
    dnf,
    gap: timingGapForCar(car, raceMode, timingGapMode),
    tire,
    tireClass: getTireClass(tire),
    timingCode,
    icon,
    driverColor,
    iconColor,
    penaltyLabel,
  };
}

function timingRowKey(row) {
  return [
    row.id,
    row.rank,
    row.name,
    row.selected ? 1 : 0,
    row.dnf ? 1 : 0,
    row.gap,
    row.tire,
    row.tireClass,
    row.timingCode,
    row.icon,
    row.driverColor,
    row.iconColor,
    row.penaltyLabel,
  ].join('\u001f');
}

function timingRowsKey(rows) {
  return rows.map(timingRowKey).join('\u001e');
}

function renderTimingRowMarkup(row) {
  const penaltyBadge = row.penaltyLabel
    ? `<span class="timing-penalty-badge" aria-label="${escapeHtml(row.penaltyLabel)}" title="${escapeHtml(row.penaltyLabel)}">!</span>`
    : '';

  return `
        <li>
          <button class="timing-row ${row.selected ? 'is-selected' : ''} ${row.dnf ? 'is-dnf' : ''}" type="button"
            data-driver-id="${escapeHtml(row.id)}" aria-label="Select ${escapeHtml(row.name)}"
            style="--driver-color: ${escapeHtml(row.driverColor)}">
            <span class="timing-position">${row.rank}</span>
            <span class="timing-icon timing-team-icon" aria-hidden="true" style="--team-color: ${escapeHtml(row.iconColor)}">${escapeHtml(row.icon)}</span>
            <span class="timing-name" title="${escapeHtml(row.name)}"><span>${escapeHtml(row.timingCode)}</span>${penaltyBadge}</span>
            <span class="timing-gap">${escapeHtml(row.gap)}</span>
            <span class="timing-tire timing-tire--${row.tireClass}">${escapeHtml(row.tire)}</span>
          </button>
        </li>
      `;
}

function canPatchTimingRows(timingList) {
  return Boolean(
    timingList?.ownerDocument?.createElement &&
    typeof timingList.appendChild === 'function' &&
    timingList.children,
  );
}

function createTimingRowView(document) {
  const item = document.createElement('li');
  const button = document.createElement('button');
  const position = document.createElement('span');
  const icon = document.createElement('span');
  const name = document.createElement('span');
  const code = document.createElement('span');
  const gap = document.createElement('span');
  const tire = document.createElement('span');

  item.appendChild(button);
  button.appendChild(position);
  button.appendChild(icon);
  button.appendChild(name);
  name.appendChild(code);
  button.appendChild(gap);
  button.appendChild(tire);

  return {
    item,
    button,
    position,
    icon,
    name,
    code,
    gap,
    tire,
    penaltyBadge: null,
  };
}

function setStyleProperty(element, name, value) {
  if (typeof element.style?.setProperty === 'function') {
    element.style.setProperty(name, value);
  } else {
    element.setAttribute?.('style', `${name}: ${value}`);
  }
}

function updateTimingRowView(view, row) {
  view.button.className = `timing-row ${row.selected ? 'is-selected' : ''} ${row.dnf ? 'is-dnf' : ''}`;
  view.button.setAttribute('type', 'button');
  view.button.setAttribute('data-driver-id', row.id);
  view.button.setAttribute('aria-label', `Select ${row.name}`);
  setStyleProperty(view.button, '--driver-color', row.driverColor);

  view.position.className = 'timing-position';
  view.position.textContent = String(row.rank);

  view.icon.className = 'timing-icon timing-team-icon';
  view.icon.setAttribute('aria-hidden', 'true');
  setStyleProperty(view.icon, '--team-color', row.iconColor);
  view.icon.textContent = String(row.icon ?? '');

  view.name.className = 'timing-name';
  view.name.setAttribute('title', row.name);
  view.code.textContent = String(row.timingCode ?? '');

  if (row.penaltyLabel) {
    if (!view.penaltyBadge) {
      view.penaltyBadge = view.name.ownerDocument.createElement('span');
      view.name.appendChild(view.penaltyBadge);
    }
    view.penaltyBadge.className = 'timing-penalty-badge';
    view.penaltyBadge.setAttribute('aria-label', row.penaltyLabel);
    view.penaltyBadge.setAttribute('title', row.penaltyLabel);
    view.penaltyBadge.textContent = '!';
  } else if (view.penaltyBadge) {
    view.penaltyBadge.remove();
    view.penaltyBadge = null;
  }

  view.gap.className = 'timing-gap';
  view.gap.textContent = String(row.gap);

  view.tire.className = `timing-tire timing-tire--${row.tireClass}`;
  view.tire.textContent = String(row.tire ?? '');
}

function patchTimingRows(timingList, rows) {
  const rowViews = timingList.__paddockTimingRowViews ?? new Map();
  timingList.__paddockTimingRowViews = rowViews;
  const seen = new Set();

  rows.forEach((row) => {
    let view = rowViews.get(row.id);
    if (!view) {
      view = createTimingRowView(timingList.ownerDocument);
      rowViews.set(row.id, view);
    }
    seen.add(row.id);
    updateTimingRowView(view, row);
    timingList.appendChild(view.item);
  });

  rowViews.forEach((view, id) => {
    if (seen.has(id)) return;
    view.item.remove();
    rowViews.delete(id);
  });
}

export function renderTimingTower({
  timingList,
  cars,
  raceMode,
  penalties = [],
  driverById,
  selectedId,
  timingGapMode,
  timingPenaltyBadgesEnabled,
  lastTimingMarkup,
}) {
  if (!timingList) return lastTimingMarkup;
  const penaltyByDriver = timingPenaltyBadgesEnabled ? getPenaltyByDriver(penalties) : new Map();
  const rows = cars.map((car) => timingRowModel({
    car,
    driver: driverById.get(car.id),
    raceMode,
    selectedId,
    timingGapMode,
    penalty: penaltyByDriver.get(car.id),
  }));
  if (canPatchTimingRows(timingList)) {
    patchTimingRows(timingList, rows);
    return timingRowsKey(rows);
  }

  const timingMarkup = rows.map(renderTimingRowMarkup).join('');
  if (timingMarkup !== lastTimingMarkup || timingList.innerHTML !== timingMarkup) {
    timingList.innerHTML = timingMarkup;
    return timingMarkup;
  }
  return lastTimingMarkup;
}

export function renderTimingTowers({
  timingLists,
  timingList,
  cars,
  raceMode,
  penalties = [],
  driverById,
  selectedId,
  timingGapMode,
  timingPenaltyBadgesEnabled,
  lastTimingMarkup,
}) {
  const candidateLists = typeof timingLists?.forEach === 'function'
    ? [...timingLists]
    : [];
  const lists = candidateLists.length > 0
    ? candidateLists
    : timingList
      ? [timingList]
      : [];
  if (lists.length === 0) return lastTimingMarkup;

  let nextTimingMarkup = lastTimingMarkup;
  lists.forEach((list) => {
    nextTimingMarkup = renderTimingTower({
      timingList: list,
      cars,
      raceMode,
      penalties,
      driverById,
      selectedId,
      timingGapMode,
      timingPenaltyBadgesEnabled,
      lastTimingMarkup: nextTimingMarkup,
    });
  });
  return nextTimingMarkup;
}

export { formatLapGap, formatRaceGap };
