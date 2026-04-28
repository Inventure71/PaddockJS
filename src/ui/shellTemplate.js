import {
  createRaceCanvasMarkup,
  createRaceControlsMarkup,
  createTelemetryPanelMarkup,
  createTimingTowerMarkup,
} from './componentTemplates.js';

export function createF1SimulatorShell({
  title,
  kicker,
  backLinkHref,
  backLinkLabel,
  showBackLink,
  totalLaps,
  assets,
}) {
  return `
    <main class="f1-sim-component sim-shell" data-f1-simulator-shell>
      <section class="sim-workspace" aria-label="F1 race simulator">
        ${createRaceControlsMarkup({ title, kicker, backLinkHref, backLinkLabel, showBackLink })}
        <div class="sim-grid">
          ${createTimingTowerMarkup({ totalLaps, assets })}
          ${createRaceCanvasMarkup({ includeRaceDataPanel: true, assets })}
          ${createTelemetryPanelMarkup({ assets })}
        </div>
      </section>
    </main>
  `;
}
