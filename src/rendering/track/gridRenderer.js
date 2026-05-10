import { Graphics } from 'pixi.js';
import { offsetTrackPoint, pointAt } from '../../simulation/trackModel.js';
import { START_GRID_BOX_LENGTH, START_GRID_BOX_WIDTH, START_GRID_FIRST_DISTANCE, START_GRID_LATERAL_OFFSET, START_GRID_SLOT_COUNT, START_GRID_SLOT_SPACING } from './trackRenderConstants.js';

export function addStartingGrid(asset, track) {
    const grid = new Graphics();

    for (let index = 0; index < START_GRID_SLOT_COUNT; index += 1) {
      const base = pointAt(track, START_GRID_FIRST_DISTANCE - index * START_GRID_SLOT_SPACING);
      const lateralOffset = index % 2 === 0 ? -START_GRID_LATERAL_OFFSET : START_GRID_LATERAL_OFFSET;
      const center = offsetTrackPoint(base, lateralOffset);
      const forwardX = Math.cos(base.heading);
      const forwardY = Math.sin(base.heading);
      const normalX = base.normalX;
      const normalY = base.normalY;
      const halfLength = START_GRID_BOX_LENGTH / 2;
      const halfWidth = START_GRID_BOX_WIDTH / 2;
      const corners = [
        {
          x: center.x + forwardX * halfLength + normalX * halfWidth,
          y: center.y + forwardY * halfLength + normalY * halfWidth,
        },
        {
          x: center.x + forwardX * halfLength - normalX * halfWidth,
          y: center.y + forwardY * halfLength - normalY * halfWidth,
        },
        {
          x: center.x - forwardX * halfLength - normalX * halfWidth,
          y: center.y - forwardY * halfLength - normalY * halfWidth,
        },
        {
          x: center.x - forwardX * halfLength + normalX * halfWidth,
          y: center.y - forwardY * halfLength + normalY * halfWidth,
        },
      ];

      grid.poly(corners.flatMap((corner) => [corner.x, corner.y])).stroke({
        width: 3,
        color: 0xf8fafc,
        alpha: 0.8,
        join: 'round',
      });
    }

    asset.container.addChild(grid);
  
}
