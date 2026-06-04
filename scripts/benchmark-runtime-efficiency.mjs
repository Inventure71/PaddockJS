#!/usr/bin/env node

import {
  formatRuntimeEfficiencyBenchmarkMarkdown,
  runRuntimeEfficiencyBenchmarks,
  validateRuntimeEfficiencyBenchmarkResults,
} from './runtimeEfficiencyBenchmarks.mjs';

const args = process.argv.slice(2);
const json = args.includes('--json');
const verify = args.includes('--verify');
const profile = readOption('profile', args) ?? 'standard';

const results = runRuntimeEfficiencyBenchmarks({ profile, verify });
if (verify) validateRuntimeEfficiencyBenchmarkResults(results);

if (json) {
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
} else {
  process.stdout.write(formatRuntimeEfficiencyBenchmarkMarkdown(results));
}

function readOption(name, values) {
  const prefix = `--${name}=`;
  const inline = values.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = values.indexOf(`--${name}`);
  if (index >= 0) return values[index + 1];
  return null;
}
