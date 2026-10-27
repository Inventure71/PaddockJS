import assert from 'node:assert/strict';

async function assertLayout(page) {
  await page.waitForFunction(() => {
    const canvas = document.querySelector('[data-track-canvas]').getBoundingClientRect();
    return [...document.querySelectorAll('[data-grid-entry]')].filter((node) => node.checkVisibility()).every((node) => {
      const rect = node.getBoundingClientRect();
      return rect.left >= canvas.left - 1 && rect.right <= canvas.right + 1 && rect.top >= canvas.top - 1 && rect.bottom <= canvas.bottom + 1;
    });
  });
  const result = await page.evaluate(() => {
    const canvas = document.querySelector('[data-track-canvas]').getBoundingClientRect();
    const controls = [...document.querySelectorAll('[data-grid-walk] button, [data-grid-jump]')]
      .filter((node) => node.checkVisibility());
    return {
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      clipped: controls.filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.left < canvas.left - 1 || rect.right > canvas.right + 1 || rect.top < canvas.top - 1 || rect.bottom > canvas.bottom + 1;
      }).map((node) => node.textContent),
    };
  });
  assert.equal(result.overflow, false, 'Host must not overflow horizontally');
  assert.deepEqual(result.clipped, [], 'Grid controls and labels must fit the actual canvas');
}

async function carPoint(page, id) {
  return page.evaluate((driverId) => {
    const app = window.gridWalkShowcase.app;
    const point = app.carSprites.get(driverId).getGlobalPosition();
    const canvas = document.querySelector('canvas').getBoundingClientRect();
    return { x: canvas.left + point.x, y: canvas.top + point.y };
  }, id);
}

export async function smokeGridWalk(page, baseUrl) {
  await page.setViewportSize({ width: 1280, height: 1050 });
  await page.goto(`${baseUrl}/grid-walk.html`);
  await page.waitForFunction(() => window.gridWalkShowcase?.getSnapshot());
  const initial = await page.evaluate(() => JSON.stringify(window.gridWalkShowcase.getSnapshot()));
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => JSON.stringify(window.gridWalkShowcase.getSnapshot())), initial, 'Pre-race discovery must hold simulation state');
  assert.equal(await page.locator('[data-grid-walk]').getAttribute('data-orientation'), 'horizontal');
  await assertLayout(page);
  await page.locator('[data-grid-entry="project-2"]').focus();
  await page.evaluate(() => {
    const host = document.getElementById('grid-host');
    host.style.width = '390px';
    host.style.height = '360px';
  });
  await page.waitForFunction(() => document.activeElement?.dataset.gridEntry === 'project-0');
  await page.locator('[data-host-size="1120,620"]').click();
  await page.waitForFunction(() => document.querySelector('[data-grid-walk]').dataset.orientation === 'horizontal');
  await page.locator('[data-grid-entry="project-0"]').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('[data-grid-heading]').textContent(), 'Surveyor');
  assert.equal(await page.locator('[data-grid-inspector] a').getAttribute('href'), '#project-0');
  await page.waitForFunction(() => document.querySelector('[data-grid-inspector] img')?.naturalWidth > 0);
  assert.equal(await page.evaluate(() => document.activeElement.hasAttribute('data-grid-heading')), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.gridEntry), 'project-0');
  const point = await carPoint(page, 'project-1');
  await page.mouse.click(point.x, point.y);
  assert.equal(await page.locator('[data-grid-heading]').textContent(), 'Relay', 'Graphical selection must inspect the same entry');
  assert.equal(await page.evaluate(() => document.activeElement.hasAttribute('data-grid-heading')), true, 'Canvas pointer defaults must not steal inspection focus');
  await page.keyboard.press('Escape');
  await page.locator('[data-host-size="390,760"]').click();
  await page.waitForFunction(() => document.querySelector('[data-grid-walk]').dataset.orientation === 'vertical');
  await assertLayout(page);
  for (let index = 0; index < 10; index += 1) {
    await page.locator('[data-grid-jump]').selectOption(`project-${index}`);
    assert.equal(await page.locator('[data-grid-entry][aria-pressed="true"]').getAttribute('data-grid-entry'), `project-${index}`);
    await assertLayout(page);
  }
  await page.locator('[data-grid-close]').click();
  await page.locator('[data-host-size="640,640"]').click();
  await page.waitForTimeout(150);
  assert.equal(await page.locator('[data-grid-walk]').getAttribute('data-orientation'), 'vertical', 'Near-square resize must retain orientation');
  await page.locator('[data-host-size="1120,620"]').click();
  await page.waitForFunction(() => document.querySelector('[data-grid-walk]').dataset.orientation === 'horizontal');
  assert.equal(await page.evaluate(() => JSON.stringify(window.gridWalkShowcase.getSnapshot())), initial, 'Selection and resizing must not touch race state');
  await page.locator('[data-grid-motion]').click();
  assert.equal(await page.locator('[data-grid-motion]').textContent(), 'Resume motion');
  await page.locator('[data-grid-view="race"]').click();
  await page.waitForFunction(() => window.gridWalkShowcase.getSnapshot().time > 1);
  await page.locator('[data-grid-view="grid-walk"]').click();
  const paused = await page.evaluate(() => JSON.stringify(window.gridWalkShowcase.getSnapshot()));
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => JSON.stringify(window.gridWalkShowcase.getSnapshot())), paused);
  assert.equal(await page.locator('[data-grid-entry][aria-pressed="true"]').getAttribute('data-grid-entry'), 'project-9');
  await page.locator('[data-host-size="720,460"]').click();
  await page.waitForTimeout(150);
  await assertLayout(page);
  await page.locator('[data-grid-view="race"]').click();
  const pausedTime = JSON.parse(paused).time;
  await page.waitForFunction((time) => window.gridWalkShowcase.getSnapshot().time > time, pausedTime);
  await page.locator('[data-grid-view="grid-walk"]').click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.querySelector('[data-grid-motion]').disabled);
  assert.equal(await page.locator('[data-grid-motion]').textContent(), 'Reduced motion');
  await page.evaluate(() => window.gridWalkShowcase.restart());
  assert.equal(await page.evaluate(() => window.gridWalkShowcase.getView()), 'grid-walk');
  await page.locator('[data-grid-view="race"]').click();
  await page.waitForFunction(() => window.gridWalkShowcase.getSnapshot().time > 0);
  await page.locator('[data-grid-view="grid-walk"]').click();
  await page.setViewportSize({ width: 390, height: 900 });
  await page.waitForTimeout(150);
  await assertLayout(page);
  await page.locator('[data-grid-jump]').selectOption('project-2');
  await assertLayout(page);
  await page.locator('[data-host-theme]').click();
  await assertLayout(page);
  await page.evaluate(() => window.gridWalkShowcase.restart({ gridWalk: { enabled: false } }));
  assert.equal(await page.evaluate(() => window.gridWalkShowcase.getView()), 'race');
  assert.equal(await page.locator('[data-grid-walk]').count(), 0);
  await page.waitForFunction(() => window.gridWalkShowcase.getSnapshot().time > 0);
  await page.evaluate(() => window.gridWalkShowcase.restart({ gridWalk: { enabled: true } }));
  assert.equal(await page.evaluate(() => window.gridWalkShowcase.getView()), 'grid-walk');
  assert.equal(await page.locator('[data-grid-walk]').count(), 1);
  await page.evaluate(() => window.gridWalkShowcase.destroy());
  assert.equal(await page.locator('[data-grid-walk]').count(), 0);
  assert.equal(await page.locator('canvas').count(), 0);
  await page.evaluate(async () => {
    const simulator = window.gridWalkShowcase;
    simulator.mountRaceCanvas(document.getElementById('grid-host'));
    await simulator.start();
  });
  assert.equal(await page.locator('canvas').count(), 1, 'A destroyed controller must remount once with cached assets');
  assert.equal(await page.locator('[data-grid-walk]').count(), 1);
  await page.evaluate(() => window.gridWalkShowcase.destroy());
  await page.setViewportSize({ width: 1280, height: 1050 });
  await page.locator('[data-host-size="1120,620"]').click();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => window.gridWalkMountShell());
  assert.equal(await page.locator('[data-timing-tower]').isVisible(), false, 'A sibling overlay tower must clear the Grid Walk scene');
  await page.locator('[data-grid-view="race"]').click();
  await page.waitForFunction(() => window.gridWalkShowcase.getSnapshot().time > 0.1);
  assert.equal(await page.locator('[data-timing-tower]').isVisible(), true);
  const overlap = await page.evaluate(() => {
    const modes = document.querySelector('.grid-walk__modes').getBoundingClientRect();
    const tower = document.querySelector('[data-timing-tower]').getBoundingClientRect();
    return modes.left < tower.right && modes.right > tower.left && modes.top < tower.bottom && modes.bottom > tower.top;
  });
  assert.equal(overlap, false, 'Race view controls must not cover the timing board');
  await page.locator('[data-grid-view="grid-walk"]').click();
  await page.locator('[data-grid-entry]:visible').first().click();
  await page.locator('[data-grid-view="race"]').click();
  await page.locator('[data-grid-view="grid-walk"]').click();
  assert.equal(await page.locator('[data-grid-inspector]').isVisible(), true, 'Inspection open state survives a mode switch');
  const shellPaused = await page.evaluate(() => JSON.stringify(window.gridWalkShowcase.getSnapshot()));
  await page.locator('[data-host-size="390,760"]').click();
  await assertLayout(page);
  assert.equal(await page.evaluate(() => JSON.stringify(window.gridWalkShowcase.getSnapshot())), shellPaused, 'Shell resizing must preserve its paused snapshot');
  await page.evaluate(() => window.gridWalkShowcase.destroy());
  const touch = await page.context().browser().newPage({ hasTouch: true, viewport: { width: 390, height: 900 } });
  try {
    await touch.goto(`${baseUrl}/grid-walk.html`);
    await touch.waitForFunction(() => window.gridWalkShowcase?.getSnapshot());
    const target = await carPoint(touch, 'project-1');
    await touch.touchscreen.tap(target.x, target.y);
    assert.equal(await touch.locator('[data-grid-heading]').textContent(), 'Relay');
    assert.equal(await touch.locator('[data-grid-entry][aria-pressed="true"]').getAttribute('data-grid-entry'), 'project-1');
    await assertLayout(touch);
  } finally { await touch.close(); }
}
