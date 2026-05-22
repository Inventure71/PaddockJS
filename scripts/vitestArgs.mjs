export function buildVitestArgs(argv = []) {
  const includeSlowTests = argv.includes('--slow');
  const targets = argv.filter((arg) => arg !== '--slow' && arg !== '--runInBand');
  return [
    'run',
    ...(targets.length ? targets : ['src']),
    '--maxWorkers=1',
  ];
}
