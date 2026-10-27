import { createServer } from 'node:http';

function assert(condition, message) {
  if (!condition) throw new Error(`Policy Runner lifecycle: ${message}`);
}

// A real HTTP peer exercises fetch cancellation and the page's serialized action
// queue together. Its first decision deliberately never receives a response.
export async function smokePolicyRunnerLifecycle(page, baseUrl) {
  let resets = 0, decisions = 0, cancelled = false, liveFrame = null;
  let decisionStarted;
  const started = new Promise((resolve) => { decisionStarted = resolve; });
  const peer = createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'OPTIONS') { response.writeHead(204).end(); return; }
    let raw = '';
    for await (const chunk of request) raw += chunk;
    if (request.url === '/preview') { response.end(JSON.stringify(liveFrame)); return; }
    if (request.url === '/policy/reset') {
      resets += 1;
      response.end(JSON.stringify({ ok: true, session: `session-${resets}` }));
      return;
    }
    if (request.url === '/policy/decide-batch') {
      decisions += 1;
      if (decisions === 1) {
        response.on('close', () => { cancelled = true; });
        decisionStarted();
        return;
      }
      const payload = JSON.parse(raw);
      response.end(JSON.stringify({ ok: true, actions: Object.fromEntries(payload.driverIds.map((id) => [id,
        { steering: 0, throttle: 0, brake: 0 }])) }));
      return;
    }
    response.writeHead(404).end('{}');
  });
  await new Promise((resolve, reject) => {
    peer.once('error', reject);
    peer.listen(0, '127.0.0.1', resolve);
  });
  const endpoint = `http://127.0.0.1:${peer.address().port}`;
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${baseUrl}/policy-runner.html?controller=policy-server&serverUrl=${encodeURIComponent(endpoint)}`);
    await page.waitForFunction(() => document.querySelector('[data-policy-runner-status]')?.textContent.includes('connected'));
    const before = resets;
    await page.locator('[data-policy-runner-auto]').check();
    let timeout;
    try {
      await Promise.race([started, new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Policy Runner did not request a decision.')), 10_000);
      })]);
    } finally { clearTimeout(timeout); }
    await page.locator('[data-policy-runner-auto]').uncheck();
    await page.locator('[data-policy-runner-reset]').click();
    await page.waitForFunction((expectedSession) => {
      const text = document.querySelector('[data-policy-runner-readout]')?.textContent;
      if (!text?.startsWith('{')) return false;
      const value = JSON.parse(text);
      return value.policyServer?.session === expectedSession && value.step === 0 && value.visualFrame === 0;
    }, `session-${before + 1}`);
    assert(resets > before && cancelled, 'Stop did not abort the stalled request and release Reset.');
    await page.locator('[data-policy-runner-step]').click();
    await page.waitForFunction(() => {
      const value = JSON.parse(document.querySelector('[data-policy-runner-readout]').textContent);
      return value.policyStep === 1 && value.step === 4 && value.visualFrame === 4;
    });
    assert(decisions === 2, 'A fresh same-configuration decision did not recover after cancellation.');

    // Rapid changes must leave the latest configuration owning one canvas.
    await page.evaluate(() => {
      const select = document.querySelector('[data-policy-configuration-select]');
      for (const value of ['race', 'generation', 'race']) {
        select.value = value; select.dispatchEvent(new Event('change'));
      }
    });
    await page.waitForFunction(() => {
      const value = JSON.parse(document.querySelector('[data-policy-runner-readout]').textContent);
      return value.configuration === 'race' && !document.querySelector('[data-policy-runner-reset]').disabled;
    });
    assert(await page.locator('#policy-runner-root canvas').count() === 1, 'Rapid replacement left duplicate canvases.');

    await page.locator('[data-policy-controller-select]').selectOption('live-node-view');
    await page.waitForFunction(() => !document.querySelector('[data-policy-live-connect]').disabled);
    liveFrame = await page.evaluate(() => {
      const controller = window.__paddockPreviewControllers.get('policy-runner');
      const result = controller.expert.reset();
      const snapshot = JSON.parse(JSON.stringify(result.state.snapshot));
      const primary = snapshot.cars[0].id;
      snapshot.cars[0].id = 'network-primary';
      snapshot.cars[0].speedKph = 10;
      const observation = structuredClone(result.observation[primary]);
      observation.object.self.speedKph = 123.456;
      return { type: 'preview:snapshot', snapshot, observation: { 'network-primary': observation }, meta: { step: 71 } };
    });
    await page.locator('[data-policy-live-url]').fill(`${endpoint}/preview`);
    await page.locator('[data-policy-live-connect]').click();
    await page.waitForFunction(() => {
      const value = JSON.parse(document.querySelector('[data-policy-runner-readout]').textContent);
      return value.self?.speedKph === 123.456 && value.step === 71 &&
        Object.values(value.liveNode?.renderer?.lastMeta?.externalDriverMap ?? {}).includes(value.selectedDriver);
    }, null, { timeout: 10_000 });
    await page.waitForFunction(() => document.querySelector('[data-policy-senses]')?.textContent.includes('123 kph'));
    await page.locator('[data-policy-live-disconnect]').click();
    await page.waitForFunction(() => {
      const value = JSON.parse(document.querySelector('[data-policy-runner-readout]').textContent);
      return value.self === null && !document.querySelector('[data-policy-senses]')?.textContent.includes('123 kph');
    });
    console.log('[browser-smoke] Policy Runner stalled-request cancellation, rapid replacement and mapped live senses passed.');
  } finally {
    peer.closeAllConnections();
    await new Promise((resolve) => peer.close(resolve));
  }
}
