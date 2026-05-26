import { getTimingGapModeLabel, normalizeTimingGapMode } from '../config/timingGapMode.js';
import { createRaceControlStatusBannerMarkup } from './raceControlStatusBanner.js';
import { createComponentSurfaceMarkup, escapeHtml } from './templateUtils.js';

function normalizeTimingEntryVerticalPadding(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : 5;
}

export function createTimingTowerMarkup({ totalLaps, assets, id, ui = {} }) {
  const idAttribute = id ? `id="${escapeHtml(id)}" ` : '';
  const timingGapMode = normalizeTimingGapMode(ui.timingGapMode);
  const timingGapLabel = getTimingGapModeLabel(timingGapMode);
  const showGapToggle = ui.timingGapModeToggle !== false;
  const timingEntryVerticalPadding = normalizeTimingEntryVerticalPadding(ui.timingEntryVerticalPadding);
  const body = `
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
        ${createRaceControlStatusBannerMarkup()}
        <div class="broadcast-column-head">
          <span>Pos</span>
          <span>Team</span>
          <span>Project</span>
          ${showGapToggle
            ? `<button class="broadcast-gap-mode-toggle" type="button" data-timing-gap-toggle data-timing-gap-label aria-pressed="${timingGapMode === 'leader'}" aria-label="Timing gap mode ${escapeHtml(timingGapLabel)}">${escapeHtml(timingGapLabel)}</button>`
            : `<span data-timing-gap-label>${escapeHtml(timingGapLabel)}</span>`}
          <span>Tyre</span>
        </div>
        <ol class="timing-list" data-timing-list></ol>
      </div>
  `;

  return createComponentSurfaceMarkup({
    tagName: 'aside',
    className: 'sim-timing broadcast-tower',
    componentName: 'timing-tower',
    ariaLabel: 'Timing tower',
    attributes: `${idAttribute}data-timing-tower style="--timing-entry-extra-block-padding: ${timingEntryVerticalPadding}px"`,
    body,
    unsupportedLabel: 'Timing tower',
    loadingLabel: 'Timing tower',
  });
}
