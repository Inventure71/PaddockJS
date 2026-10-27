import { describe, expect, test } from 'vitest';
import { createRaceSimulation } from '../simulation/raceSimulation.js';
import { TRACK } from '../simulation/track/trackModel.js';

function createSimulation() {
  const sim = createRaceSimulation({
    seed: 71, track: TRACK, warmup: false, rules: { standingStart: false },
    drivers: ['alpha', 'beta', 'retired', 'overlay', 'batch'].map((id) => ({ id, name: id })),
    participantInteractions: { drivers: {
      overlay: { profile: 'time-trial-overlay' },
      batch: { profile: 'batch-training' },
    } },
  });
  sim.cars[0].raceDistance = 100;
  sim.cars[1].raceDistance = 200;
  sim.cars[2].outOfRace = true;
  sim.cars[2].dnfOrder = 1;
  // Source array order is not a valid substitute for extras' index order.
  sim.cars.reverse();
  return sim;
}

describe('pooled render snapshot ordering', () => {
  test.each(['green', 'safety-car', 'partial-finish', 'classification'])('preserves ranked and excluded participants in %s', (mode) => {
    const sim = createSimulation();
    if (mode === 'safety-car') sim.setSafetyCar(true);
    if (mode === 'partial-finish') {
      sim.raceControl.finishOrder = ['alpha'];
      sim.cars.find((car) => car.id === 'alpha').finished = true;
    }
    if (mode === 'classification') {
      sim.raceControl.finished = true;
      sim.raceControl.classification = [{ id: 'alpha' }, { id: 'beta' }, { id: 'retired' }];
    }
    const expectedIds = ['partial-finish', 'classification'].includes(mode)
      ? ['alpha', 'beta', 'retired', 'overlay', 'batch']
      : ['beta', 'alpha', 'retired', 'overlay', 'batch'];
    const buffer = {};
    const fresh = sim.snapshotRender();
    const freshCars = structuredClone(fresh.cars);
    const pooled = sim.snapshotRenderInto(buffer);
    expect(pooled.cars.map((car) => car.id)).toEqual(expectedIds);
    expect(pooled.cars).toEqual(fresh.cars);
    const array = pooled.cars;
    const records = [...array];
    for (const car of sim.cars) car.x += 3;
    expect(sim.snapshotRenderInto(buffer).cars).toBe(array);
    expect(array.every((car, index) => car === records[index])).toBe(true);
    expect(array).toEqual(sim.snapshotRender().cars);
    expect(fresh.cars).toEqual(freshCars);
    expect(fresh.cars).not.toBe(array);
    expect(fresh.cars.every((car, index) => car !== array[index])).toBe(true);
  });

  test('reuses a target across simulations without retaining membership or missing resized participants', () => {
    const first = createSimulation();
    const second = createRaceSimulation({
      seed: 72, track: TRACK, warmup: false, rules: { standingStart: false },
      drivers: [{ id: 'batch', name: 'Reused ID' }, { id: 'new', name: 'New' }],
    });
    const target = first.snapshotRenderInto({});
    const array = target.cars;
    const record = array[0];
    second.snapshotRenderInto(target);
    expect(target.cars).toBe(array);
    expect(target.cars[0]).toBe(record);
    expect(target.cars).toHaveLength(2);
    expect(target.cars).toEqual(second.snapshotRender().cars);
    first.snapshotRenderInto(target);
    expect(target.cars).toHaveLength(5);
    expect(target.cars).toEqual(first.snapshotRender().cars);
    expect(Reflect.ownKeys(target)).toEqual(Reflect.ownKeys(first.snapshotRender()));
    expect(Reflect.ownKeys(target.cars)).toEqual(Reflect.ownKeys(first.snapshotRender().cars));
  });
});
