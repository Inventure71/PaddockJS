// Separately mounted controls share one runtime view; they never own race state.
export class SimulatorViewControls {
  constructor(root, onView, signal) {
    this.surfaces = [...root.querySelectorAll('[data-paddock-component="view-controls"]')];
    this.buttons = this.surfaces.flatMap((surface) => [...surface.querySelectorAll('[data-grid-view]')]);
    for (const button of this.buttons) {
      button.addEventListener('click', () => onView(button.dataset.gridView), { signal });
      button.disabled = false;
    }
    for (const surface of this.surfaces) surface.hidden = false;
  }

  update(view) {
    for (const button of this.buttons) button.setAttribute('aria-pressed', String(button.dataset.gridView === view));
  }

  focusRace() {
    const button = this.buttons.find((node) => node.dataset.gridView === 'race' && node.checkVisibility());
    button?.focus({ preventScroll: true });
    return Boolean(button);
  }

  destroy() {
    for (const button of this.buttons) button.disabled = true;
    for (const surface of this.surfaces) surface.hidden = true;
  }
}
