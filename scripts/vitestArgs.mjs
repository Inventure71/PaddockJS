export function buildVitestArgs(argv = []) {
  const targets = argv.filter((arg) => arg !== '--slow');
  return ['run', ...(targets.length ? targets : ['src'])];
}
