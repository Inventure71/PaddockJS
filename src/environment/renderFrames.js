export function emitExternalRenderFrame(host, result, meta = {}, observationSnapshot = null) {
  const options = host.getOptions?.();
  const onFrame = options?.externalRenderer?.onFrame;
  if (typeof onFrame !== 'function') return;
  try {
    onFrame({
      snapshot: result?.state?.snapshot ??
        observationSnapshot ??
        host.getSimulation?.()?.snapshotObservation?.() ??
        host.getSimulation?.()?.snapshot?.(),
      observation: result?.observation ?? {},
      meta: {
        ...meta,
        step: result?.info?.step ?? null,
        elapsedSeconds: result?.info?.elapsedSeconds ?? null,
      },
    });
  } catch {
    // External rendering hooks are observer-only and must not break stepping.
  }
}
