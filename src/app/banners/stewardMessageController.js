import { setText } from '../domBindings.js';
import {
  formatPenaltyChip,
  formatPenaltyHeadline,
  formatPenaltyType,
  formatStewardMessageKey,
} from './bannerFormatters.js';

export const PENALTY_BANNER_VISIBLE_MS = 12000;

export function createPenaltyStewardMessage(penalty, driverById) {
  if (!penalty) return null;
  const driver = driverById.get(penalty.driverId);
  const code = driver?.timingCode ?? driver?.code ?? penalty.driverId ?? 'CAR';
  return {
    kind: 'penalty',
    type: penalty.type,
    driverId: penalty.driverId,
    penaltyId: penalty.id,
    time: penalty.time,
    color: driver?.color ?? 'var(--red)',
    kicker: formatPenaltyChip(penalty),
    title: `${code} ${formatPenaltyHeadline(penalty).replace(/^\+\d+ seconds? /u, '')}`,
    detail: `${formatPenaltyType(penalty.type)} - ${penalty.reason ?? 'Steward decision'}`,
  };
}

export function createWarningStewardMessage(event, driverById) {
  if (!event) return null;
  const driver = driverById.get(event.carId);
  const code = driver?.timingCode ?? driver?.code ?? event.carId ?? 'CAR';
  const warningLimit = Number(event.warningsBeforePenalty);
  const warningProgress = Number.isFinite(warningLimit) && warningLimit > 0
    ? ` ${event.violationCount}/${warningLimit}`
    : '';
  return {
    kind: 'warning',
    type: event.type,
    driverId: event.carId,
    violationCount: event.violationCount,
    time: event.at,
    color: driver?.color ?? 'var(--yellow)',
    kicker: 'Warning',
    title: `${code} ${formatPenaltyType(event.type).toLowerCase()}`,
    detail: `${formatPenaltyType(event.type)}${warningProgress}`,
  };
}

export function updateStewardMessageState({
  snapshot,
  now,
  state,
  driverById,
  penaltyBannerEnabled,
  stewardMessageNode,
}) {
  if (!penaltyBannerEnabled || !stewardMessageNode) {
    state.activeStewardMessage = null;
    return state;
  }
  if (state.activeStewardMessage && now < state.activeStewardMessage.visibleUntil) return state;
  state.activeStewardMessage = null;

  const warning = [...(snapshot.events ?? [])].reverse().find((event) => (
    event?.type === 'track-limits' && event.decision === 'warning'
  ));
  const penalty = [...(snapshot.penalties ?? [])].reverse().find((entry) => (
    entry?.id && entry.id !== state.lastPenaltyBannerId
  ));
  const message = penalty
    ? createPenaltyStewardMessage(penalty, driverById)
    : createWarningStewardMessage(warning, driverById);
  const key = formatStewardMessageKey(message);
  if (!message || !key || key === state.lastStewardMessageKey) return state;
  state.lastStewardMessageKey = key;
  if (message.penaltyId) state.lastPenaltyBannerId = message.penaltyId;
  state.activeStewardMessage = {
    message,
    visibleUntil: now + PENALTY_BANNER_VISIBLE_MS,
  };
  return state;
}

export function renderActiveStewardMessage(readouts, activeStewardMessage) {
  const message = activeStewardMessage?.message;
  const panel = readouts.stewardMessage;
  if (!panel) return;
  if (!message) {
    panel.classList.add('is-hidden');
    panel.classList.remove('is-penalty', 'is-warning');
    return;
  }
  panel.style.setProperty('--steward-color', message.color);
  panel.classList.remove('is-hidden', 'is-penalty', 'is-warning');
  panel.classList.add(message.kind === 'penalty' ? 'is-penalty' : 'is-warning');
  setText(readouts.stewardMessageKicker, message.kicker);
  setText(readouts.stewardMessageTitle, message.title);
  setText(readouts.stewardMessageDetail, message.detail);
}
