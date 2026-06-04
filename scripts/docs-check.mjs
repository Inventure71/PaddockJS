#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const markdownRoots = [
  'README.md',
  'INSTALL_AND_UPDATE.md',
  'docs',
  'examples/python/README.md',
  'local-preview/README.md',
];

const excludedMarkdownDirs = new Set([
  normalize('docs/superpowers'),
]);

const migrationFiles = new Set([
  'README.md',
  'INSTALL_AND_UPDATE.md',
  'docs/upgrading-hosts-to-3.md',
  'docs/troubleshooting.md',
]);

const internalTrackIndexFiles = new Set([
  'docs/architecture.md',
  'docs/system_specs.md',
]);

const basicExampleFiles = new Set([
  'README.md',
  'docs/getting-started.md',
]);

const requiredDocs = [
  'docs/getting-started.md',
  'docs/composable-layouts.md',
  'docs/headless-environment.md',
  'docs/data-helpers.md',
  'docs/theming.md',
  'docs/troubleshooting.md',
  'docs/upgrading-hosts-to-3.md',
];

const errors = [];

function toRepoPath(filePath) {
  return relative(repoRoot, filePath).split(sep).join('/');
}

function collectMarkdown(entry) {
  const absolute = resolve(repoRoot, entry);
  if (!existsSync(absolute)) return [];
  const repoPath = normalize(toRepoPath(absolute));
  if ([...excludedMarkdownDirs].some((dir) => repoPath === dir || repoPath.startsWith(`${dir}${sep}`))) {
    return [];
  }
  const stats = statSync(absolute);
  if (stats.isFile()) return extname(absolute) === '.md' ? [absolute] : [];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((item) => collectMarkdown(join(entry, item.name)));
}

function stripFencedCode(markdown) {
  return markdown.replace(/```[\s\S]*?```/g, '');
}

function findMarkdownLinks(markdown) {
  const links = [];
  const pattern = /!?\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match;
  while ((match = pattern.exec(markdown)) !== null) links.push(match[1]);
  return links;
}

function isExternalLink(target) {
  return /^(?:https?:|mailto:|#)/.test(target);
}

function checkMarkdownLinks(filePath, markdown) {
  const baseDir = dirname(filePath);
  for (const rawTarget of findMarkdownLinks(markdown)) {
    if (isExternalLink(rawTarget)) continue;
    const target = rawTarget.split('#')[0];
    if (!target) continue;
    const resolved = resolve(baseDir, decodeURI(target));
    if (!existsSync(resolved)) errors.push(`${toRepoPath(filePath)} links to missing target: ${rawTarget}`);
  }
}

function checkRequiredDocs() {
  for (const doc of requiredDocs) {
    if (!existsSync(resolve(repoRoot, doc))) errors.push(`Missing required consumer doc: ${doc}`);
  }
  for (const doc of ['README.md', 'docs/index.md']) {
    const text = readFileSync(resolve(repoRoot, doc), 'utf8');
    if (!/snippets .*illustrative host integration fragments/i.test(text)) {
      errors.push(`${doc} must mark documentation snippets as illustrative unless explicitly complete.`);
    }
  }
}

function checkWrongImports(filePath, markdown) {
  const repoPath = toRepoPath(filePath);
  const importPattern = /import\s*{([^}]*)}\s*from\s*['"](@inventure71\/paddockjs)['"]/g;
  const environmentExports = [
    'createPaddockEnvironment',
    'createPaddockDriverControllerLoop',
    'createRolloutRecorder',
    'runEnvironmentEvaluation',
  ];
  const dataExports = [
    'DriverData',
    'VehicleData',
    'createProceduralTrack',
    'formatDriverNumber',
    'normalizeSimulatorDrivers',
  ];
  let match;
  while ((match = importPattern.exec(markdown)) !== null) {
    const members = match[1];
    const line = markdown.slice(0, match.index).split('\n').length;
    const hasMount = /mountF1Simulator|createPaddockSimulator/.test(members);
    if (environmentExports.some((name) => new RegExp(`\\b${name}\\b`).test(members))) {
      errors.push(`${repoPath}:${line} imports headless environment APIs from the browser root package.`);
    }
    if (!hasMount && dataExports.some((name) => new RegExp(`\\b${name}\\b`).test(members))) {
      errors.push(`${repoPath}:${line} imports CSS-free data helpers from the browser root package.`);
    }
  }
}

function checkForbiddenGuidance(filePath, markdown) {
  const repoPath = toRepoPath(filePath);
  const text = stripFencedCode(markdown);
  if (/next-release-host-ergonomics\.md/.test(text)) {
    errors.push(`${repoPath} references deleted next-release-host-ergonomics.md.`);
  }
  if (/fonts\.googleapis\.com|imports package fonts|loads package fonts|loads remote fonts/i.test(text)) {
    errors.push(`${repoPath} claims or references package-loaded remote fonts.`);
  }
  if (/trackQueryIndex/.test(text) && !migrationFiles.has(repoPath) && !internalTrackIndexFiles.has(repoPath)) {
    errors.push(`${repoPath} mentions trackQueryIndex outside migration or internal architecture/spec docs.`);
  }
  if (/physicsMode:\s*['"]simulator['"]/.test(text) && !migrationFiles.has(repoPath)) {
    errors.push(`${repoPath} mentions removed physicsMode: 'simulator' outside migration/troubleshooting docs.`);
  }
  if (basicExampleFiles.has(repoPath) && /\bexpert\s*:/.test(markdown)) {
    errors.push(`${repoPath} enables expert mode in a basic consumer example.`);
  }
}

const markdownFiles = [...new Set(markdownRoots.flatMap(collectMarkdown))].sort();

checkRequiredDocs();

for (const filePath of markdownFiles) {
  const markdown = readFileSync(filePath, 'utf8');
  checkMarkdownLinks(filePath, markdown);
  checkWrongImports(filePath, markdown);
  checkForbiddenGuidance(filePath, markdown);
}

if (errors.length > 0) {
  console.error('[docs-check] failed');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`[docs-check] checked ${markdownFiles.length} markdown files`);
