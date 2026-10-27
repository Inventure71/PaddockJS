import assert from 'node:assert/strict';
import { SITE_ROUTES } from '../site/src/shared/routes.js';

async function follow(page, path) {
  const link = page.locator(`a[href="${path}"]`).first();
  await link.click();
  await page.waitForURL((url) => url.pathname === path);
  await page.getByRole('heading', { level: 1 }).first().waitFor({ state: 'visible' });
  assert(await page.locator('.site-header').count() === 1, `${path}: expected one shared website header`);
}

export async function smokeSiteNavigation(page, baseUrl) {
  // HTTP inspection catches missing multipage outputs that an SPA fallback
  // could otherwise turn into an apparently successful root document.
  const missing = await page.request.get(`${baseUrl}/guide/does-not-exist.html`);
  assert.equal(missing.status(), 404, 'Missing documentation pages must not silently render the demo');
  const homeHtml = await (await page.request.get(baseUrl)).text();
  const firstHeading = (html) => html.match(/<h1(?:\s[^>]*)?>([\s\S]*?)<\/h1>/i)?.[1];
  for (const route of SITE_ROUTES) {
    const response = await page.request.get(`${baseUrl}${route.path}`);
    assert(response.ok(), `${route.path}: missing canonical website output`);
    const html = await response.text();
    assert(firstHeading(html), `${route.path}: canonical output has no page heading`);
    if (route.path !== '/') {
      assert.notEqual(firstHeading(html), firstHeading(homeHtml), `${route.path}: root fallback hid a missing canonical page`);
    }
  }

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await follow(page, '/guide/');
  await follow(page, '/guide/grid-walk.html');
  await page.locator('#grid-host canvas').first().waitFor({ state: 'visible', timeout: 20_000 });
  await follow(page, '/labs/');
  await follow(page, '/labs/policy-runner.html');
  await page.locator('[data-policy-controller-select]').waitFor({ state: 'visible' });
  await follow(page, '/reference/');
  const search = page.locator('[data-reference-search]');
  await search.fill('no-matching-document-71');
  assert.equal(await page.locator('[data-reference-document]:visible').count(), 0);
  await search.fill('Grid Walk');
  assert.equal(await page.locator('[data-reference-document]:visible').count(), 1);
  await follow(page, '/reference/grid-walk.html');
  assert((await page.locator('main').textContent()).includes('gridWalk'), 'Grid Walk reference must contain its real API documentation');
  await follow(page, '/');

  await page.setViewportSize({ width: 390, height: 844 });
  const toggle = page.getByRole('button', { name: 'Explore', exact: true });
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await toggle.evaluate((node) => node === document.activeElement), true, 'Escape restores the navigation toggle');
  await toggle.click();
  await follow(page, '/guide/');
  assert.equal(await page.locator('[data-nav-toggle]').getAttribute('aria-expanded'), 'false');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.setViewportSize({ width: 1440, height: 900 });

  for (const route of SITE_ROUTES.filter((item) => item.legacy)) {
    const legacy = Array.isArray(route.legacy) ? route.legacy[0] : route.legacy;
    await page.goto(`${baseUrl}${legacy}?migrationCheck=71#retained-fragment`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL((url) => url.pathname === route.path);
    const url = new URL(page.url());
    assert.equal(url.searchParams.get('migrationCheck'), '71', `${legacy}: redirect lost query`);
    assert.equal(url.hash, '#retained-fragment', `${legacy}: redirect lost fragment`);
  }
}
