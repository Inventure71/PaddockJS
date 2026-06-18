const HELP_FLAGS = new Set(['--help', '-h']);
const SUPPORTED_ARGS = new Set(['--quick', '--full', '--skip-build', ...HELP_FLAGS]);

export function parseBrowserSmokeArgs(args = [], { skipBuildEnv = process.env.PADDOCKJS_BROWSER_SMOKE_SKIP_BUILD === '1' } = {}) {
  for (const arg of args) {
    if (!SUPPORTED_ARGS.has(arg)) {
      throw new Error(`Unknown browser smoke argument: ${arg}`);
    }
  }
  const help = args.some((arg) => HELP_FLAGS.has(arg));
  if (help) {
    return {
      help: true,
      quickMode: false,
      fullMode: false,
      skipBuild: false,
    };
  }
  if (args.includes('--quick') && args.includes('--full')) {
    throw new Error('Choose either --quick or --full, not both');
  }
  return {
    quickMode: args.includes('--quick'),
    fullMode: args.includes('--full'),
    skipBuild: args.includes('--skip-build') || skipBuildEnv,
  };
}

export function browserSmokeUsage() {
  return [
    'Usage: node smoke/browser-smoke.mjs [--quick|--full] [--skip-build] [--help]',
    '  --quick runs only the quick smoke.',
    '  --full runs the full smoke matrix.',
    '  --skip-build reuses local-preview/dist.',
  ].join('\n');
}
