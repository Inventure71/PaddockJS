import { describe, expect, test, vi } from 'vitest';
import { createThrottledJsonReadout } from '../../local-preview/src/debugJsonReadout.js';

describe('debug JSON readouts', () => {
  test('throttles repeated live JSON stringification unless forced', () => {
    let now = 0;
    const stringify = vi.fn((value) => JSON.stringify(value));
    const readout = createThrottledJsonReadout({
      intervalMs: 500,
      now: () => now,
      stringify,
    });
    const element = { textContent: '' };

    expect(readout.due()).toBe(true);
    expect(readout.update(element, { step: 1 })).toBe(true);
    expect(readout.due()).toBe(false);
    expect(readout.update(element, { step: 2 })).toBe(false);
    now = 499;
    expect(readout.update(element, { step: 3 })).toBe(false);
    now = 500;
    expect(readout.update(element, { step: 4 })).toBe(true);
    expect(readout.update(element, { step: 5 }, { force: true })).toBe(true);

    expect(stringify).toHaveBeenCalledTimes(3);
    expect(element.textContent).toBe('{"step":5}');
  });
});
