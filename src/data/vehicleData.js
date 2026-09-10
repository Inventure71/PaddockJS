import { normalizeCustomFields } from './customFields.js';

import { RATING_MINIMUM, RATING_NEUTRAL, RATING_MAXIMUM, clampRating, applyRating } from './ratingScale.js';

export const VEHICLE_STAT_DEFINITIONS = {
  power: { minimum: RATING_MINIMUM, neutral: RATING_NEUTRAL, maximum: RATING_MAXIMUM, base: 43000, variance: 3200, output: 'powerNewtons' },
  braking: { minimum: RATING_MINIMUM, neutral: RATING_NEUTRAL, maximum: RATING_MAXIMUM, base: 59000, variance: 4200, output: 'brakeNewtons' },
  aero: { minimum: RATING_MINIMUM, neutral: RATING_NEUTRAL, maximum: RATING_MAXIMUM, base: 6.1, variance: 0.35, output: 'downforceCoefficient' },
  dragEfficiency: { minimum: RATING_MINIMUM, neutral: RATING_NEUTRAL, maximum: RATING_MAXIMUM, base: 0.33, variance: 0.035, direction: -1, output: 'dragCoefficient' },
  mechanicalGrip: { minimum: RATING_MINIMUM, neutral: RATING_NEUTRAL, maximum: RATING_MAXIMUM, base: 2.35, variance: 0.18, output: 'tireGrip' },
  weightControl: { minimum: RATING_MINIMUM, neutral: RATING_NEUTRAL, maximum: RATING_MAXIMUM, base: 798, variance: 10, direction: -1, output: 'mass' },
  tireCare: { minimum: RATING_MINIMUM, neutral: RATING_NEUTRAL, maximum: RATING_MAXIMUM, base: 1, variance: 0.12, output: 'tireCare' },
};

export class VehicleData {
  constructor({
    id = null,
    name = null,
    power = RATING_NEUTRAL,
    braking = RATING_NEUTRAL,
    aero = RATING_NEUTRAL,
    dragEfficiency = RATING_NEUTRAL,
    mechanicalGrip = RATING_NEUTRAL,
    weightControl = RATING_NEUTRAL,
    tireCare = RATING_NEUTRAL,
    customFields = [],
    driverModel = null,
  } = {}) {
    this.id = id;
    this.name = name;
    this.power = clampRating(power, 'power', 'vehicle');
    this.braking = clampRating(braking, 'braking', 'vehicle');
    this.aero = clampRating(aero, 'aero', 'vehicle');
    this.dragEfficiency = clampRating(dragEfficiency, 'dragEfficiency', 'vehicle');
    this.mechanicalGrip = clampRating(mechanicalGrip, 'mechanicalGrip', 'vehicle');
    this.weightControl = clampRating(weightControl, 'weightControl', 'vehicle');
    this.tireCare = clampRating(tireCare, 'tireCare', 'vehicle');
    this.customFields = normalizeCustomFields(customFields);
    this.driverModel = driverModel;
  }

  ratings() {
    return {
      power: this.power,
      braking: this.braking,
      aero: this.aero,
      dragEfficiency: this.dragEfficiency,
      mechanicalGrip: this.mechanicalGrip,
      weightControl: this.weightControl,
      tireCare: this.tireCare,
    };
  }

  toConstructorArgs() {
    const ratings = this.ratings();
    const values = Object.fromEntries(Object.entries(VEHICLE_STAT_DEFINITIONS).map(([key, definition]) => [
      definition.output,
      applyRating(definition, ratings[key], definition.direction ?? 1),
    ]));

    return {
      id: this.id,
      name: this.name,
      ratings,
      customFields: this.customFields,
      driverModel: this.driverModel,
      ...values,
    };
  }
}
