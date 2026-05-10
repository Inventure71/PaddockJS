import { DRIVER_STAT_DEFINITIONS, formatDriverNumber, VEHICLE_STAT_DEFINITIONS } from '../../data/championship.js';
import { normalizeCustomFields } from '../../data/customFields.js';
import { setText } from '../domBindings.js';

const VEHICLE_OVERVIEW_FIELDS = [
  ['power', 'Power'],
  ['braking', 'Braking'],
  ['aero', 'Aero'],
  ['dragEfficiency', 'Drag'],
  ['mechanicalGrip', 'Grip'],
  ['weightControl', 'Weight'],
];
const DRIVER_OVERVIEW_FIELDS = [
  ['pace', 'Pace'],
  ['racecraft', 'Racecraft'],
  ['aggression', 'Aggression'],
  ['riskTolerance', 'Risk'],
  ['patience', 'Patience'],
  ['consistency', 'Consistency'],
];

export function getOverviewFields(driver, mode) {
  if (mode === 'driver') {
    const ratings = driver?.constructorArgs?.driver?.ratings ?? {};
    return [
      ...DRIVER_OVERVIEW_FIELDS.map(([key, label]) => ({
        key,
        label,
        value: ratings[key] ?? DRIVER_STAT_DEFINITIONS[key]?.neutral,
      })),
      ...normalizeCustomFields([
        ...(driver?.constructorArgs?.driver?.customFields ?? []),
        ...(driver?.customFields ?? []),
      ]),
    ];
  }

  const ratings = driver?.constructorArgs?.vehicle?.ratings ?? driver?.vehicle?.ratings ?? {};
  return [
    ...VEHICLE_OVERVIEW_FIELDS.map(([key, label]) => ({
      key,
      label,
      value: ratings[key] ?? VEHICLE_STAT_DEFINITIONS[key]?.neutral,
    })),
    ...normalizeCustomFields(driver?.vehicle?.customFields ?? driver?.constructorArgs?.vehicle?.customFields ?? []),
  ];
}

export function renderCarDriverOverview({
  readouts,
  car,
  driverById,
  assets,
  overviewMode,
  lastOverviewRenderKey,
}) {
  if (!car || !readouts.carOverview) return lastOverviewRenderKey;
  const driver = driverById.get(car.id);
  const icon = car.icon ?? driver?.icon ?? car.code;
  const driverNumber = formatDriverNumber(car.driverNumber ?? driver?.driverNumber);
  const mode = overviewMode === 'driver' ? 'driver' : 'vehicle';
  const fields = getOverviewFields(driver, mode);
  const displayFields = fields.length > 0
    ? fields
    : [{ label: mode === 'driver' ? 'Driver fields' : 'Car fields', value: 'No custom fields' }];
  const imageSrc = mode === 'driver'
    ? (driver?.driverImage ?? driver?.portrait ?? driver?.avatar ?? assets.driverHelmet)
    : assets.carOverview;
  const overviewCode = mode === 'driver'
    ? `${car.code} driver`
    : `${driver?.vehicle?.name ?? car.vehicleName ?? car.code}`;
  const overviewKey = JSON.stringify({
    id: car.id,
    mode,
    color: car.color,
    code: car.code,
    icon,
    driverNumber,
    imageSrc,
    overviewCode,
    fields: displayFields.map((field) => [field.label, field.value]),
  });
  if (overviewKey === lastOverviewRenderKey) return lastOverviewRenderKey;

  readouts.carOverview?.style.setProperty('--driver-color', car.color);
  readouts.carOverviewDiagram?.style.setProperty('--driver-color', car.color);
  if (readouts.carOverviewTitle) {
    readouts.carOverviewTitle.textContent = mode === 'driver' ? 'Driver overview' : 'Car overview';
  }
  if (readouts.carOverviewCode) {
    readouts.carOverviewCode.textContent = overviewCode;
  }
  if (readouts.carOverviewIcon) readouts.carOverviewIcon.textContent = icon;
  if (readouts.carOverviewImage) {
    readouts.carOverviewImage.src = imageSrc;
  }
  if (readouts.carOverviewNumber) readouts.carOverviewNumber.textContent = driverNumber;
  if (readouts.carOverviewCoreStat) readouts.carOverviewCoreStat.textContent = mode === 'driver' ? 'Driver' : 'Car';
  readouts.carOverviewFields.forEach((fieldNode, index) => {
    const field = displayFields[index];
    fieldNode.hidden = !field;
    if (!field) return;
    const labelNode = fieldNode.querySelector('[data-overview-field-label]');
    const valueNode = fieldNode.querySelector('[data-overview-field-value]');
    setText(labelNode, field.label);
    setText(valueNode, field.value);
  });
  return overviewKey;
}
