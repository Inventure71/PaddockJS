export function buildVitestArgs(argv = []) {
  const includeSlowTests = argv.includes('--slow');
  const forceSingleWorker = argv.includes('--runInBand');
  const targets = argv.filter((arg) => arg !== '--slow' && arg !== '--runInBand');
  return [
    'run',
    ...(targets.length ? targets : ['src']),
    ...(includeSlowTests || forceSingleWorker ? ['--maxWorkers=1'] : []),
  ];
}
