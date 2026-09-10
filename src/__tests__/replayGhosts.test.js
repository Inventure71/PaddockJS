import { describe, expect, test } from 'vitest';
import {
  normalizeReplayGhosts,
  updateReplayGhosts,
} from '../simulation/replay/replayGhosts.js';

function sample(timeSeconds, x) {
  return {
    timeSeconds,
    x,
    y: x * 2,
    heading: x / 100,
    speedKph: x * 3,
    progressMeters: x * 4,
  };
}

describe('replay ghosts', () => {
  test('preserves endpoint and duplicate-timestamp interpolation semantics', () => {
    const [ghost] = normalizeReplayGhosts([{
      id: 'duplicate-times',
      trajectory: [
        sample(2, 30),
        sample(0, 0),
        sample(1, 10),
        sample(1, 20),
      ],
    }]);

    updateReplayGhosts([ghost], -1);
    expect(ghost.x).toBe(0);

    updateReplayGhosts([ghost], 1);
    expect(ghost.x).toBe(10);

    updateReplayGhosts([ghost], 1.5);
    expect(ghost.x).toBe(25);

    updateReplayGhosts([ghost], 3);
    expect(ghost.x).toBe(30);
  });

  test('selects the first duplicate at the start and the last duplicate at the end', () => {
    const [ghost] = normalizeReplayGhosts([{
      trajectory: [
        sample(0, 0),
        sample(0, 10),
        sample(1, 20),
        sample(2, 30),
        sample(2, 40),
      ],
    }]);

    updateReplayGhosts([ghost], 0);
    expect(ghost.x).toBe(0);

    updateReplayGhosts([ghost], 0.5);
    expect(ghost.x).toBe(15);

    updateReplayGhosts([ghost], 2);
    expect(ghost.x).toBe(40);
  });

  test('supports backward seeks while retaining the prior rendered pose', () => {
    const [ghost] = normalizeReplayGhosts([{
      trajectory: [sample(0, 0), sample(1, 10), sample(2, 20), sample(3, 30)],
    }]);

    updateReplayGhosts([ghost], 2.5);
    expect(ghost.x).toBe(25);

    updateReplayGhosts([ghost], 0.5);
    expect(ghost).toMatchObject({
      previousX: 25,
      x: 5,
      y: 10,
      speedKph: 15,
      progressMeters: 20,
      timeSeconds: 0.5,
    });
  });
});
