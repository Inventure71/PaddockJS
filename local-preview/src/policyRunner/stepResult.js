// A stopped controller can return its unchanged last result. That is not a
// visual frame or training transition and must never reach their bookkeeping.
export async function stepPolicyRunner(loop, method, isCurrent) {
  const previousStep = loop.stats.runtimeStep;
  const next = await loop[method]();
  if (!isCurrent() || !(Number(next?.info?.step) > previousStep)) return null;
  return next;
}
