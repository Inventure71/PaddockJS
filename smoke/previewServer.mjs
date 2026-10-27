import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

export async function findFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolvePort(address.port));
    });
  });
}

export async function waitForHttp(url, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const remaining = Math.max(1, timeoutMs - (Date.now() - startedAt));
      const response = await fetch(url, { signal: AbortSignal.timeout(remaining) });
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await delay(Math.max(1, Math.min(250, timeoutMs - (Date.now() - startedAt))));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

export function startPreviewServer({ projectRoot, cwd, port, label = 'preview' }) {
  const child = spawn('npm', ['--prefix', projectRoot, 'run', 'preview', '--', '--port', String(port), '--strictPort'], {
    cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
  });
  child.stdout.on('data', (chunk) => process.stdout.write(`[${label}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[${label}] ${chunk}`));
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
  return new Promise((resolve) => {
    const onExit = () => { clearTimeout(timer); resolve(true); };
    const timer = setTimeout(() => { child.removeListener('exit', onExit); resolve(false); }, timeoutMs);
    child.once('exit', onExit);
  });
}

export async function stopPreviewServer(child, { graceMs = 3000, forceMs = 3000 } = {}) {
  if (isChildExited(child)) return;
  signalPreviewServer(child, 'SIGTERM');
  if (await waitForPreviewExit(child, graceMs)) return;
  signalPreviewServer(child, 'SIGKILL');
  if (!await waitForPreviewExit(child, forceMs)) throw new Error('Preview process did not exit after SIGKILL.');
}

