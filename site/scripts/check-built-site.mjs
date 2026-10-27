import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, extname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';
import { SITE_ROUTES, REFERENCE_DOCUMENTS, siteUrl } from '../src/shared/routes.js';
import { FEATURE_CATALOG } from '../src/demo/data/featureCatalog.js';

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(siteRoot, 'dist');
const base = process.env.PADDOCK_SITE_BASE ?? '/';
const home = new URL(siteUrl('/', base), 'https://paddock.invalid');
const basePath = home.pathname;
const decodeEntities = new MarkdownIt().utils.unescapeAll;
const documents = new Map();
const errors = [];

// Built HTML is controlled output. Tokenize real tags while excluding comments
// and raw script/style bodies, so code examples never masquerade as page DOM.
function inspectHtml(file) {
  if (documents.has(file)) return documents.get(file);
  const html = readFileSync(file, 'utf8');
  const result = { ids: new Set(), links: [], headers: 0, mains: 0, headings: 0 };
  const markup = html.replace(
    /<(script|style)\b((?:[^>"']|"[^"]*"|'[^']*')*)>[\s\S]*?<\/\1\s*>/gi,
    (_, tag, attributes) => `<${tag}${attributes}>`,
  );
  const tags = /<!--[\s\S]*?-->|<([a-z][\w:-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
  for (const match of markup.matchAll(tags)) {
    if (!match[1]) continue;
    const tag = match[1].toLowerCase();
    const attributes = new Map();
    for (const attribute of match[2].matchAll(
      /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g,
    )) {
      attributes.set(
        attribute[1].toLowerCase(),
        decodeEntities(attribute[2] ?? attribute[3] ?? attribute[4] ?? ''),
      );
    }
    const id = attributes.get('id');
    if (id !== undefined) {
      if (result.ids.has(id)) errors.push(`${relative(dist, file)}: duplicate id #${id}`);
      result.ids.add(id);
    }
    if (tag === 'header' && attributes.has('data-site-header')) result.headers += 1;
    if (tag === 'main') result.mains += 1;
    if (tag === 'h1') result.headings += 1;
    if (attributes.has('href')) result.links.push(attributes.get('href'));
  }
  documents.set(file, result);
  return result;
}

function builtFile(url, owner) {
  if (url.origin !== home.origin) return null;
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    errors.push(`${owner}: malformed internal URL ${url.href}`);
    return null;
  }
  const rootPath = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  if (pathname === rootPath) pathname = `${pathname}/`;
  if (!pathname.startsWith(basePath)) {
    errors.push(`${owner}: internal URL escapes website base ${basePath}: ${url.pathname}`);
    return null;
  }
  let file = resolve(dist, pathname.slice(basePath.length));
  if (file !== dist && !file.startsWith(`${dist}${sep}`)) {
    errors.push(`${owner}: internal URL escapes build directory: ${url.pathname}`);
    return null;
  }
  if (pathname.endsWith('/') || (existsSync(file) && statSync(file).isDirectory()))
    file = resolve(file, 'index.html');
  if (!existsSync(file) || !statSync(file).isFile()) {
    errors.push(`${owner}: missing internal target ${url.pathname}`);
    return null;
  }
  return file;
}

function checkDestination(href, from, owner) {
  let url;
  try {
    url = new URL(href, from);
  } catch {
    errors.push(`${owner}: invalid href ${href}`);
    return;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== home.origin) return;
  const file = builtFile(url, owner);
  if (!file || !url.hash || extname(file) !== '.html') return;
  let fragment;
  try {
    fragment = decodeURIComponent(url.hash.slice(1));
  } catch {
    errors.push(`${owner}: malformed fragment ${href}`);
    return;
  }
  if (fragment && !inspectHtml(file).ids.has(fragment))
    errors.push(`${owner}: missing fragment ${url.pathname}#${fragment}`);
}

const canonical = [...SITE_ROUTES, ...REFERENCE_DOCUMENTS];
const visited = new Map();
for (const route of canonical) {
  const url = new URL(siteUrl(route.path, base), home);
  const file = builtFile(url, route.path);
  if (!file) continue;
  if (visited.has(file)) {
    errors.push(`${route.path}: canonical output collides with ${visited.get(file)}`);
    continue;
  }
  visited.set(file, route.path);
  const page = inspectHtml(file);
  for (const [label, actual] of [
    ['shared header', page.headers],
    ['main', page.mains],
    ['h1', page.headings],
  ]) {
    if (actual !== 1) errors.push(`${route.path}: expected one ${label}, found ${actual}`);
  }
  for (const href of page.links) checkDestination(href, url, route.path);
}
for (const feature of FEATURE_CATALOG) {
  checkDestination(siteUrl(feature.href, base), home, `feature ${feature.id}`);
}

if (errors.length) {
  console.error('[site-built-check] failed');
  for (const error of [...new Set(errors)]) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    `[site-built-check] ${visited.size} canonical pages, ${FEATURE_CATALOG.length} feature destinations and internal links/fragments verified.`,
  );
}
