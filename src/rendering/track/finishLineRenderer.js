import { Graphics } from 'pixi.js';
import { offsetTrackPoint, pointAt } from '../../simulation/trackModel.js';
import { FINISH_LINE_COLUMNS, FINISH_LINE_DEPTH } from './trackRenderConstants.js';

export function addFinishLine(asset, track) {
    const finishLine = new Graphics();
    const halfDepth = FINISH_LINE_DEPTH / 2;
    addFinishLineHalf(finishLine, track, -halfDepth, 0, 0);
    addFinishLineHalf(finishLine, track, 0, halfDepth, 1);
    asset.container.addChild(finishLine);
  
}

export function addFinishLineHalf(graphics, track, startDistance, endDistance, rowOffset) {
    const start = pointAt(track, startDistance);
    const end = pointAt(track, endDistance);
    const roadPadding = 10;
    const width = track.width - roadPadding * 2;
    const leftEdge = -width / 2;
    const cellWidth = width / FINISH_LINE_COLUMNS;

    for (let column = 0; column < FINISH_LINE_COLUMNS; column += 1) {
      const innerOffset = leftEdge + column * cellWidth;
      const outerOffset = innerOffset + cellWidth;
      const color = (column + rowOffset) % 2 === 0 ? 0xf8fafc : 0x0b0d12;
      const a = offsetTrackPoint(start, innerOffset);
      const b = offsetTrackPoint(start, outerOffset);
      const c = offsetTrackPoint(end, outerOffset);
      const d = offsetTrackPoint(end, innerOffset);

      graphics.poly([a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y]).fill(color);
    }
  
}
