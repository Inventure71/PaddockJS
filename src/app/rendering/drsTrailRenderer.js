import { metersToSimUnits } from '../../simulation/units.js';
import { clamp } from '../../simulation/simMath.js';
import { CAR_WORLD_LENGTH } from '../camera/cameraConstants.js';

const DRS_TRAIL_TTL = 0.34;
const DRS_TRAIL_MIN_DISTANCE = metersToSimUnits(0.9);

function pruneExpiredTrailPoints(history, now) {
  let expiredCount = 0;
  while (expiredCount < history.length && now - history[expiredCount].at > DRS_TRAIL_TTL) {
    expiredCount += 1;
  }
  if (expiredCount > 0) history.splice(0, expiredCount);
}

export class DrsTrailRenderer {
  constructor({ trails }) {
    this.trails = trails;
  }

  reset() {
    this.trails.clear();
  }

  render(snapshot, trailLayer) {
    if (!trailLayer) return;

    snapshot.cars.forEach((car) => {
      const history = this.trails.get(car.id);
      if (!history && !car.drsActive) return;
      const activeHistory = history ?? [];
      const rear = {
        x: car.x - Math.cos(car.heading) * CAR_WORLD_LENGTH * 0.46,
        y: car.y - Math.sin(car.heading) * CAR_WORLD_LENGTH * 0.46,
        at: snapshot.time,
      };
      const last = activeHistory[activeHistory.length - 1];

      if (
        car.drsActive &&
        (!last || Math.hypot(rear.x - last.x, rear.y - last.y) >= DRS_TRAIL_MIN_DISTANCE)
      ) {
        activeHistory.push(rear);
      }

      pruneExpiredTrailPoints(activeHistory, snapshot.time);
      if (activeHistory.length) this.trails.set(car.id, activeHistory);
      else this.trails.delete(car.id);
    });

    trailLayer.clear();
    this.trails.forEach((history) => {
      if (history.length < 2) return;
      const newest = history[history.length - 1];
      const newestLife = clamp(1 - (snapshot.time - newest.at) / DRS_TRAIL_TTL, 0, 1);
      trailLayer.moveTo(history[0].x, history[0].y);
      for (let index = 1; index < history.length; index += 1) {
        trailLayer.lineTo(history[index].x, history[index].y);
      }
      trailLayer.stroke({
        width: 10,
        color: 0x3be8ff,
        alpha: 0.28 + newestLife * 0.34,
        cap: 'round',
        join: 'round',
      });
      trailLayer.moveTo(history[0].x, history[0].y);
      for (let index = 1; index < history.length; index += 1) {
        trailLayer.lineTo(history[index].x, history[index].y);
      }
      trailLayer.stroke({
        width: 3.2,
        color: 0xd8fbff,
        alpha: 0.18 + newestLife * 0.28,
        cap: 'round',
        join: 'round',
      });
    });
  }
}
