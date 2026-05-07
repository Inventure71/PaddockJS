#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const previewRoot = resolve(repoRoot, 'local-preview');

function run(command, args, options = {}) {
  console.log(`[browser-smoke] ${command} ${args.join(' ')}`);
  execFileSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    stdio: 'inherit',
    env: process.env,
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
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

async function waitForHttp(url, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function startPreviewServer(port) {
  const child = spawn('npm', [
    '--prefix',
    previewRoot,
    'run',
    'preview',
    '--',
    '--port',
    String(port),
    '--strictPort',
  ], {
    cwd: repoRoot,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => process.stdout.write(`[preview] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[preview] ${chunk}`));
  return child;
}

async function stopPreviewServer(child) {
  if (!child || child.exitCode != null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolveStop) => child.once('exit', resolveStop)),
    delay(3000).then(() => child.kill('SIGKILL')),
  ]);
}

async function assertCanvasRendered(page, label) {
  const canvas = page.locator('[data-track-canvas] canvas').first();
  await canvas.waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(750);
  const box = await canvas.boundingBox();
  assert(box && box.width > 180 && box.height > 120, `${label}: race canvas has invalid visible size`);

  const rendered = await canvas.evaluate((node) => {
    const canvasNode = node;
    const sampleWebGl = (contextName) => {
      const gl = canvasNode.getContext(contextName);
      if (!gl) return null;
      const width = gl.drawingBufferWidth;
      const height = gl.drawingBufferHeight;
      const points = [
        [Math.floor(width * 0.5), Math.floor(height * 0.5)],
        [Math.floor(width * 0.25), Math.floor(height * 0.35)],
        [Math.floor(width * 0.75), Math.floor(height * 0.35)],
        [Math.floor(width * 0.35), Math.floor(height * 0.7)],
        [Math.floor(width * 0.65), Math.floor(height * 0.7)],
      ];
      const pixel = new Uint8Array(4);
      return points.some(([x, y]) => {
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        return pixel[0] !== 0 || pixel[1] !== 0 || pixel[2] !== 0 || pixel[3] !== 0;
      });
    };

    const webgl2 = sampleWebGl('webgl2');
    if (webgl2 != null) return webgl2;
    const webgl = sampleWebGl('webgl');
    if (webgl != null) return webgl;

    const context2d = canvasNode.getContext('2d', { willReadFrequently: true });
    if (!context2d) return false;
    const { width, height } = canvasNode;
    const points = [
      [Math.floor(width * 0.5), Math.floor(height * 0.5)],
      [Math.floor(width * 0.25), Math.floor(height * 0.35)],
      [Math.floor(width * 0.75), Math.floor(height * 0.35)],
      [Math.floor(width * 0.35), Math.floor(height * 0.7)],
      [Math.floor(width * 0.65), Math.floor(height * 0.7)],
    ];
    return points.some(([x, y]) => {
      const pixel = context2d.getImageData(x, y, 1, 1).data;
      return pixel[0] !== 0 || pixel[1] !== 0 || pixel[2] !== 0 || pixel[3] !== 0;
    });
  });

  if (rendered) return;

  const screenshot = await canvas.screenshot();
  assert(screenshot.length > 5000, `${label}: race canvas screenshot stayed too small to prove rendering`);
}

async function assertNoPackageOverflow(page, label) {
  const failures = await page.evaluate(() => {
    const selectors = [
      '[data-f1-simulator-shell]',
      '[data-paddock-component]',
      '[data-track-canvas]',
      '.sim-workspace',
      '.sim-grid',
      '[data-timing-list]',
      '.timing-list',
      '.timing-entry',
      '.sim-canvas-panel',
      '.race-data-panel',
      '.telemetry-stack',
      '.car-overview',
      '.camera-controls',
      '.sim-topbar',
    ];
    const elements = [...document.querySelectorAll(selectors.join(','))];
    return elements
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      })
      .map((element) => ({
        selector: element.getAttribute('data-paddock-component') ||
          element.getAttribute('data-f1-simulator-shell') ||
          element.className ||
          element.tagName,
        className: String(element.className ?? ''),
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        children: [...element.children].slice(0, 4).map((child) => ({
          className: String(child.className ?? ''),
          scrollWidth: child.scrollWidth,
          clientWidth: child.clientWidth,
        })),
      }))
      .filter((entry) => entry.scrollWidth > entry.clientWidth + 2);
  });
  assert(failures.length === 0, `${label}: package horizontal overflow ${JSON.stringify(failures.slice(0, 5))}`);
}

async function smokeTemplates(page, baseUrl, viewport, label) {
  await page.setViewportSize(viewport);
  await page.goto(`${baseUrl}/templates.html`, { waitUntil: 'networkidle' });
  await assertCanvasRendered(page, `${label} templates`);
  await assertNoPackageOverflow(page, `${label} templates`);
}

async function smokeApi(page, baseUrl) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${baseUrl}/api.html`, { waitUntil: 'networkidle' });
  await assertCanvasRendered(page, 'api');
  await page.locator('[data-action="snapshot"]').click();
  await page.waitForFunction(() => {
    const text = document.querySelector('[data-preview-snapshot]')?.textContent ?? '';
    return text.includes('"mode"') && text.includes('"leader"');
  });
  await page.locator('[data-action="safety"]').click();
  await page.waitForTimeout(300);
  await page.locator('[data-action="restart"]').click();
  await page.waitForTimeout(300);
  await assertNoPackageOverflow(page, 'api');
}

async function smokePolicyRunner(page, baseUrl) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${baseUrl}/policy-runner.html`, { waitUntil: 'networkidle' });
  await assertCanvasRendered(page, 'policy runner');
  const before = await page.locator('[data-policy-runner-readout]').textContent();
  await page.locator('[data-policy-runner-step]').click();
  await page.waitForFunction((previous) => {
    const text = document.querySelector('[data-policy-runner-readout]')?.textContent ?? '';
    return text !== previous && text.includes('"step": 1') && text.includes('"action"') &&
      text.includes('"actionSpec"') && text.includes('"observationSpec"');
  }, before);
  await assertNoPackageOverflow(page, 'policy runner');
}

async function main() {
  if (!existsSync(resolve(previewRoot, 'node_modules'))) {
    run('npm', ['--prefix', previewRoot, 'ci']);
  }
  run('npm', ['--prefix', previewRoot, 'run', 'build']);

  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = startPreviewServer(port);
  let browser = null;

  try {
    await waitForHttp(baseUrl);
    browser = await chromium.launch();
    const page = await browser.newPage();
    await smokeTemplates(page, baseUrl, { width: 1440, height: 1000 }, 'desktop');
    await smokeTemplates(page, baseUrl, { width: 390, height: 900 }, 'mobile');
    await smokeApi(page, baseUrl);
    await smokePolicyRunner(page, baseUrl);
    await page.close();
    console.log('[browser-smoke] browser smoke checks passed');
  } finally {
    await browser?.close();
    await stopPreviewServer(server);
  }
}

main().catch((error) => {
  console.error('[browser-smoke] failed');
  console.error(error);
  process.exitCode = 1;
});
