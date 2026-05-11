import { Container } from 'pixi.js';
import { WORLD } from '../simulation/track/trackModel.js';
import { destroyDisplayChildren } from './track/trackRenderGeometry.js';
import { addAsphalt, addBarriers, addBorders, addBoundaryUnderlay, addGrass, addGravelRunoff, addKerbs } from './track/trackMaterialRenderer.js';
import { addPitLane, addPitLaneRunoff } from './track/pitLaneRenderer.js';
import { addStartingGrid } from './track/gridRenderer.js';
import { addFinishLine } from './track/finishLineRenderer.js';

export { offsetGapBridgeIsSafe, offsetSegmentIsSafe, getOffsetGapBridges, getOffsetStrokeSegments } from './track/offsetStrokeSafety.js';
export { getTrackMaterialBands } from './track/trackMaterialRenderer.js';

export class ProceduralTrackAsset {
  constructor({ textures = {}, world = WORLD } = {}) {
    this.textures = textures;
    this.world = world;
    this.container = new Container();
  }

  render(track) {
    destroyDisplayChildren(this.container);
    addGrass(this);
    addGravelRunoff(this, track);
    addBoundaryUnderlay(this, track);
    addPitLaneRunoff(this, track);
    addPitLane(this, track);
    addAsphalt(this, track);
    addKerbs(this, track);
    addBorders(this, track);
    addStartingGrid(this, track);
    addFinishLine(this, track);
    addBarriers(this, track);
  }
}
