import { mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REFERENCE_DOCUMENTS, siteUrl } from '../src/shared/routes.js';
import { renderReference, escapeHtml, siteRoot, assertReferenceSources } from './referenceContent.mjs';
const MARKER = '<!-- Generated from package Markdown; edit its source document. -->';
const page = (title, body) =>
  `${MARKER}\n<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · PaddockJS</title></head><body data-site-section="reference"><!-- site-header -->${body}</body></html>\n`;

function writePage(filename, content) {
  // Rebuilding unchanged docs must not trigger reloads in an active dev server.
  if (!existsSync(filename) || readFileSync(filename, 'utf8') !== content) writeFileSync(filename, content);
}

export function generateReference({ base = '/' } = {}) {
  assertReferenceSources();
  const directory = resolve(siteRoot, 'reference');
  mkdirSync(directory, { recursive: true });
  const owned = new Set(['index.html']);
  for (const doc of REFERENCE_DOCUMENTS) {
    const rendered = renderReference(doc.source, { base });
    const toc = rendered.headings
      .filter((heading) => heading.level === 2 || heading.level === 3)
      .map(
        (heading) =>
          `<a data-level="${heading.level}" href="#${heading.id}">${escapeHtml(heading.title)}</a>`,
      )
      .join('');
    const body = `<main class="reference-page" id="main"><nav class="reference-toc" aria-label="On this page"><a href="${siteUrl('/reference/', base)}">← All reference documents</a>${toc}</nav><article class="reference-copy"><p class="reference-source">Package reference · ${escapeHtml(doc.source)}</p>${rendered.html}</article></main>`;
    const name = doc.path.split('/').at(-1);
    owned.add(name);
    writePage(resolve(directory, name), page(doc.title, body));
  }
  const groups = ['Start and integrate', 'API and behavior', 'Environment and models', 'Contributor notes'];
  if (REFERENCE_DOCUMENTS.some((doc) => !groups.includes(doc.group)))
    throw new Error('Unclassified reference document group');
  const listing = groups
    .map(
      (group) =>
        `<section data-reference-group><h2>${escapeHtml(group)}</h2><ul>${REFERENCE_DOCUMENTS.filter(
          (doc) => doc.group === group,
        )
          .map(
            (doc) =>
              `<li data-reference-document><a href="${siteUrl(doc.path, base)}">${escapeHtml(doc.title)}</a></li>`,
          )
          .join('')}</ul></section>`,
    )
    .join('');
  writePage(
    resolve(directory, 'index.html'),
    page(
      'Reference',
      `<main class="site-index" id="main"><p class="site-index__eyebrow">Package documentation</p><h1>Reference</h1><p>These pages render the package’s source documentation. Start with integration guides, then use the API contracts and contributor notes when you need detail.</p><label for="reference-search">Find a document</label><input type="search" id="reference-search" data-reference-search placeholder="Search documentation"><p role="status" data-reference-results>${REFERENCE_DOCUMENTS.length} documents</p><div class="reference-groups">${listing}</div></main>`,
    ),
  );
  for (const name of readdirSync(directory)) {
    if (
      name.endsWith('.html') &&
      !owned.has(name) &&
      readFileSync(resolve(directory, name), 'utf8').startsWith(MARKER)
    )
      unlinkSync(resolve(directory, name));
  }
  return [...owned].map((name) => resolve(directory, name));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) generateReference();
