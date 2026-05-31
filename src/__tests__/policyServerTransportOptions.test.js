import { describe, expect, test } from 'vitest';
import { compactPolicyServerRuntimeOptions } from '../../local-preview/src/policyRunner/transportOptions.js';

describe('policy server transport options', () => {
  test('forces compact vector transport only for policy-server mode', () => {
    const base = {
      observation: { output: 'full', includeSchema: true, lookaheadMeters: [20] },
      result: { stateOutput: 'full', resetDriversObservationScope: 'reset' },
    };

    expect(compactPolicyServerRuntimeOptions('distilled-policy', base)).toBe(base);
    expect(compactPolicyServerRuntimeOptions('policy-server', base)).toEqual({
      observation: {
        output: 'vector',
        includeSchema: false,
        vectorType: 'array',
        lookaheadMeters: [20],
      },
      result: {
        stateOutput: 'none',
        resetDriversObservationScope: 'reset',
      },
    });
  });
});
