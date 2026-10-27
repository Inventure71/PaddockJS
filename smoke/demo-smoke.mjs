#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { findFreePort, waitForHttp, startPreviewServer, stopPreviewServer } from './previewServer.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const demoRoot = resolve(repoRoot, 'site');
const demoDistIndex = resolve(demoRoot, 'dist', 'index.html');
const skipBuild = process.argv.includes('--skip-build');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForText(page, selector, fragment, timeout = 20_000) {
  await page.locator(selector).waitFor({ state: 'visible', timeout });
  await page.waitForFunction(
    ({ target, expected }) => document.querySelector(target)?.textContent?.toLowerCase().includes(expected),
    { target: selector, expected: fragment.toLowerCase() },
    { timeout },
  );
}

async function assertNoHorizontalOverflow(page, label) {
  const sizes = await page.evaluate(() => ({
    viewport: window.innerWidth,
    page: document.documentElement.scrollWidth,
  }));
  assert(sizes.page <= sizes.viewport + 1, `${label}: page overflows horizontally (${sizes.page}px > ${sizes.viewport}px)`);
}

async function assertComposedOverviewSelection(page) {
  const panels = '#components [data-paddock-component="car-driver-overview"]';
  assert(await page.locator(panels).count() === 2, 'Components must exercise both overview instances.');
  await page.locator(`${panels} [data-overview-mode="driver"]`).first().click();
  await page.waitForFunction((selector) => [...document.querySelectorAll(selector)].every((panel) => (
    panel.querySelector('[data-car-overview-title]')?.textContent === 'Driver overview' &&
    panel.querySelector('[data-overview-field-label]')?.textContent === 'Pace'
  )), panels);
  const timingButton = page.locator('#timing-tower-root [data-driver-id]').nth(1);
  const driverId = await timingButton.getAttribute('data-driver-id');
  const code = await timingButton.locator('.timing-name').textContent();
  await timingButton.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(({ selector, expectedCode }) => [...document.querySelectorAll(selector)].every((panel) => (
    panel.querySelector('[data-car-overview-code]')?.textContent === `${expectedCode.trim()} driver`
  )), { selector: panels, expectedCode: code });
  assert(await timingButton.evaluate((node) => node === document.activeElement), 'Keyboard selection lost timing-button focus.');
  assert(await timingButton.getAttribute('data-driver-id') === driverId, 'Keyboard selection changed entry identity.');
  await page.locator(`${panels} [data-overview-mode="vehicle"]`).last().click();
  await page.waitForFunction((selector) => [...document.querySelectorAll(selector)].every((panel) => (
    panel.querySelector('[data-car-overview-title]')?.textContent === 'Car overview' &&
    panel.querySelector('[data-overview-field-label]')?.textContent === 'Power'
  )), panels);
}

async function assertHeroToolbarLayout(page) {
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 1000, height: 1000 });
  const hero = page.locator('#broadcast-root');
  const geometry = () => hero.evaluate((root) => {
    const header = root.querySelector('.race-telemetry-drawer__toolbar');
    const origin = header.getBoundingClientRect();
    const rect = (node) => {
      const r = node.getBoundingClientRect();
      return { x: r.x - origin.x, y: r.y - origin.y, width: r.width, height: r.height };
    };
    const camera = header.querySelector('[data-paddock-component="camera-controls"]');
    const bounds = camera.getBoundingClientRect();
    const style = getComputedStyle(camera);
    const canvas = root.querySelector('canvas');
    const selector = root.querySelector('[data-grid-navigation]');
    const canvasBounds = canvas.getBoundingClientRect();
    const selectorBounds = selector.getBoundingClientRect();
    const left = bounds.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
    const right = bounds.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth);
    const rows = new Map();
    for (const node of camera.querySelectorAll('button')) {
      const r = node.getBoundingClientRect();
      const key = Math.round(r.top);
      const row = rows.get(key) ?? { left: r.left, right: r.right };
      row.left = Math.min(row.left, r.left);
      row.right = Math.max(row.right, r.right);
      rows.set(key, row);
    }
    return {
      header: rect(header),
      canvas: rect(canvas),
      selected: root.querySelector('[data-grid-jump]').value,
      selectorCentered: Math.abs((selectorBounds.left + selectorBounds.right) / 2 -
        (canvasBounds.left + canvasBounds.right) / 2) < 1,
      zoomPaired: Math.abs(camera.querySelector('[data-zoom-in]').getBoundingClientRect().top -
        camera.querySelector('[data-zoom-out]').getBoundingClientRect().top) < 1,
      controls: [...header.querySelectorAll('button')].filter((node) => node.checkVisibility()).map(rect),
      rowsFill: [...rows.values()].every((row) => Math.abs(row.left - left) < 2 && Math.abs(row.right - right) < 2),
      rows: rows.size,
    };
  });
  await hero.evaluate((node) => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const before = await geometry();
  assert(before.rows > 1 && before.rowsFill, 'Wrapped camera-control rows must fill their available width.');
  assert(before.zoomPaired, 'Zoom actions must wrap together as one control group.');
  assert(before.selectorCentered, 'Project selector must be centered over the canvas.');
  await hero.locator('[data-telemetry-drawer-toggle]').click();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const open = await geometry();
  assert(open.canvas.width < before.canvas.width - 180, 'Telemetry keeps its docked layout beside a narrower track.');
  assert(Math.abs(open.canvas.height - before.canvas.height) < 1, 'Docking telemetry must preserve scene height.');
  assert(open.selectorCentered, 'Project selector follows the center of the narrowed canvas.');
  assert(open.selected === before.selected, 'Opening telemetry must preserve project selection.');
  assert(before.controls.length === open.controls.length, 'Telemetry cannot replace unrelated toolbar controls.');
  for (const [index, box] of before.controls.entries()) {
    for (const key of ['x', 'y', 'width', 'height']) {
      assert(Math.abs(box[key] - open.controls[index][key]) < 1,
        `Telemetry changed toolbar control ${index} ${key}.`);
    }
  }
  assert(Math.abs(before.header.height - open.header.height) < 1, 'Telemetry must not change toolbar height.');
  await hero.locator('[data-telemetry-drawer-toggle]').click();
  await page.setViewportSize(viewport);
}

async function assertHeroGridWalkSession(page) {
  const hero = page.locator('#broadcast-root');
  const canvas = await hero.locator('canvas').first().elementHandle();
  const gridButton = hero.locator('[data-grid-view="grid-walk"]');
  const viewButton = (view) => hero.locator(`[data-grid-toggle]:visible, [data-grid-view="${view}"]:visible`);
  assert(await gridButton.getAttribute('aria-pressed') === 'true', 'Main demo must start with the actual Grid Walk feature.');
  assert(await viewButton('race').textContent() === 'Start race', 'Main demo demonstrates the single-action view control');
  const jump = hero.locator('[data-grid-jump]');
  const selectedId = await jump.locator('option').nth(1).getAttribute('value');
  await jump.selectOption(selectedId);
  await viewButton('race').click();
  assert(await viewButton('grid-walk').textContent() === 'Stop race');
  await waitForText(page, '[data-race-readout]', ' · green · ');
  const clockSelector = '#broadcast-root [data-telemetry-current-lap-time]';
  await page.waitForFunction((selector) => {
    const text = document.querySelector(selector)?.textContent;
    return text && text !== '--' && /[1-9]/.test(text);
  }, clockSelector);
  await viewButton('grid-walk').click();
  await waitForText(page, '#broadcast-root [data-grid-status]', 'race paused');
  const pausedClock = await page.locator(clockSelector).textContent();
  await page.waitForTimeout(400);
  assert(await page.locator(clockSelector).textContent() === pausedClock, 'Grid Walk must hold the existing race lap clock.');
  assert(await jump.inputValue() === selectedId, 'Grid Walk must retain the selected project.');
  assert(await canvas.evaluate((node) => node.isConnected), 'Mode switch must retain the existing canvas.');
  await viewButton('race').click();
  await page.waitForFunction(({ selector, previous }) => document.querySelector(selector)?.textContent !== previous,
    { selector: clockSelector, previous: pausedClock });
  assert(await jump.inputValue() === selectedId, 'Race must retain Grid Walk project selection.');
}

if (!skipBuild) {
  execFileSync('npm', ['--prefix', demoRoot, 'run', 'check'], {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  });
}
assert(existsSync(demoDistIndex), 'Website dist is missing; run npm run site:build first.');

const port = await findFreePort();
const baseUrl = `http://127.0.0.1:${port}/`;
const server = startPreviewServer({ projectRoot: demoRoot, cwd: repoRoot, port, label: 'demo-preview' });
let browser;

try {
  await waitForHttp(baseUrl);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const runtimeErrors = [];
  page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`);
  });

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await waitForText(page, '[data-main-status]', 'live package runtime');
  await page.locator('#broadcast-root canvas').first().waitFor({ state: 'visible', timeout: 20_000 });
  assert(await page.locator('[data-feature-id]').count() >= 50, 'Full feature inventory did not render.');

  const controlDeck = page.locator('.control-deck');
  const safetyCarButton = controlDeck.getByRole('button', { name: 'Safety car', exact: true });
  await page.locator('#broadcast-root canvas').first().scrollIntoViewIfNeeded();
  await assertHeroToolbarLayout(page);
  await assertHeroGridWalkSession(page);
  await safetyCarButton.click();
  assert(await safetyCarButton.getAttribute('aria-pressed') === 'true', 'Safety-car controller action did not update its state.');
  await page.locator('#broadcast-root [data-safety-car]').first().click();
  await page.waitForFunction(() => (
    document.querySelector('.control-deck [data-race-action="safety-car"]')?.getAttribute('aria-pressed') === 'false'
  ), null, { timeout: 3_000 });

  await page.locator('#components').scrollIntoViewIfNeeded();
  await page.locator('#race-canvas-root canvas').first().waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForFunction(() => document.querySelectorAll('#components .paddock-loading').length === 0, null, { timeout: 20_000 });
  for (const id of ['race-controls-root', 'camera-controls-root', 'safety-car-root', 'timing-tower-root', 'telemetry-panel-root', 'overview-root', 'race-data-root', 'sector-banner-root']) {
    assert(await page.locator(`#${id} [data-paddock-component]`).count() > 0, `${id}: public component marker is missing.`);
  }

  await assertComposedOverviewSelection(page);

  await page.locator('#presets').scrollIntoViewIfNeeded();
  await waitForText(page, '[data-preset-status]', 'ready');
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await waitForText(page, '[data-preset-status]', 'dashboard ready');
  assert(new URL(page.url()).searchParams.get('preset') === 'dashboard', 'Preset selection was not reflected in the URL.');
  await page.getByRole('button', { name: 'Compact race', exact: true }).click();
  await page.evaluate(() => {
    document.querySelector('[data-preset="timing-overlay"]').click();
    document.querySelector('[data-preset="full-dashboard"]').click();
  });
  await waitForText(page, '[data-preset-status]', 'full dashboard ready');
  assert(new URL(page.url()).searchParams.get('preset') === 'full-dashboard', 'Rapid preset selection did not retain the latest request.');

  await page.getByRole('button', { name: 'Run 12 deterministic steps', exact: true }).click();
  await waitForText(page, '[data-headless-status]', 'evaluation complete');
  assert(Number(await page.locator('[data-headless-metrics] dd').first().textContent()) > 0, 'Headless vector output is empty.');

  await page.getByRole('heading', { name: 'Explore advanced physics.', exact: true }).waitFor({ state: 'visible' });
  assert((await page.locator('#expert').textContent()).includes('Experimental Formula-style handling'), 'Advanced lab must describe its experimental handling model.');
  await page.getByRole('button', { name: 'Launch advanced lab', exact: true }).click();
  await waitForText(page, '[data-expert-status]', 'vector fields', 25_000);
  // Exercise the actual keyboard -> expert loop -> vehicle path. Loading the
  // lab alone cannot detect reversed, unresponsive or excessively abrupt input.
  await page.locator('#expert-root canvas').click();
  for (const [key, direction] of [['ArrowRight', 1], ['ArrowLeft', -1]]) {
    await page.keyboard.down(key);
    try {
      await page.waitForFunction((sign) => (
        Number.parseFloat(document.querySelector('#expert-root [data-telemetry-lateral-g]').textContent) * sign > 0.1
      ), direction, { timeout: 2_000 });
    } finally {
      await page.keyboard.up(key);
    }
    await page.waitForFunction(() => (
      Math.abs(Number.parseFloat(document.querySelector('#expert-root [data-telemetry-lateral-g]').textContent)) <= 0.1
    ), null, { timeout: 2_000 });
    assert(await page.locator('#expert-root [data-telemetry-stability]').textContent() === 'STABLE', `${key}: car did not settle after a short tap.`);
    assert(await page.locator('#expert-root [data-telemetry-surface]').textContent() === 'TRACK', `${key}: short tap left the track.`);
  }
  await page.keyboard.down('ArrowUp');
  await page.waitForFunction(() => (
    Number.parseFloat(document.querySelector('#expert-root [data-telemetry-throttle]').textContent) > 0
  ));
  await page.locator('[data-feature-search]').fill('replay ghost');
  await page.keyboard.up('ArrowUp');
  await page.waitForFunction(() => (
    document.querySelector('#expert-root [data-telemetry-throttle]').textContent === '0%'
  ), null, { timeout: 2_000 });
  assert(await page.locator('#expert [data-key].is-active').count() === 0, 'Keyboard input remained held after focus moved away.');
  assert(await page.locator('[data-feature-id="replay-ghosts"]').count() === 1, 'Feature search did not expose replay ghosts.');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await waitForText(page, '[data-main-status]', 'live package runtime');
  await assertNoHorizontalOverflow(page, '390px viewport');
  const mobileToggle = page.getByRole('button', { name: 'Explore', exact: true });
  await mobileToggle.click();
  assert(await mobileToggle.getAttribute('aria-expanded') === 'true', 'Mobile navigation did not open.');
  await page.getByRole('link', { name: 'Headless', exact: true }).click();
  assert(new URL(page.url()).hash === '#headless', 'Mobile navigation did not preserve deep linking.');
  assert(await mobileToggle.getAttribute('aria-expanded') === 'false', 'Mobile navigation did not close after selection.');

  await page.setViewportSize({ width: 320, height: 800 });
  await assertNoHorizontalOverflow(page, '320px viewport');
  assert(runtimeErrors.length === 0, runtimeErrors.join('\n'));
  console.log('[demo-smoke] Desktop runtime, public surfaces, presets, expert, headless, search, and mobile layout passed.');
} finally {
  await browser?.close();
  await stopPreviewServer(server);
}
