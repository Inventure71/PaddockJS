import { readFile } from 'node:fs/promises';
import { FEATURE_CATALOG, FEATURE_CHAPTERS } from '../src/demo/data/featureCatalog.js';
import { SITE_ROUTES, REFERENCE_DOCUMENTS } from '../src/shared/routes.js';
import { publicApiNames, validateFeatureCatalog } from './featureCoverage.mjs';

const repoRoot = new URL('../../', import.meta.url);
const result = await validateFeatureCatalog({
  features: FEATURE_CATALOG,
  chapters: FEATURE_CHAPTERS,
  expectedApis: publicApiNames(repoRoot),
  routes: SITE_ROUTES,
  references: REFERENCE_DOCUMENTS,
  readSource: (path) => readFile(new URL(path, repoRoot), 'utf8'),
});
console.log(
  `[site-coverage] ${result.features} feature destinations verified; ${result.apis} public APIs classified across ${result.chapters} chapters.`,
);
