import assert from 'node:assert/strict';
import { assertPageScrollAcrossTabs, assertPageScrollOutsideSimulator } from './pageScroll.mjs';

export async function auditWheelListeners(page) {
  await page.addInitScript(() => {
    window.__blockingWheelListeners = [];
    const add = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if (type === 'wheel' && options?.passive !== true) {
        window.__blockingWheelListeners.push(this.tagName ?? this.constructor.name);
      }
      return add.call(this, type, listener, options);
    };
  });
}

export async function assertPassiveWheelListeners(page) {
  assert.deepEqual(await page.evaluate(() => window.__blockingWheelListeners), [],
    'Simulator and lab must not register a wheel listener that activates Gecko content-response waiting');
}

async function paint(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function pointAtCanvas(page) {
  const canvas = page.locator('canvas').first();
  await canvas.evaluate((node) => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await paint(page);
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  return box;
}

export async function smokeNativeScroll(page, baseUrl) {
  await auditWheelListeners(page);
  await page.setViewportSize({ width: 1280, height: 1050 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${baseUrl}/guide/grid-walk.html`);
  await page.waitForFunction(() => window.gridWalkShowcase?.getSnapshot());
  await assertPassiveWheelListeners(page);
  const snapshot = await page.evaluate(() => JSON.stringify(window.gridWalkShowcase.getSnapshot()));

  for (const [width, height] of [[1120, 620], [390, 760], [640, 640], [390, 360]]) {
    await page.evaluate(([w, h]) => {
      const host = document.getElementById('grid-host');
      host.style.width = `${w}px`;
      host.style.height = `${h}px`;
      const grid = window.gridWalkShowcase.app.gridWalk;
      grid.camera.position = (grid.frame.minPosition + grid.frame.maxPosition) / 2;
      grid.render();
    }, [width, height]);
    const box = await pointAtCanvas(page);
    const before = await page.evaluate(() => ({ position: window.gridWalkShowcase.app.gridWalk.camera.position,
      page: scrollY, selected: window.gridWalkShowcase.app.selectedId }));
    await page.mouse.wheel(0, 100);
    await page.waitForFunction((position) => window.gridWalkShowcase.app.gridWalk.camera.position < position, before.position);
    assert.equal(await page.evaluate(() => scrollY), before.page, 'Native wheel browses the grid without moving the page');
    assert.deepEqual(await page.locator('canvas').boundingBox(), box, 'Native overflow must not translate or stretch the canvas');
    assert.equal(await page.evaluate(() => window.gridWalkShowcase.app.selectedId), before.selected);
    assert.equal(await page.evaluate(() => JSON.stringify(window.gridWalkShowcase.getSnapshot())), snapshot);
    const horizontal = await page.evaluate(() => window.gridWalkShowcase.app.gridWalk.orientation === 'horizontal');
    const position = await page.evaluate(() => window.gridWalkShowcase.app.gridWalk.camera.position);
    await page.mouse.wheel(100, 0);
    if (horizontal) await page.waitForFunction((value) => window.gridWalkShowcase.app.gridWalk.camera.position > value, position);
    else {
      await paint(page);
      assert.equal(await page.evaluate(() => window.gridWalkShowcase.app.gridWalk.camera.position), position,
        'Horizontal wheel must not move a vertical camera');
    }
  }

  await page.evaluate(() => window.gridWalkShowcase.setView('race'));
  await pointAtCanvas(page);
  const before = await page.evaluate(() => ({ zoom: window.gridWalkShowcase.app.camera.zoom, page: scrollY }));
  await page.mouse.wheel(0, 100);
  await page.waitForFunction((zoom) => window.gridWalkShowcase.app.camera.zoom < zoom, before.zoom);
  assert.equal(await page.evaluate(() => scrollY), before.page, 'Race wheel still zooms without scrolling the page');
  const raceBox = await page.locator('canvas').boundingBox();
  await page.mouse.down();
  await page.mouse.move(raceBox.x + raceBox.width / 2 + 40, raceBox.y + raceBox.height / 2 + 20, { steps: 3 });
  await page.mouse.up();
  assert.equal(await page.evaluate(() => window.gridWalkShowcase.app.camera.free), false,
    'Dragging a Race canvas must not introduce a free camera target');
  await page.keyboard.down('Meta');
  await paint(page);
  const zoom = await page.evaluate(() => window.gridWalkShowcase.app.camera.zoom);
  await page.mouse.wheel(0, 100);
  await paint(page);
  await page.keyboard.up('Meta');
  assert.equal(await page.evaluate(() => window.gridWalkShowcase.app.camera.zoom), zoom,
    'Modifier wheel belongs to the browser or page');
  await assertPageScrollOutsideSimulator(page);
  await assertPageScrollAcrossTabs(page);
  await page.evaluate(() => window.gridWalkShowcase.destroy());
  assert.equal(await page.locator('[data-native-scroll-content]').count(), 0, 'Destroy releases native scroll wrappers');
  await assertPassiveWheelListeners(page);

  await page.goto(`${baseUrl}/labs/collision-lab.html`);
  await page.waitForFunction(() => window.__paddockCollisionLab?.snapshot);
  await assertPassiveWheelListeners(page);
  const labBox = await pointAtCanvas(page);
  const lab = await page.evaluate(() => ({ heading: window.__paddockCollisionLab.cars.alpha.heading, page: scrollY }));
  await page.mouse.wheel(0, 100);
  await page.waitForFunction((heading) => window.__paddockCollisionLab.cars.alpha.heading > heading, lab.heading);
  assert.ok(Math.abs(await page.evaluate(() => window.__paddockCollisionLab.cars.alpha.heading) - lab.heading - 0.08) < 0.001);
  assert.deepEqual(await page.locator('canvas').boundingBox(), labBox);
  assert.equal(await page.evaluate(() => scrollY), lab.page);
  const outward = await page.evaluate(() => scrollY + innerHeight + 60 < document.documentElement.scrollHeight ? 140 : -140);
  await page.locator('.collision-lab__stage').evaluate((node, delta) => { node.scrollTop = delta > 0 ? node.scrollHeight : 0; }, outward);
  await paint(page);
  // End Firefox's previous wheel transaction after this programmatic jump.
  // A plain native overflow panel has the same gesture-latching behavior.
  await page.mouse.move(2, 2);
  await page.mouse.move(labBox.x + labBox.width / 2, labBox.y + labBox.height / 2);
  await page.mouse.wheel(0, outward);
  await page.waitForFunction(({ position, delta }) => (scrollY - position) * Math.sign(delta) > 30,
    { position: lab.page, delta: outward });
  await assertPageScrollOutsideSimulator(page);
  await assertPageScrollAcrossTabs(page);
}
