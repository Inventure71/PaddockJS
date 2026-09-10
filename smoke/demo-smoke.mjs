#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const demoRoot = resolve(repoRoot, 'demo');
const demoDistIndex = resolve(demoRoot, 'dist', 'index.html');
const skipBuild = process.argv.includes('--skip-build');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function findFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolvePort(address.port));
    });
  });
}

async function waitForHttp(url, timeoutMilliseconds = 15_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMilliseconds) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The preview server is still starting.
    }
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function startPreviewServer(port) {
  const child = spawn('npm', [
    '--prefix', demoRoot, 'run', 'preview', '--', '--port', String(port), '--strictPort',
  ], {
    cwd: repoRoot,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  child.stdout.on('data', (chunk) => process.stdout.write(`[demo-preview] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[demo-preview] ${chunk}`));
  return child;
}

async function stopPreviewServer(child) {
  if (!child || child.exitCode != null || child.signalCode != null) return;
  try {
    if (process.platform === 'win32') child.kill('SIGTERM');
    else process.kill(-child.pid, 'SIGTERM');
  } catch {
    return;
  }
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    delay(3_000),
  ]);
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

if (!skipBuild) {
  execFileSync('npm', ['--prefix', demoRoot, 'run', 'check'], {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  });
}
assert(existsSync(demoDistIndex), 'Demo dist is missing; run npm run demo:build first.');

const port = await findFreePort();
const baseUrl = `http://127.0.0.1:${port}/`;
const server = startPreviewServer(port);
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
  await waitForText(page, '[data-race-readout]', ' · green · ');
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
