import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { SITE_ROUTES, siteUrl } from './src/shared/routes.js';
import { generateReference } from './build/generateReference.mjs';
import { renderReference, siteRoot, repoRoot, escapeHtml } from './build/referenceContent.mjs';
import { renderSiteHeader } from './build/siteShell.mjs';

export default defineConfig(() => {
  const base = process.env.PADDOCK_SITE_BASE ?? '/';
  generateReference();
  const aliases = SITE_ROUTES.filter((route) => route.legacy);
  return {
    appType: 'mpa',
    base,
    cacheDir: '../.vite/site',
    server: { strictPort: true },
    preview: { strictPort: true },
    plugins: [
      {
        name: 'paddock-site-shell',
        transformIndexHtml: {
          order: 'pre',
          handler(html, context) {
            const filename = context.filename.replaceAll('\\', '/');
            const pathname = `/${filename.slice(siteRoot.length + 1)}`;
            html = html.replace('<!-- site-header -->', renderSiteHeader(pathname, base));
            html = html.replace(
              /<!-- route-index:(guide|labs) -->/g,
              (_, section) =>
                `<ul class="site-index__links">${SITE_ROUTES.filter(
                  (route) => route.section === section && route.id !== section,
                )
                  .map(
                    (route) =>
                      `<li><a href="${siteUrl(route.path, base)}"><strong>${escapeHtml(route.title)}</strong><span>${escapeHtml(route.description)}</span></a></li>`,
                  )
                  .join('')}</ul>`,
            );
            html = html.replace(
              /<!-- reference:([\w-]+) -->/g,
              (_, id) =>
                `<article class="reference-copy">${renderReference(`docs/${id}.md`, { base, embedded: true }).html}</article>`,
            );
            if (!/id="main"/.test(html)) html = html.replace('<main ', '<main id="main" ');
            // Vite rewrites module/assets; ordinary document links need the same base.
            if (base !== '/')
              html = html.replace(/\bhref=(["'])(\/(?!\/)[^"']*)\1/g, (match, quote, path) =>
                path.startsWith(base) ? match : `href=${quote}${siteUrl(path, base)}${quote}`,
              );
            return {
              html,
              tags: [
                { tag: 'script', attrs: { type: 'module', src: '/src/shared/shell.js' }, injectTo: 'head' },
              ],
            };
          },
        },
        configureServer(server) {
          server.middlewares.use((request, response, next) => {
            const url = new URL(request.url, 'http://site.local');
            const route = aliases.find((entry) => siteUrl(entry.legacy, base) === url.pathname);
            if (!route) return next();
            response.writeHead(302, { Location: siteUrl(route.path, base) + url.search });
            response.end();
          });
          server.watcher.add([resolve(repoRoot, 'docs'), resolve(repoRoot, 'INSTALL_AND_UPDATE.md')]);
          server.watcher.on('change', (filename) => {
            if (filename.endsWith('.md')) {
              generateReference();
              server.ws.send({ type: 'full-reload' });
            }
          });
        },
        generateBundle() {
          for (const route of aliases) {
            const target = siteUrl(route.path, base);
            this.emitFile({
              type: 'asset',
              fileName: route.legacy.slice(1),
              source: `<!doctype html><meta charset="utf-8"><title>Page moved · PaddockJS</title><a href="${target}">Continue to ${route.title}</a><script>location.replace(${JSON.stringify(target)}+location.search+location.hash)</script>`,
            });
          }
        },
      },
    ],
    build: {
      rollupOptions: {
        input: Object.fromEntries([
          ['demo', resolve(siteRoot, 'index.html')],
          ...['guide', 'labs', 'reference'].flatMap((folder) =>
            readdirSync(resolve(siteRoot, folder))
              .filter((file) => file.endsWith('.html'))
              .map((file) => [`${folder}-${file.replace('.html', '')}`, resolve(siteRoot, folder, file)]),
          ),
        ]),
      },
    },
  };
});
