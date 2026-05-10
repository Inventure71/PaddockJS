import { colorToTint } from './displayUtils.js';

export class PitLaneStatusRenderer {
  constructor() {
    this.lastRenderKey = null;
  }

  reset() {
    this.lastRenderKey = null;
  }

  render(snapshot, pitLaneStatusLayer) {
    if (!pitLaneStatusLayer) return;
    const pitLane = snapshot.track?.pitLane;
    if (!pitLane?.enabled || !pitLane.mainLane?.start) {
      if (this.lastRenderKey !== 'none') {
        pitLaneStatusLayer.clear();
        this.lastRenderKey = 'none';
      }
      return;
    }
    const status = snapshot.pitLaneStatus ?? snapshot.raceControl?.pitLaneStatus;
    const color = colorToTint(status?.light ?? (status?.open ? '#22c55e' : '#ef4444'));
    const heading = pitLane.mainLane.heading ?? 0;
    const normal = pitLane.serviceNormal ?? { x: -Math.sin(heading), y: Math.cos(heading) };
    const sign = pitLane.workingLane?.offset != null && pitLane.workingLane.offset < 0 ? 1 : -1;
    const base = pitLane.mainLane.start;
    const x = base.x + normal.x * sign * (pitLane.width * 0.72);
    const y = base.y + normal.y * sign * (pitLane.width * 0.72);
    const renderKey = [
      color,
      x.toFixed(3),
      y.toFixed(3),
      pitLane.width,
      status?.open ? 1 : 0,
      status?.reason ?? '',
    ].join(':');
    if (renderKey === this.lastRenderKey) return;
    this.lastRenderKey = renderKey;

    pitLaneStatusLayer.clear();
    pitLaneStatusLayer
      .circle(x, y, 17)
      .fill({ color: 0x0b0f14, alpha: 0.92 })
      .circle(x, y, 11)
      .fill({ color, alpha: 0.94 })
      .circle(x, y, 18)
      .stroke({ width: 3, color: 0xf8fafc, alpha: 0.82 });
  }
}
