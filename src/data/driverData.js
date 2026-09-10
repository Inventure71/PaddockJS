import { normalizeCustomFields } from './customFields.js';

import { RATING_MINIMUM, RATING_NEUTRAL, RATING_MAXIMUM, clampRating, applyRating } from './ratingScale.js';

export const DRIVER_STAT_DEFINITIONS = {
  pace: { minimum: RATING_MINIMUM, neutral: RATING_NEUTRAL, maximum: RATING_MAXIMUM, base: 1, variance: 0.08 },
  racecraft: { minimum: RATING_MINIMUM, neutral: RATING_NEUTRAL, maximum: RATING_MAXIMUM, base: 0.78, variance: 0.16 },
  aggression: { minimum: RATING_MINIMUM, neutral: RATING_NEUTRAL, maximum: RATING_MAXIMUM, base: 0.5, variance: 0.34 },
  riskTolerance: { minimum: RATING_MINIMUM, neutral: RATING_NEUTRAL, maximum: RATING_MAXIMUM, base: 0.5, variance: 0.28 },
  patience: { minimum: RATING_MINIMUM, neutral: RATING_NEUTRAL, maximum: RATING_MAXIMUM, base: 0.5, variance: 0.28 },
  consistency: { minimum: RATING_MINIMUM, neutral: RATING_NEUTRAL, maximum: RATING_MAXIMUM, base: 0.75, variance: 0.16 },
};

export class DriverData {
  constructor({
    pace = RATING_NEUTRAL,
    racecraft = RATING_NEUTRAL,
    aggression = RATING_NEUTRAL,
    riskTolerance = RATING_NEUTRAL,
    patience = RATING_NEUTRAL,
    consistency = RATING_NEUTRAL,
    customFields = [],
    driverModel = null,
  } = {}) {
    this.pace = clampRating(pace, 'pace', 'driver');
    this.racecraft = clampRating(racecraft, 'racecraft', 'driver');
    this.aggression = clampRating(aggression, 'aggression', 'driver');
    this.riskTolerance = clampRating(riskTolerance, 'riskTolerance', 'driver');
    this.patience = clampRating(patience, 'patience', 'driver');
    this.consistency = clampRating(consistency, 'consistency', 'driver');
    this.customFields = normalizeCustomFields(customFields);
    this.driverModel = driverModel;
  }

  ratings() {
    return {
      pace: this.pace,
      racecraft: this.racecraft,
      aggression: this.aggression,
      riskTolerance: this.riskTolerance,
      patience: this.patience,
      consistency: this.consistency,
    };
  }

  toConstructorArgs() {
    return {
      ratings: this.ratings(),
      customFields: this.customFields,
      driverModel: this.driverModel,
      pace: applyRating(DRIVER_STAT_DEFINITIONS.pace, this.pace),
      racecraft: applyRating(DRIVER_STAT_DEFINITIONS.racecraft, this.racecraft),
      consistency: applyRating(DRIVER_STAT_DEFINITIONS.consistency, this.consistency),
      personality: {
        aggression: applyRating(DRIVER_STAT_DEFINITIONS.aggression, this.aggression),
        riskTolerance: applyRating(DRIVER_STAT_DEFINITIONS.riskTolerance, this.riskTolerance),
        patience: applyRating(DRIVER_STAT_DEFINITIONS.patience, this.patience),
      },
    };
  }
}
