export function createRuntimeSeed() {
  const values = new Uint32Array(1);
  try {
    globalThis.crypto?.getRandomValues?.(values);
  } catch {
    values[0] = 0;
  }
  const highResolutionTime = globalThis.performance?.now?.() ?? 0;
  return (values[0] || Math.floor(Date.now() + highResolutionTime * 1000)) >>> 0;
}
