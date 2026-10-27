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

const releasedProcesses = new WeakSet();

function isChildExited(child) {
  return !child || child.exitCode != null || child.signalCode != null;
}

function processGroupExists(child) {
  if (!child?.pid) return false;
  try { process.kill(-child.pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}

function signalPreviewServer(child, signal) {
  if (!child?.pid) return;
  try {
    if (process.platform === 'win32') {
      if (!isChildExited(child)) child.kill(signal);
    } else {
      // The launcher may have exited before its descendants. Its process-group
      // identity remains owned until teardown finishes, independently of exitCode.
      process.kill(-child.pid, signal);
    }
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
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

async function waitForGroupExit(child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (processGroupExists(child)) {
    if (Date.now() >= deadline) return false;
    await delay(Math.max(1, Math.min(25, deadline - Date.now())));
  }
  return true;
}

export async function stopPreviewServer(child, { graceMs = 3000, forceMs = 3000 } = {}) {
  if (!child || releasedProcesses.has(child)) return;
  signalPreviewServer(child, 'SIGTERM');
  const graceful = process.platform === 'win32'
    ? await waitForPreviewExit(child, graceMs)
    : await waitForGroupExit(child, graceMs);
  if (!graceful) {
    signalPreviewServer(child, 'SIGKILL');
    // Wait for descendants to release sockets/stdio too; the launcher can
    // already be gone while a killed child is still being scheduled out.
    if (process.platform !== 'win32') await waitForGroupExit(child, forceMs);
  }
  if (!await waitForPreviewExit(child, forceMs)) throw new Error('Preview process did not exit after SIGKILL.');
  // SIGKILL reaches all remaining group members, even when npm exited first.
  // Orphaned zombie entries can remain until the OS reaps them; no runnable
  // process can survive this signal, and repeating cleanup must not target a
  // subsequently reused process-group ID.
  releasedProcesses.add(child);
}
