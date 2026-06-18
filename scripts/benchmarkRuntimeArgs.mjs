const SUPPORTED_PROFILES = new Set(['standard', 'smoke']);
const HELP_FLAGS = new Set(['--help', '-h']);
const SUPPORTED_FLAGS = new Set(['--json', '--verify', ...HELP_FLAGS]);

export function parseRuntimeBenchmarkArgs(args = []) {
  let profile = 'standard';
  let json = false;
  let verify = false;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (HELP_FLAGS.has(arg)) {
      help = true;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--verify') {
      verify = true;
    } else if (arg === '--profile') {
      index += 1;
      profile = args[index];
    } else if (arg?.startsWith('--profile=')) {
      profile = arg.slice('--profile='.length);
    } else if (!SUPPORTED_FLAGS.has(arg)) {
      throw new Error(`Unknown runtime benchmark argument: ${arg}`);
    }
  }

  if (help) return { json, verify, profile, help };

  if (!SUPPORTED_PROFILES.has(profile)) {
    throw new Error(`profile must be one of: ${[...SUPPORTED_PROFILES].join(', ')}`);
  }

  return { json, verify, profile, help };
}

export function runtimeBenchmarkUsage() {
  return [
    'Usage: node scripts/benchmark-runtime-efficiency.mjs [--profile=standard|smoke] [--json] [--verify] [--help]',
    '  profile must be one of: standard, smoke',
  ].join('\n');
}
