import assert from 'node:assert/strict';

// Use native wheel input over the page gutter, never a simulator surface.
export async function assertPageScrollOutsideSimulator(page) {
  const viewport = page.viewportSize();
  const point = { x: 4, y: viewport.height / 2 };
  assert.equal(await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('.f1-sim-component')), point), false);
  const before = await page.evaluate(() => scrollY);
  const delta = await page.evaluate(() => scrollY + innerHeight + 160 < document.documentElement.scrollHeight ? 140 : -140);
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, delta);
  await page.waitForFunction((position) => Math.abs(scrollY - position) > 30, before);
  await page.evaluate((position) => scrollTo({ top: position, behavior: 'instant' }), before);
}

export async function assertPageScrollAcrossTabs(page) {
  const control = await page.context().newPage();
  try {
    await control.goto('data:text/html,<title>Independent scroll control</title><body style="height:12000px">No simulator</body>');
    for (let cycle = 0; cycle < 4; cycle += 1) {
      await page.bringToFront();
      await assertPageScrollOutsideSimulator(page);
      await control.bringToFront();
      await control.mouse.move(200, 200);
      const before = await control.evaluate(() => scrollY);
      await control.mouse.wheel(0, 140);
      await control.waitForFunction((position) => scrollY > position + 30, before);
    }
  } finally {
    await control.close();
    await page.bringToFront();
  }
}

export async function assertScrollablePanelHandoff(page, panel) {
  await panel.evaluate((node) => { node.scrollIntoView({ block: 'center', behavior: 'instant' }); node.scrollTop = 0; });
  assert.equal(await panel.evaluate((node) => node.scrollHeight > node.clientHeight + 100), true,
    'Exercise a genuinely scrollable panel, not an empty placeholder');
  const box = await panel.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const before = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, 100);
  await page.waitForFunction((node) => node.scrollTop > 20, await panel.elementHandle());
  assert.equal(await page.evaluate(() => scrollY), before, 'Panel contents scroll while there is room');
  await panel.evaluate((node) => { node.scrollTop = node.scrollHeight; });
  await page.mouse.wheel(0, 140);
  await page.waitForFunction((position) => scrollY > position + 30, before);
  await panel.evaluate((node) => { node.scrollIntoView({ block: 'center', behavior: 'instant' }); node.scrollTop = 0; });
  const topBox = await panel.boundingBox();
  await page.mouse.move(topBox.x + topBox.width / 2, topBox.y + topBox.height / 2);
  const topPagePosition = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, -140);
  await page.waitForFunction((position) => scrollY < position - 30, topPagePosition);
}
