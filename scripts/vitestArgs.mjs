export function buildVitestArgs(argv = []) {
  const includeSlowTests = argv.includes('--slow');
  const targets = argv.filter((arg) => arg !== '--slow');
  return [
    'run',
    ...(targets.length ? targets : ['src']),
    ...(includeSlowTests ? ['--maxWorkers=1'] : []),
  ];
}
