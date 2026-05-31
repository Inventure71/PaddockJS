import { execFileSync } from 'node:child_process';
import { describe, expect, test } from 'vitest';
import {
  REQUIRED_RUNTIME_BENCHMARK_CATEGORIES,
  runRuntimeEfficiencyBenchmarks,
  validateRuntimeEfficiencyBenchmarkResults,
} from '../../scripts/runtimeEfficiencyBenchmarks.mjs';

describe('runtime efficiency benchmarks', () => {
  test('cover the simulation, sensor, snapshot, render, and DOM hot paths', () => {
    const results = runRuntimeEfficiencyBenchmarks({
      profile: 'smoke',
      format: 'json',
      now: () => performance.now(),
    });

    expect(results.profile).toBe('smoke');
    expect(results.benchmarks.length).toBeGreaterThanOrEqual(REQUIRED_RUNTIME_BENCHMARK_CATEGORIES.length);
    expect(new Set(results.benchmarks.map((benchmark) => benchmark.category))).toEqual(
      new Set(REQUIRED_RUNTIME_BENCHMARK_CATEGORIES),
    );
    expect(results.benchmarks.find((benchmark) => benchmark.category === 'simulation-phases')?.checks.phaseNames).toEqual(
      expect.arrayContaining(['prePhysicsWheelSurface', 'runoffResponse', 'localSurfaceRefresh', 'broadRaceCommit']),
    );
    expect(results.benchmarks.find((benchmark) => benchmark.category === 'snapshots')?.checks).toEqual(
      expect.objectContaining({
        fullSnapshots: expect.any(Number),
        renderSnapshots: expect.any(Number),
        observationSnapshots: expect.any(Number),
        trainingSnapshots: expect.any(Number),
      }),
    );
    expect(results.benchmarks.find((benchmark) => benchmark.category === 'snapshot-json')?.checks).toEqual(
      expect.objectContaining({
        fullBytes: expect.any(Number),
        renderBytes: expect.any(Number),
      }),
    );
    expect(results.benchmarks.find((benchmark) => benchmark.category === 'policy-server-json')?.checks).toEqual(
      expect.objectContaining({
        richBytes: expect.any(Number),
        compactBytes: expect.any(Number),
        byteReductionRatio: expect.any(Number),
        richStringifyMs: expect.any(Number),
        compactStringifyMs: expect.any(Number),
        stringifyReductionRatio: expect.any(Number),
      }),
    );
    expect(() => validateRuntimeEfficiencyBenchmarkResults(results)).not.toThrow();
  });

  test('rejects benchmark results that do not exercise their intended workload', () => {
    const results = runRuntimeEfficiencyBenchmarks({
      profile: 'smoke',
      format: 'json',
      now: () => performance.now(),
    });
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark, index) => (
        index === 0
          ? {
              ...benchmark,
              operations: 0,
              checks: { ...benchmark.checks, operations: 0 },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/did not execute/i);
  });

  test('CLI verify mode emits machine-readable benchmark evidence', () => {
    const output = execFileSync(
      process.execPath,
      ['scripts/benchmark-runtime-efficiency.mjs', '--profile=smoke', '--json', '--verify'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      },
    );
    const parsed = JSON.parse(output);

    expect(parsed.profile).toBe('smoke');
    expect(parsed.benchmarks.map((benchmark) => benchmark.name)).toContain('simulation.step advanced field');
    expect(() => validateRuntimeEfficiencyBenchmarkResults(parsed)).not.toThrow();
  });
});
