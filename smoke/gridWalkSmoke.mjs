import assert from 'node:assert/strict';

async function assertLayout(page) {
  // Container ResizeObserver and its scheduled layout pass settle on frames.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForFunction(() => {
    const canvas = document.querySelector('[data-track-canvas]').getBoundingClientRect();
    return [...document.querySelectorAll('[data-grid-entry]')].filter((node) => node.checkVisibility()).every((node) => {
      const rect = node.getBoundingClientRect();
      return rect.left >= canvas.left - 1 && rect.right <= canvas.right + 1 && rect.top >= canvas.top - 1 && rect.bottom <= canvas.bottom + 1;
    });
  });
  const result = await page.evaluate(() => {
    const canvas = document.querySelector('[data-track-canvas]').getBoundingClientRect();
    const controls = [...document.querySelectorAll('[data-grid-walk] button, [data-grid-walk] a, [data-grid-jump]')]
      .filter((node) => node.checkVisibility());
    return {
      overlaps: (() => {
        const labels = [...document.querySelectorAll('[data-grid-entry]')].filter((node) => node.checkVisibility());
        const obstacles = [...document.querySelectorAll('[data-grid-header], [data-grid-project-banner]')].filter((node) => node.checkVisibility());
        const intersects = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
        return labels.flatMap((node, index) => [...labels.slice(index + 1), ...obstacles]
          .filter((other) => intersects(node.getBoundingClientRect(), other.getBoundingClientRect()))
          .map((other) => [node.dataset.gridEntry, other.dataset.gridEntry ?? other.className]));
      })(),
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      selectorCentered: (() => {
        const selector = document.querySelector('[data-grid-navigation]').getBoundingClientRect();
        return Math.abs((selector.left + selector.right) / 2 - (canvas.left + canvas.right) / 2) < 1;
      })(),
      centeredText: getComputedStyle(document.querySelector('[data-grid-jump]')).textAlign === 'center',
      clipped: controls.filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.left < canvas.left - 1 || rect.right > canvas.right + 1 || rect.top < canvas.top - 1 || rect.bottom > canvas.bottom + 1;
      }).map((node) => node.textContent),
    };
  });
  assert.deepEqual(result.overlaps, [], 'Labels must not overlap one another, controls or the project banner');
  assert.equal(result.overflow, false, 'Host must not overflow horizontally');
  assert.equal(result.selectorCentered, true, 'Project selector stays centered over the actual scene');
  assert.equal(result.centeredText, true, 'Selected project text stays centered');
  assert.deepEqual(result.clipped, [], 'Grid controls and labels must fit the actual canvas');
}

async function carPoint(page, id) {
  // This fixture now lives in a scrolling guide. Stop host smooth scrolling
  // before mapping scene positions to pointer coordinates; page movement is
  // independent of the camera behavior asserted below.
  await page.locator('canvas').first().evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
  return page.evaluate((driverId) => {
    const app = window.gridWalkShowcase.app;
    const point = app.carSprites.get(driverId).getGlobalPosition();
    const canvas = document.querySelector('canvas').getBoundingClientRect();
    return { x: canvas.left + point.x, y: canvas.top + point.y };
  }, id);
}

async function assertWheelHandoff(page) {
  const originalPosition = await page.evaluate(() => window.gridWalkShowcase.app.gridWalk.camera.position);
  const canvas = page.locator('canvas').first();
  await canvas.evaluate((node) => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.evaluate(() => {
    const grid = window.gridWalkShowcase.app.gridWalk;
    grid.camera.pan(grid.orientation === 'horizontal' ? 1000000 : -1000000);
    grid.render();
  });
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const before = await page.evaluate(() => ({ scroll: scrollY,
    position: window.gridWalkShowcase.app.gridWalk.camera.position,
    zoom: window.gridWalkShowcase.app.camera.zoom }));
  await page.mouse.wheel(0, 100);
  await page.waitForFunction((scroll) => scrollY > scroll + 20, before.scroll);
  assert.equal(await page.evaluate(() => window.gridWalkShowcase.app.gridWalk.camera.position), before.position,
    'Outward wheel at grid end must scroll page without moving the bounded camera');
  assert.equal(await page.evaluate(() => window.gridWalkShowcase.app.camera.zoom), before.zoom,
    'Boundary wheel must never fall through into Race zoom');
  await canvas.evaluate((node) => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const currentBox = await canvas.boundingBox();
  await page.mouse.move(currentBox.x + currentBox.width / 2, currentBox.y + currentBox.height / 2);
  const scroll = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, -100);
  await page.waitForFunction((position) => window.gridWalkShowcase.app.gridWalk.camera.position > position, before.position);
  assert.equal(await page.evaluate(() => scrollY), scroll, 'Inward wheel browses grid without scrolling the page');
  assert.equal(await canvas.evaluate((node) => node.dispatchEvent(new WheelEvent('wheel', {
    bubbles: true, cancelable: true, deltaY: 100, ctrlKey: true,
  }))), true, 'Browser pinch/zoom is not cancelled by simulator controls');
  await page.evaluate((position) => {
    const grid = window.gridWalkShowcase.app.gridWalk;
    grid.camera.position = position;
    grid.render();
  }, originalPosition);
}

export async function smokeGridWalk(page, baseUrl) {
  await page.setViewportSize({ width: 1280, height: 1050 });
  await page.goto(`${baseUrl}/guide/grid-walk.html`);
  await page.waitForFunction(() => window.gridWalkShowcase?.getSnapshot());
  const initial = await page.evaluate(() => JSON.stringify(window.gridWalkShowcase.getSnapshot()));
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => JSON.stringify(window.gridWalkShowcase.getSnapshot())), initial, 'Pre-race discovery must hold simulation state');
  assert.equal(await page.locator('[data-grid-walk]').getAttribute('data-orientation'), 'horizontal');
  assert.equal(await page.locator('[data-grid-walk] [data-grid-view]').count(), 0, 'Mode controls belong outside the graphical scene');
  assert.equal(await page.locator('[data-paddock-component="view-controls"]').evaluate((node) => {
    const controls = node.getBoundingClientRect();
    const canvas = document.querySelector('canvas').getBoundingClientRect();
    return controls.bottom <= canvas.top;
  }), true, 'Separately mounted mode controls stay above the canvas');
  assert.ok((await page.locator('[data-grid-navigation]').boundingBox()).width <= 361, 'Wide selectors keep the shared compact control proportions');
  await assertLayout(page);
  await assertWheelHandoff(page);
  const labelDragBefore = await page.evaluate(() => ({ position: window.gridWalkShowcase.app.gridWalk.camera.position,
    selected: window.gridWalkShowcase.app.selectedId }));
  const draggableLabel = page.locator('[data-grid-entry]:visible').last();
  await draggableLabel.scrollIntoViewIfNeeded();
  const labelBox = await draggableLabel.boundingBox();
  await page.mouse.move(labelBox.x + labelBox.width / 2, labelBox.y + labelBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(labelBox.x + labelBox.width / 2 + 40, labelBox.y + labelBox.height / 2 + 20, { steps: 3 });
  await page.mouse.up();
  assert.notEqual(await page.evaluate(() => window.gridWalkShowcase.app.gridWalk.camera.position), labelDragBefore.position,
    'Dragging an entry label browses the same scene as dragging the canvas');
  assert.equal(await page.evaluate(() => window.gridWalkShowcase.app.selectedId), labelDragBefore.selected,
    'Dragging a label must not activate it');
  await page.evaluate((position) => {
    const grid = window.gridWalkShowcase.app.gridWalk;
    grid.camera.position = position;
    grid.render();
  }, labelDragBefore.position);
  const canvas = page.locator('canvas');
  const keyboardStart = await carPoint(page, 'project-0');
  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  const keyboardMoved = await carPoint(page, 'project-0');
  assert.ok(keyboardMoved.x < keyboardStart.x - 50, 'Arrow keys pan the focused canvas');
  const crossStart = await carPoint(page, 'project-0');
  await page.keyboard.press('ArrowDown');
  assert.deepEqual(await carPoint(page, 'project-0'), crossStart, 'Cross-axis keys must not move a horizontal camera');
  await page.keyboard.press('Home');
  const keyboardHome = await carPoint(page, 'project-0');
  assert.ok(Math.abs(keyboardHome.x - keyboardStart.x) < 1, 'Home restores selected-entry framing');
  await page.locator('[data-grid-project-banner] [data-race-data-dismiss]').click();
  const firstCar = await carPoint(page, 'project-0');
  // Drag from a car: a drag must not open its project banner or change selection.
  await page.mouse.move(firstCar.x, firstCar.y);
  await page.mouse.down();
  await page.mouse.move(firstCar.x + 100, firstCar.y + 20, { steps: 8 });
  await page.mouse.up();
  const dragged = await carPoint(page, 'project-0');
  assert.ok(Math.abs(dragged.x - firstCar.x - 100) < 2, 'Grid follows a horizontal pointer drag');
  assert.ok(Math.abs(dragged.y - firstCar.y) < 1, 'Horizontal dragging must not move vertically');
  assert.equal(await page.locator('[data-grid-project-banner]').isVisible(), false, 'Dragging a car must not inspect it');
  await page.mouse.wheel(0, 360);
  await page.waitForTimeout(100);
  const scrolled = await carPoint(page, 'project-0');
  assert.ok(scrolled.x > dragged.x + 200, 'Wheel moves through a horizontal grid');
  assert.equal(await page.evaluate(() => JSON.stringify(window.gridWalkShowcase.getSnapshot())), initial);
  await canvas.focus();
  await page.keyboard.press('Home');
  await page.locator('[data-grid-entry="project-2"]').focus();
  await page.evaluate(() => {
    const host = document.getElementById('grid-host');
    host.style.width = '390px';
    host.style.height = '360px';
  });
  await page.waitForFunction(() => document.activeElement?.checkVisibility() && (document.activeElement.dataset.gridEntry || document.activeElement.hasAttribute('data-grid-jump')));
  await assertLayout(page);
  await page.locator('[data-host-size="1120,620"]').click();
  await page.waitForFunction(() => document.querySelector('[data-grid-walk]').dataset.orientation === 'horizontal');
  await page.locator('[data-grid-entry="project-0"]').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('[data-grid-heading]').textContent(), 'Surveyor');
  assert.equal(await page.locator('[data-grid-project-banner] a').getAttribute('href'), '#project-0');
  assert.equal(await page.locator('[data-grid-project-banner] img').count(), 0, 'Project details reuse the race banner without extra images');
  assert.equal(await page.locator('[data-grid-project-banner]').getByText('Technologies', { exact: true }).count(), 0);
  const layout = await page.evaluate(() => ({
    canvas: document.querySelector('canvas').getBoundingClientRect().toJSON(),
    selector: document.querySelector('[data-grid-navigation]').getBoundingClientRect().toJSON(),
    banner: document.querySelector('[data-grid-project-banner]').getBoundingClientRect().toJSON(),
  }));
  assert.ok(layout.selector.top < layout.canvas.top + 90, 'Entry selector belongs at the top');
  assert.ok(layout.banner.bottom > layout.canvas.bottom - 30, 'Project details belong at the bottom');
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
  assert.ok((await page.locator('[data-grid-jump]').boundingBox()).width >= 200, 'Tall selectors wrap to keep names readable');
  await assertWheelHandoff(page);
  const tallBefore = await carPoint(page, 'project-1');
  await page.mouse.move(tallBefore.x, tallBefore.y);
  await page.mouse.wheel(90, 180);
  await page.waitForTimeout(100);
  const tallAfter = await carPoint(page, 'project-1');
  assert.ok(tallAfter.y < tallBefore.y - 100, 'Wheel moves through a vertical grid');
  assert.ok(Math.abs(tallAfter.x - tallBefore.x) < 1, 'Diagonal scroll must not move across the vertical grid');
  await canvas.focus();
  const tallFocused = await carPoint(page, 'project-1');
  await page.keyboard.press('ArrowLeft');
  assert.deepEqual(await carPoint(page, 'project-1'), tallFocused, 'Cross-axis keys must not move the camera');
  for (let index = 0; index < 10; index += 1) {
    await page.locator('[data-grid-jump]').selectOption(`project-${index}`);
    assert.equal(await page.locator('[data-grid-entry][aria-pressed="true"]').getAttribute('data-grid-entry'), `project-${index}`);
    await assertLayout(page);
  }
  await page.locator('[data-grid-project-banner] [data-race-data-dismiss]').click();
  await page.locator('[data-host-size="640,640"]').click();
  await page.waitForTimeout(150);
  assert.equal(await page.locator('[data-grid-walk]').getAttribute('data-orientation'), 'vertical', 'Near-square resize must retain orientation');
  await page.locator('[data-host-size="1120,620"]').click();
  await page.waitForFunction(() => document.querySelector('[data-grid-walk]').dataset.orientation === 'horizontal');
  assert.equal(await page.evaluate(() => JSON.stringify(window.gridWalkShowcase.getSnapshot())), initial, 'Selection and resizing must not touch race state');
  assert.equal(await page.getByRole('button', { name: /pause motion/i }).count(), 0);
  await page.evaluate(() => {
    const host = document.getElementById('grid-host');
    host.style.width = '1400px'; host.style.height = '400px';
  });
  await page.setViewportSize({ width: 1600, height: 1050 });
  await assertLayout(page);
  const visibleIds = () => page.locator('[data-grid-entry]:visible').evaluateAll((nodes) => nodes.map((node) => node.dataset.gridEntry));
  const beforeSelection = await visibleIds();
  const beforeClick = await carPoint(page, 'project-9');
  await page.mouse.click(beforeClick.x, beforeClick.y);
  assert.equal(await page.locator('[data-grid-heading]').textContent(), 'Northstar');
  assert.deepEqual(await visibleIds(), beforeSelection, 'Selecting an on-screen entry must preserve the other labels');
  await page.mouse.wheel(0, 0);
  assert.deepEqual(await visibleIds(), beforeSelection, 'A no-op gesture must not change label visibility');
  await page.keyboard.press('Escape');
  assert.deepEqual(await carPoint(page, 'project-9'), beforeClick, 'Dismissing a project must preserve browsing position and zoom');
  await page.locator('[data-grid-entry="project-9"]').click();
  await assertLayout(page);
  await page.locator('[data-host-size="1120,620"]').click();
  await page.locator('[data-grid-view="race"]').click();
  await page.waitForFunction(() => window.gridWalkShowcase.getSnapshot().time > 1);
  const raceZoom = await page.evaluate(() => window.gridWalkShowcase.app.camera.zoom);
  const track = await page.locator('canvas').boundingBox();
  await page.mouse.move(track.x + track.width / 2, track.y + track.height / 2);
  await page.mouse.wheel(0, 100);
  await page.waitForFunction((before) => window.gridWalkShowcase.app.camera.zoom < before, raceZoom);

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
  await page.waitForFunction(() => !window.gridWalkShowcase.app.app.ticker.started);
  const frozenPeople = await page.evaluate(() => window.gridWalkShowcase.app.gridWalk.crew.walkers.map(({ person }) => [person.x, person.y]));
  await page.waitForTimeout(120);
  assert.deepEqual(await page.evaluate(() => window.gridWalkShowcase.app.gridWalk.crew.walkers.map(({ person }) => [person.x, person.y])), frozenPeople);
  const staticBefore = await carPoint(page, 'project-9');
  await page.mouse.move(staticBefore.x, staticBefore.y);
  await page.mouse.down();
  await page.mouse.move(staticBefore.x + 35, staticBefore.y, { steps: 4 });
  await page.mouse.up();
  assert.ok((await carPoint(page, 'project-9')).x > staticBefore.x + 20, 'Static Grid Walk still renders navigation');
  assert.equal(await page.evaluate(() => window.gridWalkShowcase.app.app.ticker.started), false);

  await page.evaluate(() => window.gridWalkShowcase.restart());
  assert.equal(await page.evaluate(() => window.gridWalkShowcase.getView()), 'grid-walk');
  assert.equal(await page.locator('[data-grid-project-banner] [data-paddock-loading]').count(), 0, 'A ready Grid Walk banner must not retain a startup placeholder');
  assert.equal(await page.locator('[data-grid-project-banner]').evaluate((node) => node.classList.contains('is-loaded')), true);
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
  const surfaces = await page.evaluate(() => {
    const ctx = document.createElement('canvas').getContext('2d');
    function pixel(color) { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; }
    function luminance(rgb) { return rgb.slice(0, 3).map((v) => v / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0); }
    return [...document.querySelectorAll('[data-grid-entry]')].filter((node) => node.checkVisibility()).map((node) => {
      const style = getComputedStyle(node), background = pixel(style.backgroundColor), foreground = pixel(style.color);
      const values = [luminance(background), luminance(foreground)].sort((a, b) => a - b);
      return { alpha: background[3], contrast: (values[1] + 0.05) / (values[0] + 0.05) };
    });
  });
  assert.ok(surfaces.length > 0);
  surfaces.forEach(({ alpha, contrast }) => { assert.equal(alpha, 255, 'Light labels must be opaque'); assert.ok(contrast >= 4.5, 'Label text must have readable contrast'); });
  await page.evaluate(() => window.gridWalkShowcase.restart({ ui: { raceDataBanners: { enabled: ['radio'] } } }));
  assert.equal(await page.locator('[data-grid-project-banner]').isVisible(), false, 'Disabled project banners must remain disabled in Grid Walk');
  await page.locator('[data-grid-jump]').selectOption('project-4');
  assert.equal(await page.locator('[data-grid-project-banner]').isVisible(), false);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.gridEntry), 'project-4', 'Selection without a banner restores the entry focus');
  await page.evaluate(() => window.gridWalkShowcase.restart({ ui: { raceDataBanners: { enabled: ['project', 'radio'] }, raceDataBannerSize: 'auto', raceDataTelemetryDetail: true } }));
  assert.equal(await page.locator('[data-grid-project-banner]').evaluate((node) => node.classList.contains('race-data-panel--auto')), true, 'Grid Walk must use the shared banner sizing option');
  assert.equal(await page.locator('[data-grid-project-banner] [data-race-data-telemetry]').count(), 0, 'Grid Walk must keep the agreed project-only content');
  await page.evaluate(() => window.gridWalkShowcase.app.setRaceDataBannersMuted(true));
  assert.equal(await page.locator('[data-grid-project-banner]').isVisible(), false, 'Race mute must immediately hide the Grid Walk project banner');
  await page.evaluate(() => window.gridWalkShowcase.app.setRaceDataBannersMuted(false));
  assert.equal(await page.locator('[data-grid-project-banner]').isVisible(), true);
  await page.evaluate(() => window.gridWalkShowcase.restart({ entries: window.gridWalkShowcase.app.drivers.map((driver) => ({ driverId: driver.id,
    presentation: { name: 'Long project name with several descriptive words that must remain accessible', summary: 'A supplied summary. '.repeat(30), href: '#project' } })) }));
  for (const [width, height] of [[320, 460], [390, 360], [390, 760], [720, 460]]) {
    await page.evaluate(([w, h]) => { const host = document.getElementById('grid-host'); host.style.width = `${w}px`; host.style.height = `${h}px`; }, [width, height]);
    await page.waitForTimeout(100);
    await page.locator('[data-grid-jump]').selectOption('project-4');
    await assertLayout(page);
    assert.equal(await page.locator('[data-grid-entry="project-4"]').isVisible(), true, 'Constrained long-name entries must remain reachable');
  }
  await page.evaluate(() => window.gridWalkShowcase.restart({ ui: { showRaceDataPanel: false } }));
  assert.equal(await page.locator('[data-grid-project-banner]').isVisible(), false, 'The shared visibility option must also apply in Grid Walk');
  await page.evaluate(() => window.gridWalkShowcase.restart({ ui: { showRaceDataPanel: true, raceDataBannerSize: 'custom' } }));
  await page.evaluate(() => window.gridWalkShowcase.restart({ gridWalk: { enabled: false } }));
  assert.equal(await page.evaluate(() => window.gridWalkShowcase.getView()), 'race');
  assert.equal(await page.locator('[data-grid-walk]').count(), 0);
  assert.equal(await page.locator('[data-paddock-component="view-controls"]').isVisible(), false);
  assert.equal(await page.locator('[data-grid-view="race"]').isDisabled(), true);
  await page.waitForFunction(() => window.gridWalkShowcase.getSnapshot().time > 0);
  await page.evaluate(() => window.gridWalkShowcase.restart({ gridWalk: { enabled: true } }));
  assert.equal(await page.evaluate(() => window.gridWalkShowcase.getView()), 'grid-walk');
  assert.equal(await page.locator('[data-paddock-component="view-controls"]').isVisible(), true);
  assert.equal(await page.locator('[data-grid-view="grid-walk"]').isEnabled(), true);
  assert.equal(await page.locator('[data-grid-view="grid-walk"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('[data-grid-project-banner] [data-paddock-loading]').count(), 0, 'A ready Grid Walk banner must not retain a startup placeholder');
  assert.equal(await page.locator('[data-grid-project-banner]').evaluate((node) => node.classList.contains('is-loaded')), true);
  assert.equal(await page.locator('[data-grid-walk]').count(), 1);
  await page.evaluate(() => window.gridWalkShowcase.destroy());
  assert.equal(await page.locator('[data-grid-walk]').count(), 0);
  assert.equal(await page.locator('canvas').count(), 0);
  await page.evaluate(async () => {
    const simulator = window.gridWalkShowcase;
    simulator.mountViewControls(document.getElementById('grid-view-controls'));
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
    const modes = document.querySelector('[data-paddock-component="view-controls"]').getBoundingClientRect();
    const tower = document.querySelector('[data-timing-tower]').getBoundingClientRect();
    return modes.left < tower.right && modes.right > tower.left && modes.top < tower.bottom && modes.bottom > tower.top;
  });
  assert.equal(overlap, false, 'Race view controls must not cover the timing board');
  const toolbarBefore = await page.locator('[data-paddock-component="view-controls"]').boundingBox();
  await page.waitForTimeout(150);
  assert.deepEqual(await page.locator('[data-paddock-component="view-controls"]').boundingBox(), toolbarBefore, 'External view controls keep stable placement');

  await page.locator('[data-grid-view="grid-walk"]').click();
  await page.locator('[data-grid-entry]:visible').first().click();
  await page.evaluate(() => window.gridWalkShowcase.setView('race'));
  assert.equal(await page.evaluate(() => document.activeElement.dataset.gridView), 'race',
    'Programmatic departure from a focused scene restores focus to the external Race switch');
  await page.locator('[data-grid-view="grid-walk"]').click();
  assert.equal(await page.locator('[data-grid-project-banner]').isVisible(), true, 'Project banner open state survives a mode switch');
  const shellPaused = await page.evaluate(() => JSON.stringify(window.gridWalkShowcase.getSnapshot()));
  await page.locator('[data-host-size="390,760"]').click();
  await assertLayout(page);
  assert.equal(await page.evaluate(() => JSON.stringify(window.gridWalkShowcase.getSnapshot())), shellPaused, 'Shell resizing must preserve its paused snapshot');
  await page.evaluate(() => window.gridWalkShowcase.destroy());
  await page.evaluate(() => window.gridWalkMountShell({ enabled: false }));
  assert.equal(await page.locator('[data-paddock-component="view-controls"]').isVisible(), false);
  await page.evaluate(() => window.gridWalkShowcase.restart({ gridWalk: { enabled: true } }));
  assert.equal(await page.locator('[data-paddock-component="view-controls"]').isVisible(), true,
    'Enabling Grid Walk on a shell that started disabled activates its external control surface');
  assert.equal(await page.locator('[data-grid-view="grid-walk"]').getAttribute('aria-pressed'), 'true');
  await page.locator('[data-grid-view="race"]').click();
  assert.equal(await page.evaluate(() => window.gridWalkShowcase.getView()), 'race');
  await page.evaluate(() => window.gridWalkShowcase.destroy());
  const touch = await page.context().browser().newPage({ hasTouch: true, viewport: { width: 390, height: 900 } });
  try {
    await touch.goto(`${baseUrl}/guide/grid-walk.html`);
    await touch.waitForFunction(() => window.gridWalkShowcase?.getSnapshot());
    await touch.locator('[data-grid-project-banner] [data-race-data-dismiss]').click();
    const start = await carPoint(touch, 'project-0');
    const cdp = await touch.context().newCDPSession(touch);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start.x, y: start.y, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + 60, y: start.y + 30, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    const moved = await carPoint(touch, 'project-0');
    assert.ok(moved.y > start.y + 20, 'Vertical touch drag pans the grid');
    assert.ok(Math.abs(moved.x - start.x) < 1, 'Vertical dragging must not move horizontally');
    assert.equal(await touch.locator('[data-grid-project-banner]').isVisible(), false);
    await touch.locator('[data-grid-jump]').selectOption('project-0');
    await touch.locator('[data-grid-project-banner] [data-race-data-dismiss]').click();
    const target = await carPoint(touch, 'project-1');
    await touch.touchscreen.tap(target.x, target.y);
    assert.equal(await touch.locator('[data-grid-heading]').textContent(), 'Relay');
    assert.equal(await touch.locator('[data-grid-entry][aria-pressed="true"]').getAttribute('data-grid-entry'), 'project-1');
    await assertLayout(touch);
    await touch.locator('[data-grid-project-banner] [data-race-data-dismiss]').click();
    const axisStart = await carPoint(touch, 'project-0');
    const axisSession = await touch.context().newCDPSession(touch);
    await axisSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: axisStart.x, y: axisStart.y, id: 1 }] });
    await axisSession.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: axisStart.x + 65, y: axisStart.y, id: 1 }] });
    await axisSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await axisSession.detach();
    assert.deepEqual(await carPoint(touch, 'project-0'), axisStart, 'A forbidden-axis gesture cannot pan the grid');
    assert.equal(await touch.locator('[data-grid-heading]').textContent(), 'Surveyor', 'Forbidden-axis movement must not swallow a car selection');
  } finally { await touch.close(); }

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${baseUrl}/guide/grid-walk.html?viewControls=toggle`);
  await page.waitForFunction(() => window.gridWalkShowcase?.getSnapshot());
  const toggle = page.getByRole('button', { name: 'Start race', exact: true });
  assert.equal(await page.locator('[data-paddock-component="view-controls"] button:visible').count(), 1);
  const assertActionColor = async (action) => {
    for (const mode of ['dark', 'light']) {
      await page.evaluate((value) => window.gridWalkShowcase.setThemeMode(value), mode);
      const colors = await page.locator('[data-grid-toggle]').evaluate((button, value) => {
        const probe = document.createElement('span');
        probe.style.backgroundColor = `var(${value === 'start' ? '--green' : '--race-control-red'})`;
        button.append(probe);
        const expected = getComputedStyle(probe).backgroundColor;
        const actual = getComputedStyle(button).backgroundColor;
        probe.remove();
        return { expected, actual };
      }, action);
      assert.equal(colors.actual, colors.expected, `${mode} ${action} uses its semantic race-control color`);
      assert.notEqual(colors.actual, 'rgba(0, 0, 0, 0)');
    }
  };
  await assertActionColor('start');
  await page.locator('[data-grid-jump]').selectOption('project-3');
  const toggleCanvas = await page.locator('canvas').elementHandle();
  const initialActionWidth = (await toggle.boundingBox()).width;
  await toggle.focus();
  await page.keyboard.press('Enter');
  const stop = page.getByRole('button', { name: 'Stop race', exact: true });
  await stop.waitFor();
  await assertActionColor('stop');
  assert.equal((await stop.boundingBox()).width, initialActionWidth, 'Start/Stop labels reserve the same action width');
  await page.waitForFunction(() => window.gridWalkShowcase.getSnapshot().time > 0.2);
  await stop.click();
  await assertActionColor('start');
  const stopped = await page.evaluate(() => JSON.stringify(window.gridWalkShowcase.getSnapshot()));
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => JSON.stringify(window.gridWalkShowcase.getSnapshot())), stopped,
    'Stop race pauses the exact saved simulation');
  assert.equal(await page.locator('[data-grid-jump]').inputValue(), 'project-3');
  await toggle.click();
  await page.waitForFunction((time) => window.gridWalkShowcase.getSnapshot().time > time, JSON.parse(stopped).time);
  assert.equal(await toggleCanvas.evaluate((node) => node.isConnected), true, 'Single-action mode switches keep the original canvas');
  await page.evaluate(() => window.gridWalkShowcase.restart({ ui: { viewControls: 'switch' } }));
  assert.equal(await page.locator('[data-paddock-component="view-controls"] button:visible').count(), 2);
  assert.equal(await page.locator('[data-grid-toggle]').isVisible(), false);
  await page.evaluate(() => window.gridWalkShowcase.destroy());
}
