import { setText } from '../domBindings.js';
import { escapeHtml, formatLapGap, formatRaceGap, getTireClass } from './readoutFormatters.js';

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
  const label = timingGapMode === 'leader' ? 'Gap' : 'Int';
  setText(readouts.timingGapLabel, label);
  buttons.forEach((button) => {
    const active = button.dataset.timingGapMode === timingGapMode;
    button.setAttribute('aria-pressed', String(active));
    button.classList?.toggle?.('is-active', active);
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
  const timingMarkup = cars.map((car) => {
    const driver = driverById.get(car.id);
    const dnf = isDnfCar(car);
    let gap = 'Leader';
    if (dnf) {
      gap = 'DNF';
    } else if (isWavedFlagCar(car) && raceMode !== 'finished') {
      gap = 'WAVED';
    } else if (raceMode === 'finished') {
      gap = car.rank === 1 ? 'Winner' : 'FIN';
    } else if (raceMode === 'safety-car' && car.rank > 1) {
      gap = 'SC';
    } else if (raceMode === 'pre-start') {
      gap = car.rank === 1 ? 'Pole' : 'Grid';
    } else if (car.rank > 1) {
      gap = formatRaceGap(car, timingGapMode);
    }
    const tire = car.tire ?? driver?.tire ?? 'M';
    const timingCode = car.timingCode ?? driver?.timingCode ?? car.code;
    const team = car.team ?? driver?.team ?? null;
    const icon = team?.icon ?? car.icon ?? driver?.icon ?? timingCode;
    const iconColor = team?.color ?? car.color;
    const penalty = penaltyByDriver.get(car.id);
    const penaltyBadge = penalty
      ? `<span class="timing-penalty-badge" aria-label="${escapeHtml(formatPenaltyBadgeLabel(penalty))}" title="${escapeHtml(formatPenaltyBadgeLabel(penalty))}">!</span>`
      : '';

    return `
        <li>
          <button class="timing-row ${car.id === selectedId ? 'is-selected' : ''} ${dnf ? 'is-dnf' : ''}" type="button"
            data-driver-id="${escapeHtml(car.id)}" aria-label="Select ${escapeHtml(car.name)}"
            style="--driver-color: ${escapeHtml(car.color)}">
            <span class="timing-position">${car.rank}</span>
            <span class="timing-icon timing-team-icon" aria-hidden="true" style="--team-color: ${escapeHtml(iconColor)}">${escapeHtml(icon)}</span>
            <span class="timing-name" title="${escapeHtml(car.name)}"><span>${escapeHtml(timingCode)}</span>${penaltyBadge}</span>
            <span class="timing-gap">${escapeHtml(gap)}</span>
            <span class="timing-tire timing-tire--${getTireClass(tire)}">${escapeHtml(tire)}</span>
          </button>
        </li>
      `;
  }).join('');
  if (timingMarkup !== lastTimingMarkup) {
    timingList.innerHTML = timingMarkup;
    return timingMarkup;
  }
  return lastTimingMarkup;
}

export { formatLapGap, formatRaceGap };
