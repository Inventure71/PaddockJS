#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const previewRoot = resolve(repoRoot, 'local-preview');
const previewDistIndex = resolve(previewRoot, 'dist', 'index.html');
const deterministicTemplatesPath = '/templates.html?completeTrackSeed=20260430';
const cliArgs = new Set(process.argv.slice(2));
const quickMode = cliArgs.has('--quick');
const skipBuild = cliArgs.has('--skip-build') || process.env.PADDOCKJS_BROWSER_SMOKE_SKIP_BUILD === '1';
const startupAssetDelayMs = quickMode ? 250 : 750;

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
    detached: process.platform !== 'win32',
  });

  child.stdout.on('data', (chunk) => process.stdout.write(`[preview] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[preview] ${chunk}`));
  return child;
}

function isChildExited(child) {
  return !child || child.exitCode != null || child.signalCode != null;
}

function signalPreviewServer(child, signal) {
  if (isChildExited(child)) return;
  try {
    if (process.platform === 'win32') {
      child.kill(signal);
      return;
    }
    process.kill(-child.pid, signal);
  } catch {
    // The process may have exited between the state check and signal delivery.
  }
}

async function waitForPreviewExit(child, timeoutMs) {
  if (isChildExited(child)) return true;
  return Promise.race([
    new Promise((resolveStop) => child.once('exit', () => resolveStop(true))),
    delay(timeoutMs).then(() => false),
  ]);
}

async function stopPreviewServer(child) {
  if (isChildExited(child)) return;
  signalPreviewServer(child, 'SIGTERM');
  if (await waitForPreviewExit(child, 3000)) return;
  signalPreviewServer(child, 'SIGKILL');
  await waitForPreviewExit(child, 3000);
}

async function assertCanvasRendered(page, label) {
  const canvas = page.locator('[data-track-canvas] canvas').first();
  await canvas.waitFor({ state: 'visible', timeout: 15000 });
  const box = await canvas.boundingBox();
  assert(box && box.width > 180 && box.height > 120, `${label}: race canvas has invalid visible size`);

  const rendered = await waitForCanvasPixels(canvas, 5000);
  if (rendered) return;

  const screenshot = await canvas.screenshot();
  assert(screenshot.length > 5000, `${label}: race canvas screenshot stayed too small to prove rendering`);
}

async function waitForCanvasPixels(canvas, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await canvas.evaluate((node) => {
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
    })) return true;
    await delay(50);
  }
  return false;
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

async function assertRacePanelFillsRoot(page, rootSelector, label) {
  const measurement = await page.evaluate((selector) => {
    const root = document.querySelector(selector);
    const panel = root?.querySelector('[data-paddock-component="race-canvas"]');
    if (!root || !panel) return null;
    const rootRect = root.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    return {
      rootHeight: rootRect.height,
      panelHeight: panelRect.height,
      topGap: panelRect.top - rootRect.top,
      bottomGap: rootRect.bottom - panelRect.bottom,
    };
  }, rootSelector);

  assert(measurement, `${label}: expected loaded race panel inside ${rootSelector}`);
  assert(
    Math.abs(measurement.topGap) <= 2 && Math.abs(measurement.bottomGap) <= 2,
    `${label}: race panel does not fill preview root ${JSON.stringify(measurement)}`,
  );
}

async function assertHostEmbedFitsRoot(page, rootSelector, label) {
  const measurement = await page.evaluate((selector) => {
    const root = document.querySelector(selector);
    const host = root?.closest('.host-embed');
    if (!root || !host) return null;
    const rootRect = root.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    return {
      hostHeight: hostRect.height,
      rootHeight: rootRect.height,
      topGap: rootRect.top - hostRect.top,
      bottomGap: hostRect.bottom - rootRect.bottom,
    };
  }, rootSelector);

  assert(measurement, `${label}: expected preview host frame around ${rootSelector}`);
  assert(
    Math.abs(measurement.bottomGap) <= 2,
    `${label}: preview host frame exposes space below mounted root ${JSON.stringify(measurement)}`,
  );
}

async function smokeTemplates(page, baseUrl, viewport, label) {
  await page.setViewportSize(viewport);
  await page.goto(`${baseUrl}${deterministicTemplatesPath}`, { waitUntil: 'networkidle' });
  if (label === 'desktop') {
    await page.waitForSelector('#template-complete-root [data-paddock-component="race-canvas"].is-loaded', {
      state: 'attached',
      timeout: 15000,
    });
  }
  await page.locator('#template-complete-root').scrollIntoViewIfNeeded();
  await assertCanvasRendered(page, `${label} templates`);
  if (label === 'desktop') {
    const firstTemplateHeading = await page.locator('.showcase-section h2').first().textContent();
    assert(firstTemplateHeading.includes('Complete race workbench'), 'templates: complete workbench should be the first template');
    await page.waitForFunction(() => {
      const root = document.querySelector('#template-complete-root');
      const controller = window.__paddockPreviewControllers?.get?.('complete-broadcast');
      const snapshot = controller?.getSnapshot?.();
      const pitLane = snapshot?.track?.pitLane;
      const pitCamera = root?.querySelector('.race-telemetry-drawer__toolbar [data-camera-mode="pit"]');
      const pointDistance = (first, second) => Math.hypot(first.x - second.x, first.y - second.y);
      return root?.querySelector('[data-timing-tower]') &&
        root?.querySelector('[data-race-telemetry-drawer]') &&
        root?.querySelector('.race-telemetry-drawer__toolbar [data-paddock-component="camera-controls"]') &&
        root?.querySelector('.race-telemetry-drawer__toolbar [data-race-data-banners-muted]') &&
        pitCamera &&
        !pitCamera.hidden &&
        !pitCamera.disabled &&
        root?.querySelector('.race-telemetry-drawer__toolbar [data-safety-car]') &&
        root?.querySelector('.race-telemetry-drawer__toolbar [data-telemetry-drawer-toggle]') &&
        !root?.querySelector('[data-paddock-component="race-canvas"] > .camera-controls') &&
        root?.querySelector('[data-telemetry-drawer][aria-hidden="true"]') &&
        root?.querySelector('[data-race-data-panel]') &&
        window.__paddockCompleteWorkbenchTrackSeed === 20260430 &&
        controller?.app?.trackSeed === 20260430 &&
        snapshot?.cars?.length > 3 &&
        pitLane?.boxes?.length === 20 &&
        pitLane?.serviceAreas?.length === 10 &&
        pitLane?.workingLane?.points?.length === 2 &&
        pitLane?.teamCount === 10 &&
        pitLane?.entry?.roadCenterline?.length >= 3 &&
        pitLane?.exit?.roadCenterline?.length >= 3 &&
        pointDistance(pitLane.entry.roadCenterline.at(-1), pitLane.mainLane.start) < 1 &&
        pointDistance(pitLane.exit.roadCenterline[0], pitLane.mainLane.end) < 1 &&
        controller?.app?.trackAsset?.container?.children?.some?.((child) => child.label === 'pit-lane') &&
        controller?.app?.trackAsset?.container?.children?.some?.((child) => (
          child.label === 'world-grass' &&
          child.worldGrassBounds?.width > snapshot.world.width * 2.5 &&
          child.worldGrassBounds?.height > snapshot.world.height * 2.5
        )) &&
        snapshot?.rules?.modules?.penalties?.trackLimits?.strictness === 1 &&
        snapshot?.rules?.modules?.penalties?.collision?.strictness === 1;
    }, { timeout: 15000 });
    await page.locator('#template-complete-root .race-telemetry-drawer__toolbar [data-camera-mode="pit"]').click();
    await page.waitForFunction(() => {
      const controller = window.__paddockPreviewControllers?.get?.('complete-broadcast');
      const snapshot = controller?.getSnapshot?.();
      const pitLane = snapshot?.track?.pitLane;
      if (!controller?.app || !pitLane) return false;
      const points = [
        pitLane.entry.lanePoint,
        ...pitLane.mainLane.points,
        ...pitLane.workingLane.points,
        pitLane.exit.lanePoint,
        ...pitLane.boxes.flatMap((box) => box.corners),
        ...pitLane.serviceAreas.flatMap((area) => [...area.corners, ...area.queueCorners]),
      ].filter(Boolean);
      const bounds = points.reduce((box, point) => ({
        minX: Math.min(box.minX, point.x),
        minY: Math.min(box.minY, point.y),
        maxX: Math.max(box.maxX, point.x),
        maxY: Math.max(box.maxY, point.y),
      }), {
        minX: Infinity,
        minY: Infinity,
        maxX: -Infinity,
        maxY: -Infinity,
      });
      const target = controller.app.getCameraTarget(snapshot);
      return controller.app.camera.mode === 'pit' &&
        Math.abs(target.x - ((bounds.minX + bounds.maxX) / 2)) < 1 &&
        Math.abs(target.y - ((bounds.minY + bounds.maxY) / 2)) < 1;
    }, { timeout: 5000 });
    await page.locator('#template-complete-root .race-telemetry-drawer__toolbar [data-zoom-out]').click();
    await page.waitForFunction(() => {
      const controller = window.__paddockPreviewControllers?.get?.('complete-broadcast');
      return controller?.app?.camera?.mode === 'pit' && controller.app.camera.zoom < 1;
    }, { timeout: 5000 });
    await page.locator('#template-complete-root .race-telemetry-drawer__toolbar [data-zoom-in]').click();
    await page.waitForFunction(() => {
      const controller = window.__paddockPreviewControllers?.get?.('complete-broadcast');
      return controller?.app?.camera?.mode === 'pit' && controller.app.camera.zoom >= 1;
    }, { timeout: 5000 });
    await page.locator('#template-complete-root .race-telemetry-drawer__toolbar [data-race-data-banners-muted]').click();
    await page.waitForFunction(() => {
      const root = document.querySelector('#template-complete-root');
      const controller = window.__paddockPreviewControllers?.get?.('complete-broadcast');
      const mute = root?.querySelector('.race-telemetry-drawer__toolbar [data-race-data-banners-muted]');
      return controller?.app?.raceDataBannersMuted === true &&
        mute?.getAttribute('aria-pressed') === 'true' &&
        controller.app.isRaceDataBannerEnabled('project') === false &&
        controller.app.isRaceDataBannerEnabled('radio') === false;
    }, { timeout: 5000 });
    await page.locator('#template-complete-root [data-telemetry-drawer-toggle]').click();
    const drawerCanvasSize = await page.waitForFunction(() => {
      const root = document.querySelector('#template-complete-root');
      const canvas = root?.querySelector('[data-track-canvas] canvas');
      const rect = canvas?.getBoundingClientRect();
      const controller = window.__paddockPreviewControllers?.get?.('complete-broadcast');
      if (!canvas || !rect || !controller?.app?.app?.renderer) return false;
      const data = {
        cssWidth: rect.width,
        cssHeight: rect.height,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        rendererWidth: controller.app.app.renderer.width,
        rendererHeight: controller.app.app.renderer.height,
        dpr: window.devicePixelRatio || 1,
      };
      const canvasMatches = Math.abs((data.canvasWidth / data.dpr) - data.cssWidth) <= 3 &&
        Math.abs((data.canvasHeight / data.dpr) - data.cssHeight) <= 3;
      const rendererMatches = Math.abs((data.rendererWidth / data.dpr) - data.cssWidth) <= 3 &&
        Math.abs((data.rendererHeight / data.dpr) - data.cssHeight) <= 3;
      return canvasMatches && rendererMatches ? data : false;
    }, { timeout: 5000 }).then((handle) => handle.jsonValue());
    assert(drawerCanvasSize, 'templates drawer: expected canvas size data after opening telemetry drawer');
    assert(
      Math.abs((drawerCanvasSize.canvasWidth / drawerCanvasSize.dpr) - drawerCanvasSize.cssWidth) <= 3 &&
        Math.abs((drawerCanvasSize.canvasHeight / drawerCanvasSize.dpr) - drawerCanvasSize.cssHeight) <= 3,
      `templates drawer: canvas backing size did not follow open drawer layout ${JSON.stringify(drawerCanvasSize)}`,
    );
    assert(
      Math.abs((drawerCanvasSize.rendererWidth / drawerCanvasSize.dpr) - drawerCanvasSize.cssWidth) <= 3 &&
        Math.abs((drawerCanvasSize.rendererHeight / drawerCanvasSize.dpr) - drawerCanvasSize.cssHeight) <= 3,
      `templates drawer: renderer size did not follow open drawer layout ${JSON.stringify(drawerCanvasSize)}`,
    );
    await assertRacePanelFillsRoot(page, '#template-complete-root .race-telemetry-drawer__race', 'templates complete race workbench');
    await page.evaluate(() => {
      const controller = window.__paddockPreviewControllers?.get?.('complete-broadcast');
      const sim = controller?.app?.sim;
      const car = sim?.cars?.[0];
      if (!controller || !sim || !car) throw new Error('complete-broadcast simulator unavailable');
      const point = sim.track.samples.reduce((closest, candidate) => (
        Math.abs(candidate.distance - 1350) < Math.abs(closest.distance - 1350) ? candidate : closest
      ), sim.track.samples[0]);
      sim.setCarState(car.id, {
        x: point.x,
        y: point.y,
        heading: point.heading,
        speed: 0,
        progress: point.distance,
        raceDistance: point.distance,
      });
      sim.step(1 / 60);
      const offset = sim.track.width / 2 + (sim.track.kerbWidth ?? 0) + 320;
      sim.setCarState(car.id, {
        x: point.x + point.normalX * offset,
        y: point.y + point.normalY * offset,
        heading: point.heading,
        speed: 0,
        progress: point.distance,
        raceDistance: point.distance,
      });
      sim.reviewTrackLimits?.();
      controller.app.updateDom(sim.snapshot());
    });
    await page.waitForFunction(() => {
      const message = document.querySelector('#template-complete-root [data-steward-message]');
      return message &&
        !message.classList.contains('is-hidden') &&
        message.textContent.includes('Warning') &&
        message.textContent.includes('Track Limits');
    });
    await page.locator('#template-banner-root').scrollIntoViewIfNeeded();
    await page.waitForSelector('#template-banner-root [data-paddock-component="race-canvas"].is-loaded', {
      state: 'attached',
      timeout: 15000,
    });
    await assertRacePanelFillsRoot(page, '#template-banner-root', 'templates banner race window');
    await assertHostEmbedFitsRoot(page, '#template-banner-root', 'templates banner host frame');
    await assertTemplateBannerTelemetryLightMode(page);
  }
  await assertNoPackageOverflow(page, `${label} templates`);
}

async function assertTemplateBannerTelemetryLightMode(page) {
  await page.evaluate(() => {
    const controller = window.__paddockPreviewControllers?.get?.('banner-option');
    if (!controller) throw new Error('banner-option simulator unavailable');
    controller.restart({ theme: { mode: 'light' } });
    controller.selectDriver('budget');
  });
  await page.locator('[data-banner-demo="project"]').click();
  await page.waitForFunction(() => {
    const panel = document.querySelector('#template-banner-root [data-race-data-panel]');
    const telemetry = panel?.querySelector('[data-race-data-telemetry]');
    return panel &&
      telemetry &&
      !panel.classList.contains('is-hidden') &&
      !panel.classList.contains('is-radio-mode') &&
      panel.textContent.includes('Budget Buddy');
  }, { timeout: 5000 });
  const state = await page.evaluate(() => {
    const telemetry = document.querySelector('#template-banner-root [data-race-data-telemetry]');
    const root = telemetry?.closest('.f1-sim-component');
    if (!telemetry || !root) return null;
    const telemetryStyle = getComputedStyle(telemetry);
    const rootStyle = getComputedStyle(root);
    return {
      mode: root.getAttribute('data-paddock-theme-mode'),
      text: telemetry.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      borderLeftColor: telemetryStyle.borderLeftColor,
      lineColor: rootStyle.getPropertyValue('--line').trim(),
    };
  });
  assert(state, 'templates banner light mode: expected telemetry detail state');
  assert(state.mode === 'light', 'templates banner light mode: banner root did not switch to light mode');
  assert(state.text.includes('Sectors'), 'templates banner light mode: telemetry detail was not populated');
  assert(
    state.borderLeftColor === state.lineColor,
    'templates banner light mode: telemetry detail divider kept a stale dark-mode border color',
  );
}

async function smokeComponents(page, baseUrl) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${baseUrl}/components.html`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#component-embedded-canvas [data-paddock-component="race-canvas"].is-loaded', {
    state: 'attached',
    timeout: 15000,
  });
  await assertCanvasRendered(page, 'components');
  await assertRacePanelFillsRoot(page, '#component-embedded-canvas', 'components embedded race window');
  await page.waitForFunction(() => {
    const root = document.querySelector('#component-embedded-canvas');
    const stewardText = root?.querySelector('[data-steward-message]')?.textContent ?? '';
    return root?.querySelector('.timing-penalty-badge') &&
      stewardText.includes('+5s') &&
      stewardText.includes('BUD time penalty') &&
      stewardText.includes('Track Limits');
  });
  await page.waitForFunction(() => {
    const expectedComponents = [
      'race-controls',
      'safety-car-control',
      'camera-controls',
      'timing-tower',
      'race-canvas',
      'telemetry-core',
      'telemetry-sectors',
      'telemetry-sector-banner',
      'telemetry-lap-times',
      'telemetry-sector-times',
      'telemetry-stack',
      'car-driver-overview',
      'race-data-panel',
    ];
    return expectedComponents.every((component) => (
      document.querySelector(`[data-paddock-component="${component}"]`)
    ));
  }, { timeout: 5000 });
  await page.locator('#component-telemetry-drawer').scrollIntoViewIfNeeded();
  await page.waitForSelector('#component-telemetry-drawer [data-paddock-component="race-telemetry-drawer"]', {
    state: 'attached',
    timeout: 15000,
  });
  await page.waitForFunction(() => {
    const root = document.querySelector('#component-telemetry-drawer');
    return root?.querySelector('[data-race-telemetry-drawer]') &&
      root?.querySelector('[data-telemetry-drawer][aria-hidden="false"]') &&
      root?.querySelector('[data-simulation-speed]') &&
      root?.querySelector('[data-race-data-panel]') &&
      root?.querySelector('[data-timing-tower]');
  }, { timeout: 5000 });
  await assertNoPackageOverflow(page, 'components');
}

async function smokeCustomization(page, baseUrl) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${baseUrl}/customization.html`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#customization-race-root [data-paddock-component="race-canvas"].is-loaded', {
    state: 'attached',
    timeout: 15000,
  });
  await assertCanvasRendered(page, 'customization');
  const heading = await page.locator('h1').first().textContent();
  assert(heading.includes('Customize the package'), 'customization: expected first-class customization page heading');
  await page.waitForFunction(() => {
    const controller = window.__paddockPreviewControllers?.get?.('customization');
    return controller?.getSnapshot?.()?.cars?.length > 1 &&
      document.querySelector('#customization-overview [data-paddock-component="car-driver-overview"]') &&
      document.querySelector('#customization-race-data [data-paddock-component="race-data-panel"]') &&
      document.querySelector('#customization-component-race-controls [data-paddock-component="race-controls"]') &&
      document.querySelector('#customization-component-camera-controls [data-paddock-component="camera-controls"]') &&
      document.querySelector('#customization-component-timing-tower [data-paddock-component="timing-tower"]') &&
      document.querySelector('#customization-component-telemetry-core [data-paddock-component="telemetry-core"]') &&
      document.querySelector('[data-customization-snippet]')?.textContent?.includes('componentThemes');
  }, { timeout: 8000 });

  await page.locator('[data-theme-mode="light"]').click();
  await page.waitForFunction(() => {
    const snippet = document.querySelector('[data-customization-snippet]')?.textContent ?? '';
    return document.body.dataset.previewThemeMode === 'light' &&
      document.body.dataset.previewThemeSelection === 'light' &&
      snippet.includes('"mode": "light"');
  }, { timeout: 5000 });
  await assertCustomizationLightModeSurfaces(page);
  await assertCustomizationThemeSelectionStable(page);
  await assertCustomizationRaceDataPanelFilled(page);

  const primaryBefore = await page.locator('#customization-race-root [data-paddock-component="race-canvas"]').evaluate((node) => (
    getComputedStyle(node).getPropertyValue('--paddock-color-primary').trim()
  ));
  await page.locator('[data-theme-package="electric"]').click();
  await page.waitForFunction((previousPrimary) => {
    const canvas = document.querySelector('#customization-race-root [data-paddock-component="race-canvas"]');
    const snippet = document.querySelector('[data-customization-snippet]')?.textContent ?? '';
    const currentPrimary = canvas ? getComputedStyle(canvas).getPropertyValue('--paddock-color-primary').trim() : '';
    return currentPrimary &&
      currentPrimary !== previousPrimary &&
      snippet.includes('"use": "electric"');
  }, primaryBefore, { timeout: 5000 });

  await page.locator('[data-component-override="controls"]').check();
  await page.waitForFunction(() => {
    const controls = document.querySelector('#customization-component-race-controls [data-paddock-component="race-controls"]');
    const snippet = document.querySelector('[data-customization-snippet]')?.textContent ?? '';
    if (!controls) return false;
    const border = getComputedStyle(controls).getPropertyValue('--paddock-color-border').trim();
    return border.includes('241, 198, 91') &&
      snippet.includes('"raceControls": "carbon"') &&
      snippet.includes('"cameraControls": "carbon"');
  }, { timeout: 5000 });

  await page.locator('[data-customization-driver] [data-driver-id="core"]').click();
  await page.waitForFunction(() => {
    const controller = window.__paddockPreviewControllers?.get?.('customization');
    const overview = document.querySelector('#customization-overview [data-paddock-component="car-driver-overview"]');
    const primary = overview ? getComputedStyle(overview).getPropertyValue('--paddock-color-primary').trim() : '';
    return controller?.app?.selectedId === 'core' && primary === '#0b79b7';
  }, { timeout: 5000 });
  await assertNoPackageOverflow(page, 'customization');
}

async function assertCustomizationRaceDataPanelFilled(page) {
  const state = await page.evaluate(() => {
    const mount = document.querySelector('#customization-race-data');
    const panel = mount?.querySelector('[data-race-data-panel]');
    const mountBox = mount?.getBoundingClientRect?.();
    const panelBox = panel?.getBoundingClientRect?.();
    return {
      title: mount?.querySelector('[data-race-data-title]')?.textContent?.trim() ?? '',
      subtitle: mount?.querySelector('[data-race-data-subtitle]')?.textContent?.trim() ?? '',
      number: mount?.querySelector('[data-race-data-number]')?.textContent?.trim() ?? '',
      text: panel?.innerText?.trim() ?? '',
      className: panel?.className ?? '',
      fitsContent: Boolean(panel && panel.scrollWidth <= panel.clientWidth + 1),
      contained: Boolean(
        mountBox &&
        panelBox &&
        panelBox.width > 0 &&
        panelBox.height > 0 &&
        panelBox.left >= mountBox.left - 1 &&
        panelBox.right <= mountBox.right + 1 &&
        panelBox.top >= mountBox.top - 1 &&
        panelBox.bottom <= mountBox.bottom + 1
      ),
    };
  });

  assert(state.className.includes('race-data-panel--standalone'), 'customization race data: standalone component class was missing');
  assert(state.title === 'Budget Buddy', 'customization race data: expected selected driver title');
  assert(state.subtitle.includes('AI finance coach'), 'customization race data: expected selected driver project detail');
  assert(state.number === '71', 'customization race data: expected selected driver number');
  assert(state.text.includes('OPEN PROJECT'), 'customization race data: expected populated action text');
  assert(state.contained, 'customization race data: standalone panel escaped its host card');
  assert(state.fitsContent, 'customization race data: standalone panel content overflowed its host card');
}

async function readCustomizationThemeState(page) {
  return page.evaluate(() => {
    const readPrimary = (selector) => {
      const node = document.querySelector(selector);
      return node ? getComputedStyle(node).getPropertyValue('--paddock-color-primary').trim() : '';
    };
    return {
      selected: window.__paddockPreviewControllers?.get?.('customization')?.app?.selectedId ?? '',
      snippet: document.querySelector('[data-customization-snippet]')?.textContent ?? '',
      raceCanvas: readPrimary('#customization-race-root [data-paddock-component="race-canvas"]'),
      overview: readPrimary('#customization-overview [data-paddock-component="car-driver-overview"]'),
      raceData: readPrimary('#customization-race-data [data-paddock-component="race-data-panel"]'),
      timing: readPrimary('#customization-component-timing-tower [data-paddock-component="timing-tower"]'),
    };
  });
}

async function assertCustomizationThemeSelectionStable(page) {
  const initialBudget = await readCustomizationThemeState(page);
  assert(initialBudget.selected === 'budget', 'customization theme: expected Budget GP to start selected');
  assert(
    initialBudget.overview && initialBudget.raceData && initialBudget.timing,
    'customization theme: expected all selected-team component scopes to expose a primary color',
  );
  assert(
    initialBudget.overview !== initialBudget.raceCanvas &&
      initialBudget.raceData !== initialBudget.raceCanvas &&
      initialBudget.timing !== initialBudget.raceCanvas,
    'customization theme: selected-team component scopes fell back to the active package color after mode switch',
  );

  await page.locator('[data-customization-driver] [data-driver-id="core"]').click();
  await page.waitForFunction(() => (
    window.__paddockPreviewControllers?.get?.('customization')?.app?.selectedId === 'core'
  ), { timeout: 5000 });
  const core = await readCustomizationThemeState(page);
  assert(core.overview !== initialBudget.overview, 'customization theme: selected driver change did not update overview theme');
  assert(core.raceData !== initialBudget.raceData, 'customization theme: selected driver change did not update race-data theme');
  assert(core.timing !== initialBudget.timing, 'customization theme: selected driver change did not update timing theme');

  await page.locator('[data-customization-driver] [data-driver-id="budget"]').click();
  await page.waitForFunction(() => (
    window.__paddockPreviewControllers?.get?.('customization')?.app?.selectedId === 'budget'
  ), { timeout: 5000 });
  const roundTripBudget = await readCustomizationThemeState(page);
  assert(
    roundTripBudget.overview === initialBudget.overview &&
      roundTripBudget.raceData === initialBudget.raceData &&
      roundTripBudget.timing === initialBudget.timing,
    'customization theme: selected-team colors changed after selecting another driver and returning',
  );

  await page.locator('[data-component-override="timing"]').uncheck();
  await page.waitForFunction((packagePrimary) => {
    const timing = document.querySelector('#customization-component-timing-tower [data-paddock-component="timing-tower"]');
    const snippet = document.querySelector('[data-customization-snippet]')?.textContent ?? '';
    const primary = timing ? getComputedStyle(timing).getPropertyValue('--paddock-color-primary').trim() : '';
    return snippet.includes('"timingTower": "active"') && primary === packagePrimary;
  }, initialBudget.raceCanvas, { timeout: 5000 });
  const activeTiming = await readCustomizationThemeState(page);
  assert(
    activeTiming.overview === initialBudget.overview &&
      activeTiming.raceData === initialBudget.raceData,
    'customization theme: changing the timing override rewrote selected-driver component colors',
  );
  assert(
    activeTiming.timing === initialBudget.raceCanvas,
    'customization theme: timing tower kept a stale selected-team color after switching to active package',
  );

  await page.locator('[data-component-override="timing"]').check();
  await page.waitForFunction((selectedPrimary) => {
    const timing = document.querySelector('#customization-component-timing-tower [data-paddock-component="timing-tower"]');
    const snippet = document.querySelector('[data-customization-snippet]')?.textContent ?? '';
    const primary = timing ? getComputedStyle(timing).getPropertyValue('--paddock-color-primary').trim() : '';
    return snippet.includes('"timingTower": "selectedTeam"') && primary === selectedPrimary;
  }, initialBudget.timing, { timeout: 5000 });
}

async function assertCustomizationLightModeSurfaces(page) {
  await page.waitForFunction(() => (
    document.querySelectorAll('#customization-race-root .timing-row').length > 0 &&
    document.querySelector('#customization-race-root .start-lights .start-lights__gantry span') &&
    document.querySelector('#customization-component-race-controls .sim-control--safety') &&
    document.querySelector('#customization-race-data [data-paddock-component="race-data-panel"]') &&
    document.querySelector('#customization-race-root .steward-message')
  ), undefined, { timeout: 5000 });

  await page.evaluate(() => {
    const timingRows = Array.from(document.querySelectorAll('#customization-race-root .timing-row'));
    const dnfRow = timingRows[1] ?? timingRows[0];
    dnfRow?.classList.remove('is-selected');
    dnfRow?.classList.add('is-dnf');
    const dnfGap = dnfRow?.querySelector('.timing-gap');
    if (dnfGap) dnfGap.textContent = 'DNF';

    const startLights = document.querySelector('#customization-race-root .start-lights');
    startLights?.removeAttribute('hidden');
    startLights?.classList.remove('is-lights-out');
    const gantry = startLights?.querySelector('.start-lights__gantry');
    const litFixture = gantry?.querySelector('[data-smoke-lit-start-light]') ?? document.createElement('span');
    litFixture.dataset.smokeLitStartLight = 'true';
    litFixture.classList.add('is-lit');
    litFixture.style.transition = 'none';
    litFixture.style.position = 'absolute';
    litFixture.style.left = '-9999px';
    gantry?.appendChild(litFixture);

    const safetyHost = document.querySelector('#customization-component-race-controls [data-paddock-component="race-controls"]');
    const safetyControl = safetyHost?.querySelector('[data-smoke-active-safety-control]') ?? document.createElement('button');
    safetyControl.dataset.smokeActiveSafetyControl = 'true';
    safetyControl.className = 'sim-control sim-control--safety is-active';
    safetyControl.style.position = 'absolute';
    safetyControl.style.left = '-9999px';
    safetyHost?.appendChild(safetyControl);

    const telemetryPanel = document.querySelector('#customization-race-data [data-paddock-component="race-data-panel"]');
    const telemetrySector = document.querySelector('#customization-race-data .telemetry-sector-bar') ??
      telemetryPanel?.appendChild(document.createElement('div'));
    telemetrySector?.classList.add('telemetry-sector-bar');
    telemetrySector?.classList.add('is-active');
    telemetrySector?.style.setProperty('--sector-fill', '58%');

    const stewardHost = document.querySelector('#customization-race-root [data-paddock-component="race-canvas"]');
    const stewardMessage = stewardHost?.querySelector('[data-smoke-warning-steward-message]') ?? document.createElement('div');
    stewardMessage.dataset.smokeWarningStewardMessage = 'true';
    stewardMessage.className = 'steward-message is-warning';
    stewardMessage.style.position = 'absolute';
    stewardMessage.style.left = '-9999px';
    stewardHost?.appendChild(stewardMessage);
  });

  await page.waitForFunction(() => {
    const themeScope = document.querySelector('#customization-race-root [data-paddock-component="race-canvas"]');
    const litLight = document.querySelector('#customization-race-root .start-lights__gantry [data-smoke-lit-start-light].is-lit');
    if (!themeScope || !litLight) return false;
    const probe = document.createElement('span');
    probe.style.color = 'var(--race-control-red)';
    probe.hidden = true;
    themeScope.appendChild(probe);
    const expected = getComputedStyle(probe).color;
    probe.remove();
    return getComputedStyle(litLight).backgroundColor === expected;
  }, undefined, { timeout: 500 }).catch(() => {});

  const readLightModeState = () => {
    const read = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const style = getComputedStyle(node);
      return {
        color: style.color,
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        borderTopColor: style.borderTopColor,
        boxShadow: style.boxShadow,
      };
    };

    const resolveColor = (scope, value) => {
      if (!scope) return '';
      const probe = document.createElement('span');
      probe.style.color = value;
      probe.hidden = true;
      scope.appendChild(probe);
      const resolved = getComputedStyle(probe).color;
      probe.remove();
      return resolved;
    };

    const themeScope = document.querySelector('#customization-race-root [data-paddock-component="race-canvas"]') ??
      document.querySelector('.f1-sim-component[data-paddock-theme-mode="light"]');

    const readDnfTimingRow = () => {
      const row = document.querySelector('#customization-race-root .timing-row.is-dnf');
      const position = row?.querySelector('.timing-position');
      const gap = row?.querySelector('.timing-gap');
      if (!row || !position || !gap) return null;
      const rowStyle = getComputedStyle(row);
      const positionStyle = getComputedStyle(position);
      const gapStyle = getComputedStyle(gap);
      return {
        rowColor: rowStyle.color,
        positionColor: positionStyle.color,
        positionBackgroundColor: positionStyle.backgroundColor,
        gapColor: gapStyle.color,
      };
    };

    const readStartLights = () => {
      const panel = document.querySelector('#customization-race-root .start-lights');
      const litLight = panel?.querySelector('.start-lights__gantry [data-smoke-lit-start-light].is-lit');
      if (!panel || !litLight) return null;
      const litStyle = getComputedStyle(litLight);
      const litBackgroundColor = litStyle.backgroundColor;
      const litBorderColor = litStyle.borderTopColor;
      panel.classList.add('is-lights-out');
      const lightsOutStyle = getComputedStyle(litLight);
      const lightsOutBackgroundColor = lightsOutStyle.backgroundColor;
      panel.classList.remove('is-lights-out');
      return {
        litBackgroundColor,
        litBorderColor,
        lightsOutBackgroundColor,
      };
    };

    return {
      body: read('body'),
      cameraButton: read('#customization-component-camera-controls .camera-controls button'),
      timingFrame: read('#customization-component-timing-tower .broadcast-tower-frame'),
      overviewCell: read('#customization-overview .car-overview-cell'),
      raceDataPanel: read('#customization-race-data .race-data-panel'),
      expectedColors: {
        green: resolveColor(themeScope, 'var(--green)'),
        muted: resolveColor(themeScope, 'var(--muted)'),
        red: resolveColor(themeScope, 'var(--race-control-red)'),
        yellow: resolveColor(themeScope, 'var(--yellow)'),
      },
      dnfTimingRow: readDnfTimingRow(),
      litStartLights: readStartLights(),
      safetyControl: read('#customization-component-race-controls [data-smoke-active-safety-control].is-active'),
      telemetryActiveSector: read('#customization-race-data .telemetry-sector-bar.is-active'),
      stewardWarning: read('#customization-race-root [data-smoke-warning-steward-message].is-warning'),
    };
  };
  const isLightModeResolved = (lightModeState) => (
    !lightModeState.body?.color.includes('244, 241, 234') &&
    !lightModeState.cameraButton?.borderTopColor.includes('255, 255, 255') &&
    !lightModeState.timingFrame?.backgroundImage.includes('10, 21, 39') &&
    !lightModeState.overviewCell?.backgroundColor.includes('8, 9, 11') &&
    !lightModeState.raceDataPanel?.backgroundImage.includes('10, 13, 22')
  );

  await page.waitForFunction(() => {
    const read = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const style = getComputedStyle(node);
      return {
        color: style.color,
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        borderTopColor: style.borderTopColor,
      };
    };
    const lightModeState = {
      body: read('body'),
      cameraButton: read('#customization-component-camera-controls .camera-controls button'),
      timingFrame: read('#customization-component-timing-tower .broadcast-tower-frame'),
      overviewCell: read('#customization-overview .car-overview-cell'),
      raceDataPanel: read('#customization-race-data .race-data-panel'),
    };
    return !lightModeState.body?.color.includes('244, 241, 234') &&
      !lightModeState.cameraButton?.borderTopColor.includes('255, 255, 255') &&
      !lightModeState.timingFrame?.backgroundImage.includes('10, 21, 39') &&
      !lightModeState.overviewCell?.backgroundColor.includes('8, 9, 11') &&
      !lightModeState.raceDataPanel?.backgroundImage.includes('10, 13, 22');
  }, { timeout: 1200 }).catch(() => {});

  const lightModeState = await page.evaluate(readLightModeState);

  assert(
    !lightModeState.body?.color.includes('244, 241, 234'),
    'customization light mode: host page text stayed on the dark off-white color',
  );
  assert(
    !lightModeState.cameraButton?.borderTopColor.includes('255, 255, 255'),
    'customization light mode: camera button border stayed on the dark white-border color',
  );
  assert(
    !lightModeState.timingFrame?.backgroundImage.includes('10, 21, 39'),
    'customization light mode: timing tower frame kept the dark broadcast gradient',
  );
  assert(
    !lightModeState.overviewCell?.backgroundColor.includes('8, 9, 11'),
    'customization light mode: selected-driver overview cells kept the dark cell surface',
  );
  assert(
    !lightModeState.raceDataPanel?.backgroundImage.includes('10, 13, 22'),
    'customization light mode: race data panel kept the dark broadcast gradient',
  );
  assert(isLightModeResolved(lightModeState), 'customization light mode: expected all sampled surfaces to resolve light colors');
  assert(lightModeState.dnfTimingRow, 'customization light mode: expected a forced DNF timing row fixture');
  assert(
    lightModeState.dnfTimingRow.rowColor === lightModeState.expectedColors.muted,
    'customization light mode: DNF row did not resolve to the muted theme color',
  );
  assert(
    lightModeState.dnfTimingRow.gapColor === lightModeState.dnfTimingRow.rowColor,
    'customization light mode: DNF gap text did not inherit the muted DNF row color',
  );
  assert(
    lightModeState.dnfTimingRow.positionColor === lightModeState.dnfTimingRow.rowColor,
    'customization light mode: DNF position text did not inherit the muted DNF row color',
  );
  assert(
    !lightModeState.dnfTimingRow.positionBackgroundColor.includes('30, 35, 44'),
    'customization light mode: DNF position badge kept the dark-mode background',
  );
  assert(lightModeState.litStartLights, 'customization light mode: expected a forced lit start-light fixture');
  assert(
    lightModeState.litStartLights.litBackgroundColor === lightModeState.expectedColors.red,
    'customization light mode: lit start lights did not stay race-control red',
  );
  assert(
    lightModeState.litStartLights.lightsOutBackgroundColor !== lightModeState.expectedColors.red,
    'customization light mode: lights-out bulbs stayed race-control red',
  );
  assert(
    lightModeState.safetyControl?.backgroundColor === lightModeState.expectedColors.yellow,
    'customization light mode: active safety-car control did not stay yellow',
  );
  assert(
    lightModeState.telemetryActiveSector?.borderTopColor === lightModeState.expectedColors.green,
    'customization light mode: active telemetry sector did not keep the green state border',
  );
  assert(
    lightModeState.stewardWarning?.borderTopColor === lightModeState.expectedColors.yellow,
    'customization light mode: warning steward message did not keep its yellow state treatment',
  );
}

async function smokeInitialLoadingPlaceholders(page, baseUrl) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route('**/assets/main-*.js', (route) => route.abort());
  await page.goto(`${baseUrl}${deterministicTemplatesPath}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const root = document.querySelector('#template-complete-root');
    const header = document.querySelector('.site-header');
    return root?.childElementCount === 0 &&
      getComputedStyle(root, '::before').content.includes('Loading simulator') &&
      getComputedStyle(header).display === 'flex';
  }, { timeout: 5000 });
  const placeholder = await page.evaluate(() => {
    const root = document.querySelector('#template-complete-root');
    const header = document.querySelector('.site-header');
    return {
      rootEmpty: root?.childElementCount === 0,
      rootMinHeight: root ? getComputedStyle(root).minHeight : '',
      rootBackground: root ? getComputedStyle(root).backgroundColor : '',
      rootBeforeContent: root ? getComputedStyle(root, '::before').content : '',
      rootBeforeBackground: root ? getComputedStyle(root, '::before').backgroundColor : '',
      headerDisplay: header ? getComputedStyle(header).display : '',
    };
  });
  assert(placeholder.headerDisplay === 'flex', 'initial loading: host stylesheet was not applied before JS');
  assert(placeholder.rootEmpty, 'initial loading: simulator root should remain empty when JS is blocked');
  assert(placeholder.rootBackground === 'rgb(0, 0, 0)', 'initial loading: root loading surface should be black');
  assert(placeholder.rootBeforeBackground === 'rgb(0, 0, 0)', 'initial loading: loading overlay should be black');
  assert(placeholder.rootBeforeContent.includes('Loading simulator'), 'initial loading: expected CSS loading placeholder');
  assert(parseFloat(placeholder.rootMinHeight) >= 400, 'initial loading: placeholder should reserve simulator height');
  await page.unroute('**/assets/main-*.js');
}

async function smokeSingleLoadingOverlay(page, baseUrl) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  let delayedStartupAsset = false;
  await page.route('**/*f1-car-sprite-game*', async (route) => {
    if (!delayedStartupAsset) {
      delayedStartupAsset = true;
      await delay(startupAssetDelayMs);
    }
    await route.continue().catch(() => {});
  });
  await page.goto(`${baseUrl}${deterministicTemplatesPath}`, { waitUntil: 'domcontentloaded' });
  await page.locator('#template-complete-root').scrollIntoViewIfNeeded();
  await page.waitForSelector('#template-complete-root [data-paddock-loading]', { state: 'attached', timeout: 10000 });
  const loadingState = await page.evaluate(() => {
    const root = document.querySelector('#template-complete-root');
    const packageLoading = root?.querySelector('[data-paddock-loading]');
    const afterStyle = root ? getComputedStyle(root, '::after') : null;
    return {
      rootBeforeContent: root ? getComputedStyle(root, '::before').content : '',
      rootAfterAnimation: afterStyle ? afterStyle.animationName : '',
      rootAfterBackground: afterStyle ? afterStyle.backgroundImage : '',
      packageLoadingDisplay: packageLoading ? getComputedStyle(packageLoading).display : '',
    };
  });
  assert(loadingState.rootBeforeContent.includes('Loading simulator'), 'single loading: expected host loading overlay');
  assert(loadingState.rootAfterAnimation === 'preview-loading-lights', 'single loading: expected lightweight animation');
  assert((loadingState.rootAfterBackground.match(/radial-gradient/g) ?? []).length === 4, 'single loading: expected four start lights');
  assert(loadingState.packageLoadingDisplay === 'none', 'single loading: package loading overlay should be hidden in preview');
  await page.unroute('**/*f1-car-sprite-game*');
  await page.waitForSelector('#template-complete-root [data-paddock-component="race-canvas"].is-loaded', {
    state: 'attached',
    timeout: 15000,
  });
  const readyState = await page.evaluate(() => {
    const root = document.querySelector('#template-complete-root');
    return {
      rootBeforeContent: root ? getComputedStyle(root, '::before').content : '',
      rootAfterAnimation: root ? getComputedStyle(root, '::after').animationName : '',
    };
  });
  assert(!readyState.rootBeforeContent.includes('Loading simulator'), 'single loading: host loading overlay should clear once the simulator is ready');
  assert(readyState.rootAfterAnimation === 'none', 'single loading: host loading animation should stop once the simulator is ready');
}

async function smokeApi(page, baseUrl) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${baseUrl}/api.html`, { waitUntil: 'networkidle' });
  await assertCanvasRendered(page, 'api');
  await page.waitForFunction(() => window.__paddockPreviewControllers?.get?.('api-target')?.getSnapshot?.()?.cars?.length > 0);
  const driverButtons = await page.locator('.driver-button-grid [data-driver-id]').evaluateAll((buttons) => (
    buttons.map((button) => button.dataset.driverId)
  ));
  assert(driverButtons.length === 10, `api: expected 10 host driver buttons, got ${driverButtons.length}`);
  for (const driverId of driverButtons) {
    await page.locator(`.driver-button-grid [data-driver-id="${driverId}"]`).click();
    await page.waitForFunction((selectedDriverId) => {
      const controller = window.__paddockPreviewControllers?.get?.('api-target');
      const readout = document.querySelector('[data-preview-snapshot]')?.textContent ?? '';
      return controller?.app?.selectedId === selectedDriverId &&
        readout.includes('"selectedDriver"') &&
        readout.includes(`"id": "${selectedDriverId}"`);
    }, driverId, { timeout: 5000 });
  }
  await clickApiAction(page, 'snapshot');
  await page.waitForFunction(() => {
    const text = document.querySelector('[data-preview-snapshot]')?.textContent ?? '';
    return text.includes('"mode"') && text.includes('"pitLaneStatus"') && text.includes('"firstPenalty"');
  });
  const seedBeforeRestart = await page.evaluate(() => window.__paddockPreviewControllers.get('api-target').options.seed);
  await clickApiAction(page, 'restart');
  await page.waitForFunction((previousSeed) => {
    const controller = window.__paddockPreviewControllers.get('api-target');
    const text = document.querySelector('[data-preview-snapshot]')?.textContent ?? '';
    return controller.options.seed !== previousSeed && text.includes(`"seed": ${controller.options.seed}`);
  }, seedBeforeRestart, { timeout: 5000 });
  await page.waitForFunction(() => {
    const controller = window.__paddockPreviewControllers.get('api-target');
    return controller.getSnapshot().raceControl.mode !== 'pre-start';
  }, { timeout: 8000 });
  await clickApiAction(page, 'snapshot');
  await clickApiAction(page, 'safety');
  await page.waitForFunction(() => {
    const controller = window.__paddockPreviewControllers.get('api-target');
    const text = document.querySelector('[data-preview-snapshot]')?.textContent ?? '';
    return controller.getSnapshot().raceControl.mode === 'safety-car' &&
      text.includes('"mode": "safety-car"') &&
      text.includes('"safetyCar": true');
  }, { timeout: 5000 });
  await clickApiAction(page, 'safety');
  await page.waitForFunction(() => {
    const controller = window.__paddockPreviewControllers.get('api-target');
    const text = document.querySelector('[data-preview-snapshot]')?.textContent ?? '';
    return controller.getSnapshot().raceControl.mode !== 'safety-car' &&
      text.includes('"safetyCar": false');
  }, { timeout: 5000 });
  await clickApiAction(page, 'red-flag');
  await page.waitForFunction(() => {
    const text = document.querySelector('[data-preview-snapshot]')?.textContent ?? '';
    return text.includes('"redFlag": true') && text.includes('"reason": "red-flag"');
  }, { timeout: 5000 });
  await clickApiAction(page, 'red-flag');
  await page.waitForFunction(() => {
    const text = document.querySelector('[data-preview-snapshot]')?.textContent ?? '';
    return text.includes('"redFlag": false') && text.includes('"reason": "open"');
  }, { timeout: 5000 });
  await clickApiAction(page, 'pit-lane');
  await page.waitForFunction(() => {
    const text = document.querySelector('[data-preview-snapshot]')?.textContent ?? '';
    return text.includes('"pitLaneOpen": false') && text.includes('"reason": "closed"');
  }, { timeout: 5000 });
  await clickApiAction(page, 'pit-lane');
  await page.waitForFunction(() => {
    const text = document.querySelector('[data-preview-snapshot]')?.textContent ?? '';
    return text.includes('"pitLaneOpen": true') && text.includes('"reason": "open"');
  }, { timeout: 5000 });
  await clickApiAction(page, 'pit-intent');
  await page.waitForFunction(() => {
    const text = document.querySelector('[data-preview-snapshot]')?.textContent ?? '';
    return text.includes('"pitIntent": 2') && text.includes('"targetCompound": "M"');
  }, { timeout: 5000 });
  await page.locator('[data-action="pit-clear"]').click();
  await page.waitForFunction(() => {
    const text = document.querySelector('[data-preview-snapshot]')?.textContent ?? '';
    return text.includes('"pitIntent": 0');
  }, { timeout: 5000 });
  await page.locator('[data-action="force-penalty"]').click();
  await clickApiAction(page, 'serve-penalty');
  await page.waitForFunction(() => {
    const text = document.querySelector('[data-preview-snapshot]')?.textContent ?? '';
    return text.includes('"status": "served"') && text.includes('"serviceType": "driveThrough"');
  }, { timeout: 5000 });
  await clickApiAction(page, 'cancel-penalty');
  await page.waitForFunction(() => {
    const text = document.querySelector('[data-preview-snapshot]')?.textContent ?? '';
    return text.includes('"status": "cancelled"') && text.includes('"penaltySeconds": 0');
  }, { timeout: 5000 });
  await assertNoPackageOverflow(page, 'api');
}

async function clickApiAction(page, action) {
  await page.locator(`[data-action="${action}"]`).evaluate((button) => button.click());
}

async function smokePolicyRunner(page, baseUrl) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${baseUrl}/policy-runner.html`, { waitUntil: 'networkidle' });
  await assertCanvasRendered(page, 'policy runner');
  await page.waitForFunction(() => {
    const controller = window.__paddockPreviewControllers?.get?.('policy-runner');
    const snapshot = controller?.getSnapshot?.();
    const batchCars = snapshot?.cars?.filter((car) => car.interaction?.profile === 'batch-training') ?? [];
    return snapshot?.cars?.length > 1 &&
      snapshot?.replayGhosts?.length === 0 &&
      batchCars.length === snapshot.cars.length &&
      batchCars.every((car) => car.interaction?.collidable === false &&
        car.interaction?.detectableByRays === false &&
        car.interaction?.detectableAsNearby === false &&
        car.interaction?.affectsRaceOrder === false);
  }, { timeout: 5000 });
  const legendText = await page.locator('.ghost-demo-note').textContent();
  assert(
    legendText.includes('No-collision markers') &&
      legendText.includes('do not collide') &&
      legendText.includes('blue outline marker'),
    'policy runner: expected visible no-collision legend',
  );
  const before = await page.locator('[data-policy-runner-readout]').textContent();
  await page.locator('[data-policy-runner-step]').click();
  await page.waitForFunction((previous) => {
    const text = document.querySelector('[data-policy-runner-readout]')?.textContent ?? '';
    return text !== previous && text.includes('"policyStep": 1') &&
      text.includes('"visualFrame": 4') &&
      text.includes('"visualFrameSkip": 4') && text.includes('"step": 4') &&
      text.includes('"frameMetrics"') && text.includes('"lastExpertStepMs"') &&
      text.includes('"action"') &&
      text.includes('"actionSpec"') && text.includes('"observationSpec"') &&
      text.includes('"configuration": "generation"') &&
      text.includes('"profile": "physical-driver"');
  }, before);
  const frameCounter = page.locator('[data-policy-frame-counter]');
  const visualFrameMetric = await frameCounter.locator('[data-advanced-fps-metric="visualFrame"]').textContent();
  const simStepMetric = await frameCounter.locator('[data-advanced-fps-metric="simStep"]').textContent();
  const policyStepMetric = await frameCounter.locator('[data-advanced-fps-metric="policyStep"]').textContent();
  const fpsMetric = await frameCounter.locator('[data-advanced-fps-metric="visualFps"]').textContent();
  assert(
    visualFrameMetric === '4' &&
      simStepMetric === '4' &&
      policyStepMetric === '1' &&
      fpsMetric?.endsWith('fps'),
    'policy runner: expected visible visual/sim/policy frame counter',
  );
  const speedButton = page.locator('[data-simulation-speed]').first();
  assert(await speedButton.count() === 1, 'policy runner: expected simulation speed control');
  assert((await speedButton.textContent())?.trim() === '1x', 'policy runner: expected initial 1x simulation speed');
  await speedButton.click();
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-simulation-speed]');
    return button?.textContent?.trim() === '2x';
  }, { timeout: 5000 });
  const speedReadoutBefore = JSON.parse(await page.locator('[data-policy-runner-readout]').textContent());
  await page.locator('[data-policy-runner-auto]').check();
  await page.waitForFunction(({ previousVisualFrame, previousPolicyStep }) => {
    const text = document.querySelector('[data-policy-runner-readout]')?.textContent ?? '{}';
    const readout = JSON.parse(text);
    const visualFrameDelta = readout.visualFrame - previousVisualFrame;
    const policyStepDelta = readout.policyStep - previousPolicyStep;
    return readout.playbackSpeed === 2 &&
      visualFrameDelta >= 8 &&
      policyStepDelta === Math.ceil(visualFrameDelta / 4);
  }, {
    previousVisualFrame: speedReadoutBefore.visualFrame,
    previousPolicyStep: speedReadoutBefore.policyStep,
  }, { timeout: 5000 });
  await page.locator('[data-policy-runner-auto]').uncheck();
  const sensesText = await page.locator('[data-policy-senses]').textContent();
  assert(
    sensesText.includes('Car body') &&
      sensesText.includes('Track relationship') &&
      sensesText.includes('Contact patches') &&
      sensesText.includes('Opponent radar') &&
      sensesText.includes('Rays') &&
      sensesText.includes('Ray channels') &&
      sensesText.includes('illegalSurface') &&
      !sensesText.includes('barrier hit') &&
      (sensesText.includes('simulator') || sensesText.includes('arcade')),
    'policy runner: expected visible physical-driver senses panel',
  );
  const activeReadout = JSON.parse(await page.locator('[data-policy-runner-readout]').textContent());
  const rayChannels = activeReadout.observationSpec?.object?.rays?.channels ?? [];
  assert(
    rayChannels.includes('illegalSurface') && !rayChannels.includes('barrier'),
    'policy runner: active observation spec must expose illegalSurface but not barrier ray channel',
  );
  const firstRay = activeReadout.rays?.[0] ?? {};
  assert(
    Object.hasOwn(firstRay, 'illegalSurface') && !Object.hasOwn(firstRay, 'barrier'),
    'policy runner: active ray object must not expose barrier hits',
  );
  await page.locator('[data-policy-configuration-select]').selectOption('race');
  await page.waitForFunction(() => {
    const controller = window.__paddockPreviewControllers?.get?.('policy-runner');
    const snapshot = controller?.getSnapshot?.();
    return snapshot?.cars?.length > 1 &&
      snapshot?.replayGhosts?.length === 0 &&
      snapshot.cars.every((car) => car.interaction?.collidable !== false);
  }, { timeout: 5000 });

  const distilledPolicyAvailable = await Promise.all([
    `${baseUrl}/local-checkpoints/latest-distilled-policy.json`,
    `${baseUrl}/local-checkpoints/latest-hybrid-policy.json`,
  ].map((url) => fetch(url)
    .then(async (response) => {
      if (!response.ok) return false;
      const payload = await response.json().catch(() => null);
      return Boolean((payload?.weights && payload?.model) || Array.isArray(payload?.layers));
    })
    .catch(() => false)))
    .then((results) => results.some(Boolean))
    .catch(() => false);
  if (distilledPolicyAvailable) {
    await page.waitForFunction(() => {
      const controller = window.__paddockPreviewControllers?.get?.('policy-runner');
      const text = document.querySelector('[data-policy-runner-readout]')?.textContent ?? '';
      return controller?.getSnapshot?.()?.cars?.length >= 1 &&
        text.includes('"loadedDistilledPolicy": true') &&
        (text.includes('paddockjs-distilled-policy-v1') || text.includes('paddockjs-distilled-actor-v1'));
    }, { timeout: 10000 });
    const checkpointBefore = await page.locator('[data-policy-runner-readout]').textContent();
    await page.locator('[data-policy-runner-step]').click();
    await page.waitForFunction((previous) => {
      const text = document.querySelector('[data-policy-runner-readout]')?.textContent ?? '';
      return text !== previous && text.includes('"policyStep": 1') && text.includes('"action"') &&
      text.includes('"speedKph"');
    }, checkpointBefore, { timeout: 5000 });
  } else {
    const checkpointText = await page.locator('[data-policy-runner-readout]').textContent();
    assert(
      checkpointText.includes('"loadedDistilledPolicy": false'),
      'policy runner: expected idle distilled-policy state when no exported policy exists',
    );
  }
  await assertNoPackageOverflow(page, 'policy runner');
}

async function smokePlayable(page, baseUrl) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${baseUrl}/playable.html`, { waitUntil: 'networkidle' });
  await assertCanvasRendered(page, 'playable');
  await page.waitForFunction(() => {
    const controller = window.__paddockPreviewControllers?.get?.('playable');
    const snapshot = controller?.getSnapshot?.();
    const text = document.querySelector('[data-playable-readout]')?.textContent ?? '{}';
    const readout = JSON.parse(text);
    return snapshot?.cars?.length > 1 &&
      readout.running === true &&
      readout.playerId &&
      snapshot.cars.some((car) => car.id === readout.playerId);
  }, { timeout: 8000 });
  const driverCameraState = await page.locator('[data-camera-mode="driver"]').first().evaluate((button) => ({
    hidden: button.hidden,
    pressed: button.getAttribute('aria-pressed'),
  }));
  assert(driverCameraState.hidden === false, 'playable: expected driver camera button to be visible');
  assert(driverCameraState.pressed === 'true', 'playable: expected driver camera button to be active');
  await page.waitForFunction(() => {
    const builtInFps = Number(document.querySelector('[data-fps-readout]')?.textContent?.trim() ?? 0);
    const playerLoopFpsText = document
      .querySelector('[data-playable-frame-counter] [data-advanced-fps-metric="visualFps"]')
      ?.textContent
      ?.trim() ?? '';
    const playerLoopFps = Number(playerLoopFpsText.replace('fps', ''));
    return builtInFps > 0 && builtInFps <= 70 && playerLoopFps > 0 && playerLoopFps <= 70;
  }, { timeout: 5000 });

  const before = JSON.parse(await page.locator('[data-playable-readout]').textContent());
  await page.keyboard.down('w');
  await page.keyboard.down('ArrowRight');
  await page.waitForFunction((previousSpeedKph) => {
    const text = document.querySelector('[data-playable-readout]')?.textContent ?? '{}';
    const readout = JSON.parse(text);
    return readout.action?.throttle === 1 &&
      readout.action?.steering === 1 &&
      readout.pressedKeys?.includes('w') &&
      readout.pressedKeys?.includes('arrowright') &&
      readout.appliedControls?.throttle === 1 &&
      readout.speedKph > previousSpeedKph;
  }, before.speedKph, { timeout: 5000 });
  await page.keyboard.up('ArrowRight');
  await page.keyboard.up('w');
  await page.waitForFunction(() => {
    const text = document.querySelector('[data-playable-readout]')?.textContent ?? '{}';
    const readout = JSON.parse(text);
    return readout.action?.throttle === 0 &&
      readout.action?.steering === 0 &&
      readout.pressedKeys?.length === 0;
  }, { timeout: 5000 });
  await page.keyboard.press('p');
  await page.keyboard.press('2');
  await page.waitForFunction(() => {
    const text = document.querySelector('[data-playable-readout]')?.textContent ?? '{}';
    const readout = JSON.parse(text);
    const pitText = document.querySelector('[data-playable-pit-state]')?.textContent ?? '';
    return readout.action?.pitIntent === 1 &&
      readout.action?.pitCompound === 'M' &&
      readout.pitIntent === 1 &&
      readout.pitTargetCompound === 'M' &&
      pitText.includes('Intent: request') &&
      pitText.includes('Target: M');
  }, { timeout: 5000 });
  await page.keyboard.press('o');
  await page.waitForFunction(() => {
    const text = document.querySelector('[data-playable-readout]')?.textContent ?? '{}';
    const readout = JSON.parse(text);
    return readout.action?.pitIntent === 2 && readout.pitIntent === 2;
  }, { timeout: 5000 });
  await page.keyboard.press('x');
  await page.waitForFunction(() => {
    const text = document.querySelector('[data-playable-readout]')?.textContent ?? '{}';
    const readout = JSON.parse(text);
    return readout.action?.pitIntent === 0 && !Object.hasOwn(readout.action ?? {}, 'pitCompound');
  }, { timeout: 5000 });
  await page.locator('[data-playable-pause]').click();
  await page.waitForFunction(() => {
    const text = document.querySelector('[data-playable-readout]')?.textContent ?? '{}';
    const readout = JSON.parse(text);
    return readout.running === false;
  }, { timeout: 5000 });
  await assertNoPackageOverflow(page, 'playable');
}

async function smokeBehavior(page, baseUrl) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${baseUrl}/behavior.html`, { waitUntil: 'networkidle' });
  await assertCanvasRendered(page, 'behavior');
  const heading = await page.locator('h1').first().textContent();
  assert(heading.includes('Behavior a host can rely on'), 'behavior: expected original behavior page heading');
  await page.locator('#behavior-finish-root').evaluate((node) => {
    node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  });
  await page.waitForFunction(() => {
    const text = document.querySelector('[data-finish-snapshot]')?.textContent ?? '';
    return text.includes('"finished": true') && text.includes('"classification"');
  });
  const finishPanelText = await page.locator('#behavior-finish-root [data-race-finish-panel]:visible').textContent();
  assert(
    finishPanelText.includes('Race winner') && finishPanelText.includes('BUD'),
    'behavior: expected visible race winner panel',
  );
  await assertRacePanelFillsRoot(page, '#behavior-finish-root', 'behavior finish race window');
  await assertNoPackageOverflow(page, 'behavior');
}

async function smokeStewarding(page, baseUrl) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${baseUrl}/stewarding.html`, { waitUntil: 'networkidle' });
  await assertCanvasRendered(page, 'stewarding');
  await page.waitForFunction(() => {
    const text = document.querySelector('[data-penalty-snapshot]')?.textContent ?? '';
    return text.includes('track-limits') && text.includes('"mode": "green"') &&
      text.includes('"winner": null') && text.includes('"penaltySeconds": 5');
  });
  const timingPenaltyBadgeCount = await page.locator('.timing-penalty-badge').count();
  assert(timingPenaltyBadgeCount > 0, 'stewarding: expected timing penalty badge');
  await page.waitForSelector('[data-steward-message]', { state: 'attached', timeout: 5000 });
  const stewardMessage = await page.locator('[data-steward-message]').first().evaluate((node) => ({
    hidden: node.classList.contains('is-hidden'),
    text: node.textContent ?? '',
  }));
  if (!stewardMessage.hidden) {
    assert(
      stewardMessage.text.includes('+5s') &&
        stewardMessage.text.includes('BUD time penalty') &&
        stewardMessage.text.includes('Track Limits'),
      'stewarding: expected visible steward message text',
    );
  }
  const finishPanelVisible = await page.locator('[data-race-finish-panel]:visible').count();
  assert(finishPanelVisible === 0, 'stewarding: race finish banner should not be visible');
  await assertNoPackageOverflow(page, 'stewarding');
}

async function smokeCollisionLab(page, baseUrl) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${baseUrl}/collision-lab.html`, { waitUntil: 'networkidle' });
  const canvas = page.locator('[data-collision-lab-canvas]');
  await canvas.waitFor({ state: 'visible', timeout: 10000 });

  const rendered = await canvas.evaluate((node) => {
    const context = node.getContext('2d', { willReadFrequently: true });
    const points = [
      [Math.floor(node.width * 0.5), Math.floor(node.height * 0.5)],
      [Math.floor(node.width * 0.35), Math.floor(node.height * 0.5)],
      [Math.floor(node.width * 0.5), Math.floor(node.height * 0.72)],
      [Math.floor(node.width * 0.5), Math.floor(node.height * 0.28)],
    ];
    return points.some(([x, y]) => {
      const pixel = context.getImageData(x, y, 1, 1).data;
      return pixel[0] !== 0 || pixel[1] !== 0 || pixel[2] !== 0 || pixel[3] !== 0;
    });
  });
  assert(rendered, 'collision lab: expected non-empty overlay canvas');

  async function applyScenario(name) {
    await page.locator(`[data-collision-scenario="${name}"]`).click();
    await page.waitForFunction((scenarioName) => {
      const text = document.querySelector('[data-collision-lab-readout]')?.textContent ?? '';
      if (!text.includes('"cars"')) return false;
      const snapshot = window.__paddockCollisionLab?.snapshot;
      if (!snapshot) return false;
      if (scenarioName === 'near-miss') return snapshot.collision === null;
      if (scenarioName === 'body-body') return snapshot.collision?.contactType === 'body-body';
      if (scenarioName === 'wheel-body') return snapshot.collision === null;
      return true;
    }, name);
    return page.evaluate(() => window.__paddockCollisionLab.snapshot);
  }

  const bodyBody = await applyScenario('body-body');
  assert(bodyBody.collision.contactType === 'body-body', 'collision lab: body/body scenario should collide by body geometry');
  assert(bodyBody.collision.timeOfImpact >= 0 && bodyBody.collision.timeOfImpact <= 1, 'collision lab: expected valid time of impact');

  const wheelBody = await applyScenario('wheel-body');
  assert(wheelBody.collision === null, 'collision lab: wheel/body-only contact should be ignored by body-only collision');

  const nearMiss = await applyScenario('near-miss');
  assert(nearMiss.collision === null, 'collision lab: near miss should not collide');

  const oneKerb = await applyScenario('one-kerb');
  assert(oneKerb.cars.alpha.surface === 'kerb', 'collision lab: one-kerb should produce kerb effective surface');
  assert(!oneKerb.cars.alpha.trackLimits.violating, 'collision lab: one kerb wheel should stay inside track limits');

  const oneGravel = await applyScenario('one-gravel');
  assert(oneGravel.cars.alpha.surface === 'gravel', 'collision lab: one-gravel should produce gravel effective surface');
  assert(!oneGravel.cars.alpha.trackLimits.violating, 'collision lab: one gravel wheel should not violate while other wheels remain inside');

  const allOutside = await applyScenario('all-outside');
  assert(allOutside.cars.alpha.trackLimits.violating, 'collision lab: all wheels outside should violate track limits');

  const diagonal = await applyScenario('diagonal-transition');
  assert(!diagonal.cars.alpha.trackLimits.violating, 'collision lab: diagonal transition should not violate before every patch is fully outside');
  await assertNoPackageOverflow(page, 'collision lab');
}

async function smokeQuick(page, baseUrl) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${baseUrl}${deterministicTemplatesPath}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#template-complete-root [data-paddock-component="race-canvas"].is-loaded', {
    state: 'attached',
    timeout: 15000,
  });
  await assertCanvasRendered(page, 'quick templates');
  await assertNoPackageOverflow(page, 'quick templates');

  await page.goto(`${baseUrl}/api.html`, { waitUntil: 'networkidle' });
  await assertCanvasRendered(page, 'quick api');
  await clickApiAction(page, 'safety');
  await page.waitForFunction(() => {
    const controller = window.__paddockPreviewControllers.get('api-target');
    const text = document.querySelector('[data-preview-snapshot]')?.textContent ?? '';
    return controller.getSnapshot().raceControl.mode === 'safety-car' &&
      text.includes('"mode": "safety-car"');
  }, { timeout: 5000 });
  await assertNoPackageOverflow(page, 'quick api');

  await page.goto(`${baseUrl}/customization.html`, { waitUntil: 'networkidle' });
  await assertCanvasRendered(page, 'quick customization');
  await page.locator('[data-theme-mode="light"]').click();
  await page.waitForFunction(() => document.body.dataset.previewThemeMode === 'light', { timeout: 5000 });
  await assertCustomizationLightModeSurfaces(page);
  await assertCustomizationThemeSelectionStable(page);
  await assertCustomizationRaceDataPanelFilled(page);
  await page.locator('[data-theme-package="mint"]').click();
  await page.waitForFunction(() => {
    const snippet = document.querySelector('[data-customization-snippet]')?.textContent ?? '';
    return snippet.includes('"use": "mint"') &&
      document.querySelector('#customization-component-timing-tower [data-paddock-component="timing-tower"]');
  }, { timeout: 5000 });
  await assertNoPackageOverflow(page, 'quick customization');
}

async function runBrowserTask(browser, baseUrl, name, task) {
  const page = await browser.newPage();
  try {
    console.log(`[browser-smoke] ${name}`);
    await task(page, baseUrl);
  } finally {
    await page.close();
  }
}

async function runBrowserTasks(browser, baseUrl, tasks, concurrency = 3) {
  for (let index = 0; index < tasks.length; index += concurrency) {
    const chunk = tasks.slice(index, index + concurrency);
    await Promise.all(chunk.map(([name, task]) => runBrowserTask(browser, baseUrl, name, task)));
  }
}

async function main() {
  if (!existsSync(resolve(previewRoot, 'node_modules'))) {
    run('npm', ['--prefix', previewRoot, 'ci']);
  }
  if (skipBuild) {
    assert(existsSync(previewDistIndex), 'browser smoke --skip-build requires local-preview/dist to exist');
  } else {
    run('npm', ['--prefix', previewRoot, 'run', 'build']);
  }

  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = startPreviewServer(port);
  let browser = null;
  let passed = false;

  try {
    await waitForHttp(baseUrl);
    browser = await chromium.launch();
    if (quickMode) {
      await runBrowserTask(browser, baseUrl, 'quick browser smoke', smokeQuick);
    } else {
      await runBrowserTasks(browser, baseUrl, [
        ['initial loading placeholders', smokeInitialLoadingPlaceholders],
        ['single loading overlay', smokeSingleLoadingOverlay],
      ], 2);
      await runBrowserTasks(browser, baseUrl, [
        ['templates desktop', (page, url) => smokeTemplates(page, url, { width: 1440, height: 1000 }, 'desktop')],
        ['templates mobile', (page, url) => smokeTemplates(page, url, { width: 390, height: 900 }, 'mobile')],
        ['components', smokeComponents],
        ['customization', smokeCustomization],
        ['api', smokeApi],
        ['playable', smokePlayable],
        ['policy runner', smokePolicyRunner],
        ['behavior', smokeBehavior],
        ['stewarding', smokeStewarding],
        ['collision lab', smokeCollisionLab],
      ]);
    }
    passed = true;
  } finally {
    await browser?.close();
    await stopPreviewServer(server);
  }
  if (passed) {
    console.log('[browser-smoke] browser smoke checks passed');
  }
}

main().catch((error) => {
  console.error('[browser-smoke] failed');
  console.error(error);
  process.exitCode = 1;
});
