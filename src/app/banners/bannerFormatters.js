export function formatPenaltyType(type) {
  return String(type ?? 'penalty')
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function formatPenaltyHeadline(penalty) {
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

export function formatPenaltyChip(penalty) {
  const serviceType = penalty?.serviceType;
  if (serviceType === 'driveThrough') return 'DT';
  if (serviceType === 'stopGo') return 'SG';
  if (penalty?.disqualified) return 'DSQ';
  const positionDrop = Number(penalty?.positionDrop);
  if (Number.isFinite(positionDrop) && positionDrop > 0) return `-${positionDrop}P`;
  const gridDrop = Number(penalty?.gridDrop);
  if (Number.isFinite(gridDrop) && gridDrop > 0) return `-${gridDrop}G`;
  const seconds = Number(penalty?.penaltySeconds);
  return Number.isFinite(seconds) && seconds > 0 ? `+${seconds}s` : 'Penalty';
}

export function formatStewardMessageKey(message) {
  if (!message) return '';
  return [
    message.kind,
    message.type,
    message.driverId,
    message.penaltyId,
    message.violationCount,
    message.time,
  ].join(':');
}
