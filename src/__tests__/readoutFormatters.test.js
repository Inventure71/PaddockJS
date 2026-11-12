import { describe, expect, test } from 'vitest';
import { formatTelemetryTime } from '../app/readouts/readoutFormatters.js';

describe('telemetry time formatting', () => {
  test.each([
    [59.9994, '59.999s'],
    [59.9999, '1:00.000'],
    [60, '1:00.000'],
    [119.9994, '1:59.999'],
    [119.9999, '2:00.000'],
    [120, '2:00.000'],
    [120.001, '2:00.001'],
    [-1, '0.000s'],
    [NaN, '--'],
    [Infinity, '--'],
  ])('formats %s seconds as %s', (value, expected) => {
    expect(formatTelemetryTime(value)).toBe(expected);
  });
});
