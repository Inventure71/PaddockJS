import { readFile } from 'node:fs/promises';
import { FEATURE_CATALOG, FEATURE_CHAPTERS, featureApiSet } from '../src/data/featureCatalog.js';

const repoRoot = new URL('../../', import.meta.url);
const apiSet = featureApiSet();

function exportedSymbols(source) {
  const names = new Set();
  for (const match of source.matchAll(/export\s+(?:declare\s+)?(?:function|class|const)\s+([A-Za-z0-9_]+)/g)) {
    names.add(match[1]);
  }
  return names;
}

function interfaceMethods(source, interfaceName) {
  const block = source.match(new RegExp(`export interface ${interfaceName} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';
  return new Set([...block.matchAll(/^\s{2}([A-Za-z0-9_]+)\??\(/gm)].map((match) => match[1]));
}

function assertComplete(label, expected) {
  const missing = [...expected].filter((name) => !apiSet.has(name));
  if (missing.length) throw new Error(`${label} missing from feature catalog: ${missing.join(', ')}`);
}

const [rootTypes, environmentTypes, dataTypes, placeholderTypes] = await Promise.all([
  readFile(new URL('src/index.d.ts', repoRoot), 'utf8'),
  readFile(new URL('src/environment/index.d.ts', repoRoot), 'utf8'),
  readFile(new URL('src/data/index.d.ts', repoRoot), 'utf8'),
  readFile(new URL('src/placeholder/index.d.ts', repoRoot), 'utf8'),
]);

const ids = FEATURE_CATALOG.map((feature) => feature.id);
if (new Set(ids).size !== ids.length) throw new Error('Feature catalog ids must be unique.');

const chapterIds = new Set(FEATURE_CHAPTERS.map((chapter) => chapter.id));
const unknownChapters = FEATURE_CATALOG.filter((feature) => !chapterIds.has(feature.chapter));
if (unknownChapters.length) throw new Error(`Unknown feature chapters: ${unknownChapters.map((item) => item.id).join(', ')}`);

const modes = new Set(FEATURE_CATALOG.map((feature) => feature.mode));
for (const mode of ['live', 'interactive', 'headless', 'code']) {
  if (!modes.has(mode)) throw new Error(`Feature catalog has no ${mode} coverage.`);
}

assertComplete('Root public functions/classes/constants', exportedSymbols(rootTypes));
assertComplete('Mounted controller methods', interfaceMethods(rootTypes, 'F1MountedSimulator'));
assertComplete('Composable controller methods', interfaceMethods(rootTypes, 'PaddockSimulatorController'));
assertComplete('Environment exports', exportedSymbols(environmentTypes));
assertComplete('Data exports', exportedSymbols(dataTypes));
assertComplete('Placeholder exports', exportedSymbols(placeholderTypes));

if (FEATURE_CATALOG.length < 50) throw new Error(`Expected at least 50 feature records, found ${FEATURE_CATALOG.length}.`);

console.log(`[demo-coverage] ${FEATURE_CATALOG.length} feature records cover ${apiSet.size} public API symbols across ${FEATURE_CHAPTERS.length} chapters.`);
