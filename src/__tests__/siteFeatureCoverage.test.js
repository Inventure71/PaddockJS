import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { publicApiNames, validateFeatureCatalog } from '../../site/scripts/featureCoverage.mjs';

const chapters = [{ id: 'broadcast' }];
const record = (overrides = {}) => ({ id: 'grid-walk', chapter: 'broadcast', mode: 'interactive', href: '#race', apis: ['setView'], ...overrides });
const options = (features) => ({
  features, chapters, expectedApis: new Set(['setView']),
  routes: [{ path: '/' }], references: [{ path: '/reference/start.html', source: 'docs/start.md' }],
  readSource: async (path) => path.endsWith('.md') ? '# Start\n\n## Grid Walk\n\nUse `setView`.' : '<section id="race"></section>',
});

test('catalog verifies runnable destinations and precise Markdown reference fragments', async () => {
  const result = await validateFeatureCatalog(options([
    record(), record({ id: 'reference', mode: 'reference', href: '/reference/start.html#grid-walk', apis: [] }),
  ]));
  expect(result).toEqual({ features: 2, apis: 1, chapters: 1 });
});

test.each([
  [{ href: '#features' }, 'inventory itself'],
  [{ href: '#missing' }, 'missing destination'],
  [{ href: '/grid-walk.html' }, 'unknown route'],
  [{ mode: 'reference' }, 'need a reference document'],
  [{ href: '/reference/start.html#grid-walk' }, 'not an executable demonstration'],
  [{ apis: [] }, 'Public APIs missing'],
])('catalog rejects misleading or unreachable coverage: %j', async (overrides, message) => {
  await expect(validateFeatureCatalog(options([record(overrides)]))).rejects.toThrow(message);
});

test('public coverage resolves named and star re-exports without treating type-only exports as runtime API', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'paddock-feature-exports-'));
  try {
    await writeFile(join(directory, 'values.d.ts'), 'export declare function makeGrid(): void;\nexport interface GridData { id: string; }\nexport declare const preset: string;\nexport declare class RuntimeClass {}');
    await writeFile(join(directory, 'entry.d.ts'), "export { makeGrid as createGrid } from './values.js';\nexport * from './values.js';\nexport type { GridData, RuntimeClass as OnlyTypeClass } from './values.js';");
    const names = publicApiNames(pathToFileURL(`${directory}/`), ['entry.d.ts']);
    expect([...names].sort()).toEqual(['RuntimeClass', 'createGrid', 'makeGrid', 'preset']);
  } finally { await rm(directory, { recursive: true }); }
});
