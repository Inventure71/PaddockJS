import { test } from 'vitest';

export const includeSlowTests = process.env.PADDOCKJS_INCLUDE_SLOW_TESTS === '1';
export const slowTest = includeSlowTests ? test : test.skip;
