import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { firefox } from 'playwright';
import { assertPageScrollOutsideSimulator, assertPageScrollAcrossTabs } from './pageScroll.mjs';
import { assertInterruptedDrag, assertWheelHandoff } from './gridWalkSmoke.mjs';
import { findFreePort, waitForHttp, startPreviewServer, stopPreviewServer } from './previewServer.mjs';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const siteRoot = fileURLToPath(new URL('../site', import.meta.url));
if (!process.argv.includes('--skip-build')) {
  execFileSync('npm', ['--prefix', siteRoot, 'run', 'check'], { cwd: repoRoot, stdio: 'inherit' });
}
const port = await findFreePort();
const baseUrl = `http://127.0.0.1:${port}`;
const server = startPreviewServer({ projectRoot: siteRoot, cwd: repoRoot, port, label: 'firefox-preview' });
let browser;
try {
  await waitForHttp(baseUrl);
  browser = await firefox.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1050 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(baseUrl);
  await page.locator('#broadcast-root canvas').waitFor();
  await assertPageScrollOutsideSimulator(page);
  await assertPageScrollAcrossTabs(page);

  await page.goto(`${baseUrl}/guide/grid-walk.html`);
  await page.waitForFunction(() => window.gridWalkShowcase?.getSnapshot());
  await assertInterruptedDrag(page);
  await assertWheelHandoff(page);
  const canvas = page.locator('canvas');
  for (let cycle = 0; cycle < 8; cycle += 1) {
    await canvas.evaluate((node) => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, cycle % 2 ? 100 : -100);
    await assertPageScrollOutsideSimulator(page);
  }
  await assertPageScrollAcrossTabs(page);
  await page.evaluate(() => window.gridWalkShowcase.setView('race'));
  await assertPageScrollOutsideSimulator(page);
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`[firefox-input-smoke] Firefox ${browser.version()}: outside-page and cross-tab wheel scrolling, grid boundary handoff, interrupted drag and Race input ownership passed.`);
} finally {
  await browser?.close();
  await stopPreviewServer(server);
}
