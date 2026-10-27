// External model senses are authoritative packet data. Re-key only with the
// renderer bridge's actual slot mapping; never reconstruct senses from poses.
export function createLiveResult(frame, rendererState) {
  if (!frame?.snapshot || rendererState?.lastError) return null;
  const mapping = rendererState?.lastMeta?.externalDriverMap ?? {};
  const observation = frame.observation && typeof frame.observation === 'object'
    ? Object.fromEntries(Object.entries(frame.observation).map(([id, value]) => [mapping[id] ?? id, value])) : undefined;
  return { observation, state: { snapshot: frame.snapshot }, info: { step: frame.meta?.step }, meta: frame.meta ?? null };
}

export function policyRunnerPresentation({ live, liveResult, result, snapshot }) {
  return live ? { result: liveResult, snapshot: liveResult?.state?.snapshot ?? null } : { result, snapshot };
}
