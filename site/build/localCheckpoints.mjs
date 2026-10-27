import { statSync } from 'node:fs';
import { resolve } from 'node:path';

const POLICY_FILES = ['latest-distilled-policy.json', 'latest-hybrid-policy.json'];

// Discover URLs without importing model JSON into the JavaScript bundle.
// Keep the preferred distilled export first when both local exports exist.
export function discoverLocalCheckpoints(publicDirectory) {
  return POLICY_FILES.filter((name) =>
    statSync(resolve(publicDirectory, 'local-checkpoints', name), { throwIfNoEntry: false })?.isFile(),
  ).map((name) => `/local-checkpoints/${name}`);
}
