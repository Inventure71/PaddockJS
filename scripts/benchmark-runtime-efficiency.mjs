#!/usr/bin/env node

import {
  formatRuntimeEfficiencyBenchmarkMarkdown,
  runRuntimeEfficiencyBenchmarks,
  validateRuntimeEfficiencyBenchmarkResults,
} from './runtimeEfficiencyBenchmarks.mjs';
import { parseRuntimeBenchmarkArgs, runtimeBenchmarkUsage } from './benchmarkRuntimeArgs.mjs';

let cliOptions;
try {
  cliOptions = parseRuntimeBenchmarkArgs(process.argv.slice(2));
} catch (error) {
  console.error(`${runtimeBenchmarkUsage()}\n\n${error.message}`);
  process.exit(1);
}

const { json, verify, profile } = cliOptions;
if (cliOptions.help) {
  console.log(runtimeBenchmarkUsage());
  process.exit(0);
}

const results = runRuntimeEfficiencyBenchmarks({ profile, verify });
if (verify) validateRuntimeEfficiencyBenchmarkResults(results);

if (json) {
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
} else {
  process.stdout.write(formatRuntimeEfficiencyBenchmarkMarkdown(results));
}
