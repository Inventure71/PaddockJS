import ts from 'typescript';
import { fileURLToPath } from 'node:url';

/** Resolve declarations semantically: aliases and re-exports are real API too. */
export function publicApiNames(
  repoRoot,
  roots = [
    'src/index.d.ts',
    'src/environment/index.d.ts',
    'src/data/index.d.ts',
    'src/placeholder/index.d.ts',
  ],
) {
  const program = ts.createProgram(
    roots.map((path) => fileURLToPath(new URL(path, repoRoot))),
    {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      skipLibCheck: true,
    },
  );
  const checker = program.getTypeChecker();
  const names = new Set();
  const interfaces = new Map([
    ['F1MountedSimulator', ''],
    ['PaddockSimulatorController', ''],
    ['F1SimulatorExpertApi', 'expert.'],
    ['PaddockEnvironment', 'environment.'],
  ]);
  for (const path of roots) {
    const source = program.getSourceFile(fileURLToPath(new URL(path, repoRoot)));
    if (!source) throw new Error(`Missing public declaration ${path}`);
    const module = checker.getSymbolAtLocation(source);
    for (const exported of checker.getExportsOfModule(module)) {
      const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      const typeOnly = exported.declarations?.some(
        (declaration) =>
          ts.isExportSpecifier(declaration) &&
          (declaration.isTypeOnly || declaration.parent.parent.isTypeOnly),
      );
      if (!typeOnly && symbol.flags & ts.SymbolFlags.Value) names.add(exported.name);
      if (!interfaces.has(exported.name)) continue;
      const prefix = interfaces.get(exported.name);
      const type = checker.getDeclaredTypeOfSymbol(symbol);
      for (const property of type.getProperties()) {
        const declaration = property.valueDeclaration ?? property.declarations?.[0];
        if (!declaration) continue;
        if (checker.getTypeOfSymbolAtLocation(property, declaration).getCallSignatures().length) {
          names.add(`${prefix}${property.name}`);
        }
      }
    }
  }
  return names;
}

export function markdownHeadingIds(markdown) {
  const ids = new Set(),
    seen = new Map();
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*$/)?.[1];
    if (!heading) continue;
    const slug = heading
      .toLowerCase()
      .replace(/<[^>]*>/g, '')
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s/g, '-');
    const count = seen.get(slug) ?? 0;
    seen.set(slug, count + 1);
    ids.add(`${slug}${count ? `-${count}` : ''}`);
  }
  return ids;
}

/** Validate destinations, not just API words that happen to occur in a list. */
export async function validateFeatureCatalog({
  features,
  chapters,
  expectedApis,
  routes,
  references,
  readSource,
}) {
  const ids = new Set(),
    covered = new Set(),
    chapterIds = new Set(chapters.map(({ id }) => id));
  const paths = new Set(routes.map(({ path }) => path));
  paths.add('/');
  const documents = new Map(references.map((document) => [document.path, document]));
  const modes = new Set(['live', 'interactive', 'headless', 'reference']);
  const sourceCache = new Map();
  for (const feature of features) {
    if (ids.has(feature.id)) throw new Error(`Duplicate feature id: ${feature.id}`);
    ids.add(feature.id);
    if (!chapterIds.has(feature.chapter))
      throw new Error(`Unknown chapter for ${feature.id}: ${feature.chapter}`);
    if (!modes.has(feature.mode))
      throw new Error(`Unknown demonstration mode for ${feature.id}: ${feature.mode}`);
    feature.apis.forEach((name) => covered.add(name));
    const target = new URL(feature.href, 'https://paddock.invalid/');
    if (target.origin !== 'https://paddock.invalid')
      throw new Error(`${feature.id}: examples must resolve inside the canonical site`);
    if (target.hash === '#features')
      throw new Error(
        `${feature.id}: inventory links must lead to an example or reference, not the inventory itself`,
      );
    const document = documents.get(target.pathname);
    if (feature.mode === 'reference' && !document)
      throw new Error(`${feature.id}: reference entries need a reference document`);
    if (feature.mode !== 'reference' && document)
      throw new Error(`${feature.id}: a reference document is not an executable demonstration`);
    if (!document && !paths.has(target.pathname))
      throw new Error(`${feature.id}: unknown route ${target.pathname}`);
    const sourcePath =
      document?.source ??
      `site/${target.pathname.slice(1)}${target.pathname.endsWith('/') ? 'index.html' : ''}`;
    let source = sourceCache.get(sourcePath);
    if (source === undefined) {
      source = await readSource(sourcePath);
      sourceCache.set(sourcePath, source);
    }
    if (target.hash) {
      const id = decodeURIComponent(target.hash.slice(1));
      const anchors = document
        ? markdownHeadingIds(source)
        : new Set([...source.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]));
      if (!anchors.has(id)) throw new Error(`${feature.id}: missing destination #${id} in ${sourcePath}`);
    }
  }
  const missing = [...expectedApis].filter((name) => !covered.has(name));
  if (missing.length) throw new Error(`Public APIs missing from feature catalog: ${missing.join(', ')}`);
  return { features: ids.size, apis: expectedApis.size, chapters: chapterIds.size };
}
