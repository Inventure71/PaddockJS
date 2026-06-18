// Ad-hoc CPU profiling driver: runs the heaviest runtime loops so
// `node --cpu-prof` can attribute time to real functions.
import { createRaceSimulation, FIXED_STEP } from '../src/simulation/raceSimulation.js';
import { interpolateRenderSnapshotInto } from '../src/rendering/renderSnapshot.js';

const DEFAULT_STEPS = 20000;

function usage() {
  return [
    'Usage: node scripts/profile-hotspots.mjs [steps]',
    '  steps: positive integer number of fixed simulation steps to profile',
  ].join('\n');
}

function parseSteps(raw) {
  if (raw == null) return DEFAULT_STEPS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('steps must be a positive integer');
  }
  return value;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage());
    process.exit(0);
  }
  try {
    if (args.length > 1) {
      throw new Error(`Unexpected argument: ${args[1]}`);
    }
    return { steps: parseSteps(args[0]) };
  } catch (error) {
    console.error(`${usage()}\n\n${error.message}`);
    process.exit(1);
  }
}

const { steps: STEPS } = parseArgs(process.argv);

const drivers = Array.from({ length: 20 }, (_, index) => ({
  id: `bench-${index}`,
  code: `B${index}`,
  icon: `B${index}`,
  raceName: `Bench ${index}`,
  name: `Bench Driver ${index}`,
  color: ['#e10600', '#00a3ff', '#f1c65b', '#38bdf8', '#22c55e'][index % 5],
  tire: 'M',
  pace: 1,
  racecraft: 0.8,
}));
const sim = createRaceSimulation({
  drivers,
  seed: 7,
  trackSeed: 11,
  totalLaps: 50,
  physicsMode: 'advanced',
  warmup: { enabled: false },
});

let renderBuffer = {};
let sourceBuffer = {};
const t0 = performance.now();
for (let i = 0; i < STEPS; i += 1) {
  sim.step(FIXED_STEP);
  // Mirror the frame loop: a render snapshot every step, a full snapshot at DOM cadence (~ every 6 steps).
  sourceBuffer = sim.snapshotRenderInto(sourceBuffer);
  renderBuffer = interpolateRenderSnapshotInto(renderBuffer, sourceBuffer, 0.5);
  if (i % 6 === 0) sim.snapshot();
}
const t1 = performance.now();
console.log(`steps=${STEPS} totalMs=${(t1 - t0).toFixed(1)} msPerStep=${((t1 - t0) / STEPS).toFixed(4)}`);
