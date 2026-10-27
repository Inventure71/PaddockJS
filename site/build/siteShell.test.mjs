import assert from 'node:assert/strict';
import { test } from 'node:test';
import siteConfig from '../vite.config.js';
import { siteRoot } from './referenceContent.mjs';

test('subpath navigation is prefixed while source styles remain owned by Vite asset processing', () => {
  const previous = process.env.PADDOCK_SITE_BASE;
  process.env.PADDOCK_SITE_BASE = '/PaddockJS/';
  try {
    const config = siteConfig();
    const shell = config.plugins.find((plugin) => plugin.name === 'paddock-site-shell');
    const { html } = shell.transformIndexHtml.handler(
      '<html><head><link rel="stylesheet" href="/src/showcase/styles.css"></head><body><!-- site-header --><main id="main"><h1>Example</h1><a id="fixture" href="/guide/">Guide</a></main></body></html>',
      { filename: `${siteRoot}/guide/index.html` },
    );
    assert.match(html, /<a id="fixture" href="\/PaddockJS\/guide\/">/);
    assert.match(html, /<link rel="stylesheet" href="\/src\/showcase\/styles.css">/);
  } finally {
    if (previous === undefined) delete process.env.PADDOCK_SITE_BASE;
    else process.env.PADDOCK_SITE_BASE = previous;
  }
});
