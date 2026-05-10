import { Graphics } from 'pixi.js';
import { offsetTrackPoint, pointAt } from '../../simulation/trackModel.js';
import { destroyDisplayChildren } from './displayUtils.js';

export function renderTrackSurface({ drsLayer, sensorLayer, pitLaneStatusLayer, trackAsset, snapshot }) {
  destroyDisplayChildren(drsLayer);
  sensorLayer?.clear();
  pitLaneStatusLayer?.clear();
  const track = snapshot.track;

  trackAsset.render(track);

  track.drsZones.forEach((zone) => {
    const zoneLine = new Graphics();
    const steps = 44;
    for (let index = 0; index <= steps; index += 1) {
      const basePoint = pointAt(track, zone.start + ((zone.end - zone.start) * index) / steps);
      const point = offsetTrackPoint(basePoint, track.width / 2 - 22);
      if (index === 0) zoneLine.moveTo(point.x, point.y);
      else zoneLine.lineTo(point.x, point.y);
    }
    zoneLine.stroke({ width: 8, color: 0x14c784, alpha: 0.5, join: 'round', cap: 'round' });
    drsLayer.addChild(zoneLine);
  });
}
