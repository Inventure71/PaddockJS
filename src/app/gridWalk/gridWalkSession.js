import { getStartGridSlot } from '../../simulation/vehicle/vehicleState.js';
import { offsetTrackPoint, pointAt } from '../../simulation/track/trackModel.js';

// This state owns display poses only. It never steps, resets or writes the race.
export class GridWalkSession {
  constructor(simulation, options) {
    this.view = options.initialView;
    this.hasRaced = this.view === 'race';
    this.clearing = false;
    this.clearElapsed = 0;
    const snapshot = simulation.snapshot();
    const participants = new Map(simulation.cars.map((car) => [car.id, car]));
    this.snapshot = {
      ...snapshot,
      replayGhosts: [],
      safetyCar: { ...snapshot.safetyCar, deployed: false },
      cars: snapshot.cars.map((car) => {
        const participant = participants.get(car.id);
        // Standing starts use the actual assigned slots, including grid penalties.
        // Rolling starts get display-only staging slots without changing their rules.
        const slot = participant.gridLocked ? participant : getStartGridSlot(participant.index, { standingStart: true });
        const point = pointAt(simulation.track, slot.gridDistance);
        const pose = offsetTrackPoint(point, slot.gridOffset);
        return { ...car, ...pose, heading: point.heading, speed: 0, drsActive: false,
          previousX: pose.x, previousY: pose.y, previousHeading: point.heading,
          gridDistance: slot.gridDistance, gridOffset: slot.gridOffset };
      }).sort((a, b) => b.gridDistance - a.gridDistance),
    };
  }

  get active() { return this.view === 'grid-walk' || this.clearing; }

  setView(view, motion) {
    if (!['grid-walk', 'race'].includes(view) || view === this.view) return false;
    this.view = view;
    this.clearing = view === 'race' && !this.hasRaced && motion;
    this.clearElapsed = 0;
    if (view === 'race' && !this.clearing) this.hasRaced = true;
    return true;
  }

  advance(elapsedMs, motion) {
    if (!this.clearing) return;
    this.clearElapsed += Math.max(0, Math.min(elapsedMs, 100));
    if (!motion || this.clearElapsed >= 650) {
      this.clearing = false;
      this.hasRaced = true;
    }
  }
}
