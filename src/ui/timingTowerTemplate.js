import { createRaceControlStatusBannerMarkup } from './raceControlStatusBanner.js';
import { createLoadingMarkup, escapeHtml } from './templateUtils.js';

export function createTimingTowerMarkup({ totalLaps, assets }) {
  return `
    <aside class="sim-timing broadcast-tower" data-paddock-component="timing-tower" data-timing-tower aria-label="Timing tower">
      <div class="broadcast-tower-frame">
        <div class="broadcast-brand">
          <img class="broadcast-f1-logo" src="${escapeHtml(assets.f1Logo)}" alt="F1" />
        </div>
        <div class="broadcast-lap">
          <span>Lap</span>
          <strong data-tower-lap-readout>1</strong>
          <span>/</span>
          <span data-tower-total-laps>${escapeHtml(totalLaps)}</span>
        </div>
        <div class="broadcast-gap-mode" role="group" aria-label="Timing gap mode">
          <button type="button" data-timing-gap-mode="interval" aria-pressed="true">Int</button>
          <button type="button" data-timing-gap-mode="leader" aria-pressed="false">Gap</button>
        </div>
        ${createRaceControlStatusBannerMarkup()}
        <div class="broadcast-column-head" aria-hidden="true">
          <span>Pos</span>
          <span>Team</span>
          <span>Project</span>
          <span data-timing-gap-label>Int</span>
          <span>Tyre</span>
        </div>
        <ol class="timing-list" data-timing-list></ol>
      </div>
      ${createLoadingMarkup('Timing tower')}
    </aside>
  `;
}
