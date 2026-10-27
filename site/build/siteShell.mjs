import { SITE_ROUTES, DEMO_CHAPTERS, siteUrl } from '../src/shared/routes.js';
import { escapeHtml } from './referenceContent.mjs';

export function renderSiteHeader(pathname, base = '/') {
  const route = SITE_ROUTES.find(
    (entry) => entry.path === pathname || `${entry.path}index.html` === pathname,
  );
  const section = route?.section ?? (pathname.startsWith('/reference/') ? 'reference' : 'demo');
  const global = ['demo', 'guide', 'labs', 'reference'].map((id) =>
    SITE_ROUTES.find((entry) => entry.id === id),
  );
  const links = (entries, active) =>
    entries
      .map(
        (entry) =>
          `<a href="${escapeHtml(siteUrl(entry.path, base))}"${entry.id === active ? ' aria-current="page"' : ''}>${escapeHtml(entry.title)}</a>`,
      )
      .join('');
  const secondary =
    section === 'demo'
      ? DEMO_CHAPTERS
      : SITE_ROUTES.filter((entry) => entry.section === section && entry.id !== section);
  return `<a class="site-skip-link" href="#main">Skip to content</a><header class="site-header paddock-site-header" data-site-header><div class="paddock-site-header__bar"><a class="paddock-site-brand" href="${siteUrl('/', base)}" aria-label="PaddockJS home">PaddockJS</a><button type="button" class="paddock-site-header__toggle" data-nav-toggle aria-expanded="false" aria-controls="site-navigation">Explore</button><div class="paddock-site-navigation" data-site-nav id="site-navigation"><nav aria-label="Site">${links(global, section)}</nav><a class="paddock-site-source" href="https://github.com/Inventure71/PaddockJS">GitHub ↗</a></div></div>${secondary.length ? `<nav class="paddock-site-subnav" data-section-navigation aria-label="${section === 'demo' ? 'Demo chapters' : `${section} pages`}">${links(secondary, route?.id)}</nav>` : ''}</header>`;
}
