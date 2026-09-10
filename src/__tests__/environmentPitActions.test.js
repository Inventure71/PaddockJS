import { describe, expect, test } from 'vitest';
import { resolveActionMap } from '../environment/actions.js';

const controls = { steering: 0, throttle: 0.5, brake: 0 };

describe('environment pit action boundary', () => {
  test.each([
    [0, 0], [1, 1], [2, 2], ['2', 2], [' 1 ', 1], ['', 0], [null, 0], [false, 0], [true, 1],
  ])('preserves accepted pit intent coercion for %j', (input, expected) => {
    const result = resolveActionMap({ driver: { ...controls, pitIntent: input } }, ['driver']);
    expect(result).toEqual({
      controlsByDriver: { driver: controls },
      pitIntentByDriver: { driver: expected },
      errors: [],
    });
  });

  test.each([undefined, -1, 3, 1.5, NaN, Infinity, 'invalid'])('preserves strict/report behavior for %j', (input) => {
    const actions = { driver: { ...controls, pitIntent: input } };
    const message = 'Invalid pitIntent action for controlled driver: driver';
    expect(() => resolveActionMap(actions, ['driver'])).toThrow(message);
    expect(resolveActionMap(actions, ['driver'], { policy: 'report' })).toEqual({
      controlsByDriver: { driver: controls },
      pitIntentByDriver: {},
      errors: [message],
    });
  });

  test('omitted intent does not request a stop or validate an unrelated compound', () => {
    const result = resolveActionMap({ driver: { ...controls, pitCompound: false } }, ['driver']);
    expect(result.pitIntentByDriver).toEqual({});
    expect(result.errors).toEqual([]);
  });

  test.each(['pitCompound', 'pitTargetCompound'])('preserves zero intent and trims %s', (field) => {
    const result = resolveActionMap({ driver: { ...controls, pitIntent: 0, [field]: ' H ' } }, ['driver']);
    expect(result.pitIntentByDriver).toEqual({ driver: { intent: 0, targetCompound: 'H' } });
    expect(result.errors).toEqual([]);
  });

  test('reports invalid compound without dropping valid vehicle controls', () => {
    const actions = { driver: { ...controls, pitIntent: 2, pitCompound: ' ' } };
    const message = 'Invalid pitCompound action for controlled driver: driver';
    expect(() => resolveActionMap(actions, ['driver'])).toThrow(message);
    expect(resolveActionMap(actions, ['driver'], { policy: 'report' })).toEqual({
      controlsByDriver: { driver: controls },
      pitIntentByDriver: {},
      errors: [message],
    });
  });

  test('invalid intent takes precedence over invalid compound', () => {
    const actions = { driver: { ...controls, pitIntent: 3, pitCompound: false } };
    expect(resolveActionMap(actions, ['driver'], { policy: 'report' }).errors)
      .toEqual(['Invalid pitIntent action for controlled driver: driver']);
  });
});
