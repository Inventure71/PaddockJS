#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const previewRoot = resolve(repoRoot, 'local-preview');
const deterministicTemplatesPath = '/templates.html?completeTrackSeed=20260430';

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
        ...pitLane.entry.roadCenterline,
        ...pitLane.mainLane.points,
        ...pitLane.workingLane.points,
        ...pitLane.exit.roadCenterline,
        ...pitLane.boxes.flatMap((box) => box.corners),
        ...pitLane.serviceAreas.flatMap((area) => [...area.corners, ...area.queueCorners]),
      ];
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
    const canvasBox = await page.locator('#template-complete-root [data-track-canvas] canvas').boundingBox();
    assert(canvasBox, 'templates camera: expected canvas before drag-pan');
    await page.mouse.move(canvasBox.x + canvasBox.width * 0.52, canvasBox.y + canvasBox.height * 0.48);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + canvasBox.width * 0.62, canvasBox.y + canvasBox.height * 0.56, { steps: 4 });
    await page.mouse.up();
    await page.waitForFunction(() => {
      const controller = window.__paddockPreviewControllers?.get?.('complete-broadcast');
      return controller?.app?.camera?.free === true &&
        Number.isFinite(controller.app.camera.freeTarget?.x) &&
        Number.isFinite(controller.app.camera.freeTarget?.y);
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
    await page.waitForTimeout(450);
    const drawerCanvasSize = await page.evaluate(() => {
      const root = document.querySelector('#template-complete-root');
      const canvas = root?.querySelector('[data-track-canvas] canvas');
      const rect = canvas?.getBoundingClientRect();
      const controller = window.__paddockPreviewControllers?.get?.('complete-broadcast');
      return canvas && rect && controller?.app?.app?.renderer ? {
        cssWidth: rect.width,
        cssHeight: rect.height,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        rendererWidth: controller.app.app.renderer.width,
        rendererHeight: controller.app.app.renderer.height,
        dpr: window.devicePixelRatio || 1,
      } : null;
    });
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
  }
  await assertNoPackageOverflow(page, `${label} templates`);
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
  await assertNoPackageOverflow(page, 'components');
}

async function smokeInitialLoadingPlaceholders(page, baseUrl) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route('**/assets/main-*.js', (route) => route.abort());
  await page.goto(`${baseUrl}${deterministicTemplatesPath}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
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
      await delay(2000);
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

async function smokeBehavior(page, baseUrl) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${baseUrl}/behavior.html`, { waitUntil: 'networkidle' });
  await assertCanvasRendered(page, 'behavior');
  const heading = await page.locator('h1').first().textContent();
  assert(heading.includes('Behavior a host can rely on'), 'behavior: expected original behavior page heading');
  await page.locator('#behavior-finish-root').scrollIntoViewIfNeeded();
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
  await page.waitForFunction(() => {
    const bannerText = document.querySelector('[data-steward-message]:not(.is-hidden)')?.textContent ?? '';
    return bannerText.includes('+5s') && bannerText.includes('BUD time penalty') && bannerText.includes('Track Limits');
  });
  const bannerText = await page.locator('[data-steward-message]:not(.is-hidden)').first().textContent();
  assert(
    bannerText.includes('+5s') && bannerText.includes('BUD time penalty') && bannerText.includes('Track Limits'),
    'stewarding: expected steward message text',
  );
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
    const initialPage = await browser.newPage();
    await smokeInitialLoadingPlaceholders(initialPage, baseUrl);
    await initialPage.close();

    const loadingPage = await browser.newPage();
    await smokeSingleLoadingOverlay(loadingPage, baseUrl);
    await loadingPage.close();

    const page = await browser.newPage();
    await smokeTemplates(page, baseUrl, { width: 1440, height: 1000 }, 'desktop');
    await smokeTemplates(page, baseUrl, { width: 390, height: 900 }, 'mobile');
    await smokeComponents(page, baseUrl);
    await smokeApi(page, baseUrl);
    await smokePolicyRunner(page, baseUrl);
    await smokeBehavior(page, baseUrl);
    await smokeStewarding(page, baseUrl);
    await smokeCollisionLab(page, baseUrl);
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
