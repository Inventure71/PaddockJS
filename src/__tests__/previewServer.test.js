import { afterEach, describe, expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { stopPreviewServer, waitForHttp } from '../../smoke/previewServer.mjs';

const children = new Set();
afterEach(async () => {
  await Promise.all([...children].map((child) => stopPreviewServer(child, { graceMs: 30, forceMs: 1000 })));
  children.clear();
});

async function startChild(ignoreTermination = false) {
  const child = spawn(process.execPath, ['-e', `${ignoreTermination ? "process.on('SIGTERM', () => {});" : ''} process.stdout.write('ready'); setInterval(() => {}, 1000);`], {
    detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  await once(child.stdout, 'data');
  return child;
}

describe('owned preview process lifecycle', () => {
  test('waits for graceful process exit and permits repeated cleanup', async () => {
    const child = await startChild();
    await stopPreviewServer(child, { graceMs: 1000 });
    expect(child.exitCode != null || child.signalCode != null).toBe(true);
    await stopPreviewServer(child);
    expect(child.listenerCount('exit')).toBe(0);
  });

  test.skipIf(process.platform === 'win32')('terminates an owned process group that ignores graceful shutdown', async () => {
    const child = await startChild(true);
    await stopPreviewServer(child, { graceMs: 30, forceMs: 1000 });
    expect(child.signalCode).toBe('SIGKILL');
    expect(child.listenerCount('exit')).toBe(0);
  });

  test.skipIf(process.platform === 'win32')('cleans up a surviving descendant after the launcher exits first', async () => {
    const descendant = "const server = require('node:net').createServer(); process.on('SIGTERM', () => {}); server.listen(0, '127.0.0.1', () => process.stdout.write(String(server.address().port)));";
    const launcher = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: ['ignore', 'inherit', 'inherit'] }); setInterval(() => {}, 1000);`;
    const child = spawn(process.execPath, ['-e', launcher], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    const [data] = await once(child.stdout, 'data');
    const port = Number(data.toString());
    expect(port).toBeGreaterThan(0);
    try {
      await stopPreviewServer(child, { graceMs: 40, forceMs: 1000 });
      const socket = createConnection({ host: '127.0.0.1', port });
      const result = await Promise.race([
        once(socket, 'error').then(([error]) => error.code),
        once(socket, 'connect').then(() => 'connected').catch(() => null),
      ]);
      socket.destroy();
      expect(result).toBe('ECONNREFUSED');
    } finally {
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    }
  });

  test('startup deadline also bounds a server that accepts HTTP but never responds', async () => {
    const server = createServer(() => {});
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      await expect(waitForHttp(`http://127.0.0.1:${server.address().port}`, 50)).rejects.toThrow('Timed out waiting');
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
