import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { test } from 'node:test';
import { generateReference } from './generateReference.mjs';

test('unchanged documentation builds preserve files so the dev server does not reload every page', () => {
  const files = generateReference();
  const before = files.map((file) => statSync(file, { bigint: true }).mtimeNs);
  assert.deepEqual(generateReference(), files);
  assert.deepEqual(files.map((file) => statSync(file, { bigint: true }).mtimeNs), before);
});
