import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import MarkdownIt from 'markdown-it';
import { REFERENCE_DOCUMENTS, SITE_ROUTES, siteUrl } from '../src/shared/routes.js';

export const repoRoot = resolve(import.meta.dirname, '../..');
export const siteRoot = resolve(repoRoot, 'site');
export const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );

export function headingSlug(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^\p{L}\p{N}_\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

export function renderReference(source, { base = '/', embedded = false } = {}) {
  const absolute = resolve(repoRoot, source);
  const markdown = readFileSync(absolute, 'utf8');
  const parser = new MarkdownIt({ html: false, linkify: false });
  const headings = [],
    used = new Map();
  parser.renderer.rules.heading_open = (tokens, index, options, environment, renderer) => {
    const inline = tokens[index + 1];
    const title =
      inline?.children
        ?.map((token) => (token.type.endsWith('_open') || token.type.endsWith('_close') ? '' : token.content))
        .join('') ??
      inline?.content ??
      '';
    const slug = headingSlug(title),
      count = used.get(slug) ?? 0;
    used.set(slug, count + 1);
    const id = count ? `${slug}-${count}` : slug;
    const level = Number(tokens[index].tag.slice(1));
    headings.push({ id, title, level });
    tokens[index].attrSet('id', id);
    if (embedded) {
      tokens[index].tag = `h${Math.min(6, level + 1)}`;
      tokens[index + 2].tag = tokens[index].tag;
    }
    return renderer.renderToken(tokens, index, options);
  };
  const originalLink = parser.renderer.rules.link_open;
  parser.renderer.rules.link_open = (tokens, index, options, environment, renderer) => {
    const href = tokens[index].attrGet('href');
    if (href && !/^(?:[a-z]+:|\/\/|#)/i.test(href)) {
      const [path, hash] = href.split('#');
      const target = relative(repoRoot, resolve(dirname(absolute), decodeURI(path))).replaceAll('\\', '/');
      const doc = REFERENCE_DOCUMENTS.find((entry) => entry.source === target);
      if (doc) tokens[index].attrSet('href', siteUrl(doc.path, base) + (hash ? `#${hash}` : ''));
      else
        tokens[index].attrSet(
          'href',
          `https://github.com/Inventure71/PaddockJS/blob/v11/${target}` + (hash ? `#${hash}` : ''),
        );
    }
    return originalLink
      ? originalLink(tokens, index, options, environment, renderer)
      : renderer.renderToken(tokens, index, options);
  };
  return { html: parser.render(markdown), headings, source };
}

export function assertReferenceSources() {
  const sources = new Set(REFERENCE_DOCUMENTS.map((doc) => doc.source));
  for (const name of readdirSync(resolve(repoRoot, 'docs')).filter((name) => name.endsWith('.md'))) {
    if (!sources.has(`docs/${name}`))
      throw new Error(`Package document missing from site reference: docs/${name}`);
  }
  const ids = new Set(),
    paths = new Set(SITE_ROUTES.map((route) => route.path.replace(/\/$/, '/index.html')));
  for (const doc of REFERENCE_DOCUMENTS) {
    if (ids.has(doc.id) || paths.has(doc.path))
      throw new Error(`Duplicate reference identity or reserved path: ${doc.id} ${doc.path}`);
    ids.add(doc.id);
    paths.add(doc.path);
    if (!existsSync(resolve(repoRoot, doc.source)))
      throw new Error(`Missing site reference source: ${doc.source}`);
  }
}
