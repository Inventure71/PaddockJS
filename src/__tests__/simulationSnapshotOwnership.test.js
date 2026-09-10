import { describe, expect, test } from 'vitest';
import { createRaceSimulation } from '../simulation/raceSimulation.js';
import { buildTrackModel, nearestTrackState } from '../simulation/track/trackModel.js';
import { normalizeSimulatorDrivers } from '../data/normalizeDrivers.js';

const options = {
  drivers: [{ id: 'driver', name: 'Driver', color: '#ff0000' }],
  seed: 71,
  warmup: false,
  rules: { modules: { pitStops: { enabled: true } } },
};

describe('simulation snapshot ownership', () => {
  test.each(['pitCrew', 'pitCrewStats'])('public team snapshots own nested %s from normalized entries', (field) => {
    const inputTeam = { id: 'team', name: 'Team', [field]: { speed: 0.7, reliability: 0.8 } };
    const drivers = normalizeSimulatorDrivers(options.drivers, {
      entries: [{ driverId: 'driver', team: inputTeam }],
    });
    const sim = createRaceSimulation({ ...options, drivers });
    const liveTeam = sim.cars[0].team;
    const first = sim.snapshot().cars[0].team;
    expect(first).toEqual(liveTeam);
    expect(first[field]).toEqual({ speed: 0.7, reliability: 0.8 });
    first[field].speed = 0.1;
    first[field].consistency = 0.2;
    expect(inputTeam[field]).toEqual({ speed: 0.7, reliability: 0.8 });
    expect(drivers[0].team[field]).toEqual({ speed: 0.7, reliability: 0.8 });
    expect(liveTeam[field]).toEqual({ speed: 0.7, reliability: 0.8 });

    const next = sim.snapshot().cars[0].team;
    expect(next[field]).toEqual({ speed: 0.7, reliability: 0.8 });
    liveTeam[field].reliability = 0.3;
    inputTeam[field].speed = 0.4;
    expect(next[field]).toEqual({ speed: 0.7, reliability: 0.8 });
    expect(first[field]).toEqual({ speed: 0.1, consistency: 0.2, reliability: 0.8 });
    const omittedField = field === 'pitCrew' ? 'pitCrewStats' : 'pitCrew';
    expect(Object.hasOwn(next, omittedField)).toBe(false);
  });

  test.each([
    { id: 'team' },
    { id: 'team', pitCrew: undefined, pitCrewStats: undefined },
    { id: 'team', pitCrew: {}, pitCrewStats: {} },
  ])('team snapshots preserve optional crew fields without adding defaults: %j', (team) => {
    const drivers = normalizeSimulatorDrivers(options.drivers, {
      entries: [{ driverId: 'driver', team }],
    });
    const snapshotTeam = createRaceSimulation({ ...options, drivers }).snapshot().cars[0].team;
    expect(snapshotTeam).toStrictEqual(drivers[0].team);
    for (const field of ['pitCrew', 'pitCrewStats']) {
      expect(Object.hasOwn(snapshotTeam, field)).toBe(Object.hasOwn(team, field));
    }
  });

  test('editing a public penalty cannot change its future pit service or later snapshots', () => {
    const sim = createRaceSimulation(options);
    sim.recordPenalty({
      type: 'track-limits',
      driverId: 'driver',
      consequences: [{ type: 'time', seconds: 5 }],
      wheelOffsets: [1, 2, 3, 4],
    });
    sim.recordPenalty({
      type: 'tire-requirement',
      driverId: 'driver',
      consequences: [{ type: 'warning' }],
      usedCompounds: ['M'],
    });
    const snapshot = sim.snapshot();
    const limit = snapshot.penalties.find((penalty) => penalty.type === 'track-limits');
    const tire = snapshot.penalties.find((penalty) => penalty.type === 'tire-requirement');
    limit.consequences[0].seconds = 99;
    limit.consequences.push({ type: 'time', seconds: 99 });
    limit.wheelOffsets[0] = 99;
    tire.usedCompounds.push('H');
    expect(sim.beginPitPenaltyService(sim.cars[0])).toBe(true);
    expect(sim.cars[0].pitStop.penaltyServiceRemaining).toBe(5);

    const next = sim.snapshot();
    const nextLimit = next.penalties.find((penalty) => penalty.type === 'track-limits');
    const nextTire = next.penalties.find((penalty) => penalty.type === 'tire-requirement');
    expect(nextLimit.consequences).toEqual([{ type: 'time', seconds: 5 }]);
    expect(nextLimit.wheelOffsets).toEqual([1, 2, 3, 4]);
    expect(nextTire.usedCompounds).toEqual(['M']);

    const liveLimit = sim.penalties.find((penalty) => penalty.type === 'track-limits');
    const liveTire = sim.penalties.find((penalty) => penalty.type === 'tire-requirement');
    liveLimit.consequences[0].seconds = 10;
    liveLimit.wheelOffsets.push(5);
    liveTire.usedCompounds.push('S');
    expect(nextLimit.consequences).toEqual([{ type: 'time', seconds: 5 }]);
    expect(nextLimit.wheelOffsets).toEqual([1, 2, 3, 4]);
    expect(nextTire.usedCompounds).toEqual(['M']);
  });

  test('cached grid topology cannot be changed through one simulation and poison another', () => {
    const built = buildTrackModel();
    const first = createRaceSimulation(options);
    const second = createRaceSimulation(options);
    const position = built.samples[100];
    const expected = nearestTrackState(second.track, position);
    const grids = [built.queryIndex.grid, built.queryIndex.segmentGrid,
      built.queryIndex.pit.roadGrid, built.queryIndex.pit.boxGrid];
    for (const grid of grids) {
      const cellIndex = grid.cells.findIndex(Boolean);
      expect(cellIndex).toBeGreaterThanOrEqual(0);
      expect(() => { grid.cells[cellIndex].push(-1); }).toThrow(TypeError);
      expect(() => { grid.cells[cellIndex] = []; }).toThrow(TypeError);
    }
    expect(first.track.queryIndex.segmentGrid).toBe(built.queryIndex.segmentGrid);
    expect(second.track.queryIndex.segmentGrid).toBe(built.queryIndex.segmentGrid);
    expect(first.track.queryIndex.queryScratch).not.toBe(second.track.queryIndex.queryScratch);
    expect(nearestTrackState(second.track, position)).toEqual(expected);
    expect(first.track.queryIndex.stats).not.toBe(second.track.queryIndex.stats);
  });
});
