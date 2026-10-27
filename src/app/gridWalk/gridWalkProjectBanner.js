import { queryRaceDataPanelBindings } from '../domBindings.js';
import { renderRaceData } from '../banners/raceDataBannerController.js';

// Grid Walk composes the real Race project banner, including its sizing,
// enabled/muted policy and presenter. Only its navigation action is an anchor.
export class GridWalkProjectBanner {
  constructor(element, onClose, signal) {
    this.bindings = queryRaceDataPanelBindings(element);
    this.element = this.bindings.raceDataPanel;
    this.element.setAttribute('data-grid-project-banner', '');
    this.heading = this.bindings.raceDataTitle;
    this.heading.setAttribute('data-grid-heading', '');
    this.heading.setAttribute('tabindex', '-1');
    this.open = true;
    this.element.querySelector('[data-race-data-dismiss]').addEventListener('click', onClose, { signal });
    element.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !this.element.hidden) { event.preventDefault(); onClose(); }
    }, { signal });
  }

  update({ active, clearing, enabled, car, drivers, options, presentation }) {
    enabled = enabled && options.ui?.showRaceDataPanel !== false;
    this.enabled = enabled;
    this.element.hidden = !this.open || !active || clearing || !enabled;
    if (!enabled) return;
    renderRaceData({ car, drivers, options, presentation, readouts: this.bindings });
  }

  measure(width, height) {
    if (!this.enabled) return 0;
    this.element.classList.toggle('race-data-panel--standalone', width < 600);
    this.element.style.maxHeight = `${Math.max(72, height * 0.34)}px`;
    // Reserve the same scene space after dismissal: closing a project must not
    // zoom or shift the grid under the newly restored focus.
    const hidden = this.element.hidden;
    this.element.hidden = false;
    const size = this.element.getBoundingClientRect().height;
    this.element.hidden = hidden;
    return size + 24;
  }

  focus() { if (!this.element.hidden) this.heading.focus({ preventScroll: true }); }
}
