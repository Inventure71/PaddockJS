import { beforeEach, describe, expect, test } from 'vitest';
import { createRaceSimulation } from '../simulation/raceSimulation.js';

describe('pit state through simulation snapshots', () => {
  let sim;
  beforeEach(() => {
    sim = createRaceSimulation({
      drivers: [{ id: 'driver', code: 'DRV', name: 'Driver', color: '#ff0000', pace: 1, racecraft: 0.8 }],
      seed: 71,
      trackSeed: 2097,
      warmup: false,
      rules: { modules: { pitStops: { enabled: true } } },
    });
  });

  test('full, observation and training snapshots agree on requested intent and service state', () => {
    expect(sim.setPitIntent('driver', 2, 'H')).toBe(true);
    const stop = sim.cars[0].pitStop;
    stop.serviceRemaining = 1.25;
    stop.penaltyServiceRemaining = Infinity;
    const full = sim.snapshot().cars[0];
    for (const car of [full, sim.snapshotObservation().cars[0], sim.snapshotTraining().cars[0]]) {
      expect(car.pitIntent).toBe(2);
      expect(car.pitStop).toMatchObject({
        intent: 2,
        targetTire: 'H',
        status: stop.status,
        phase: stop.phase ?? null,
        serviceRemainingSeconds: 1.25,
        penaltyServiceRemainingSeconds: null,
      });
    }
    expect(sim.snapshotRender().cars[0].pitStop).toEqual({
      phase: stop.phase ?? null,
      serviceRemainingSeconds: 1.25,
      penaltyServiceRemainingSeconds: null,
    });
  });

  test('full snapshots own penalty ID arrays, service profiles and pit crew metadata', () => {
    sim.beginTireService(sim.cars[0]);
    const stop = sim.cars[0].pitStop;
    stop.servingPenaltyIds = ['penalty'];
    const originalSeconds = stop.serviceProfile.seconds;
    const originalCrew = { ...stop.serviceProfile.pitCrew };
    const first = sim.snapshot().cars[0].pitStop;
    first.servingPenaltyIds.push('host-edit');
    first.serviceProfile.seconds = 99;
    first.serviceProfile.pitCrew.speed = 99;
    expect(stop.servingPenaltyIds).toEqual(['penalty']);
    expect(stop.serviceProfile.seconds).toBe(originalSeconds);
    expect(stop.serviceProfile.pitCrew).toEqual(originalCrew);
    const second = sim.snapshot().cars[0].pitStop;
    stop.servingPenaltyIds.push('later-penalty');
    stop.serviceProfile.seconds = 5;
    stop.serviceProfile.pitCrew.consistency = 99;
    expect(second.servingPenaltyIds).toEqual(['penalty']);
    expect(second.serviceProfile.seconds).toBe(originalSeconds);
    expect(second.serviceProfile.pitCrew).toEqual(originalCrew);
  });

  test('invalid internal intent retains the zero snapshot default', () => {
    sim.cars[0].pitStop.intent = 3;
    for (const car of [sim.snapshot().cars[0], sim.snapshotObservation().cars[0], sim.snapshotTraining().cars[0]]) {
      expect(car.pitIntent).toBe(0);
      expect(car.pitStop.intent).toBe(0);
    }
  });

  test('missing pit state stays null across snapshot variants', () => {
    sim.cars[0].pitStop = null;
    for (const snapshot of [sim.snapshot(), sim.snapshotObservation(), sim.snapshotTraining(), sim.snapshotRender()]) {
      expect(snapshot.cars[0].pitStop).toBeNull();
    }
    expect(sim.snapshot().cars[0].pitIntent).toBe(0);
  });
});
