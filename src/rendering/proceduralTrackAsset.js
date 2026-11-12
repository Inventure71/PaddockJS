import { Container } from 'pixi.js';
import { WORLD } from '../simulation/track/trackModel.js';
import { destroyDisplayChildren } from './displayLifecycle.js';
import { addAsphalt, addBarriers, addBorderSteps, addBoundaryUnderlay, addGrass, addGravelRunoff, addKerbSteps } from './track/trackMaterialRenderer.js';
import { finishTrackRenderSteps, finishTrackRenderStepsAsync } from './track/trackRenderSteps.js';
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
    finishTrackRenderSteps(this.renderSteps(track));
  }

  async renderAsync(track, { checkpoint }) {
    await finishTrackRenderStepsAsync(this.renderSteps(track), checkpoint);
  }

  *renderSteps(track) {
    destroyDisplayChildren(this.container);
    yield;
    addGrass(this);
    yield;
    addGravelRunoff(this, track);
    yield;
    addBoundaryUnderlay(this, track);
    yield;
    addPitLaneRunoff(this, track);
    yield;
    addPitLane(this, track);
    yield;
    addAsphalt(this, track);
    yield;
    yield* addKerbSteps(this, track);
    yield* addBorderSteps(this, track);
    yield;
    addStartingGrid(this, track);
    yield;
    addFinishLine(this, track);
    yield;
    addBarriers(this, track);
  }
}
