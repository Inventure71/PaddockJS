// Separately mounted controls share one runtime view; they never own race state.
export class SimulatorViewControls {
  constructor(root, onView, signal) {
    this.surfaces = [...root.querySelectorAll('[data-paddock-component="view-controls"]')];
    this.buttons = this.surfaces.flatMap((surface) => [...surface.querySelectorAll('[data-grid-view]')]);
    this.toggles = this.surfaces.flatMap((surface) => [...surface.querySelectorAll('[data-grid-toggle]')]);
    this.view = this.buttons.find((button) => button.getAttribute('aria-pressed') === 'true')?.dataset.gridView ?? 'race';
    for (const button of this.buttons) {
      button.addEventListener('click', () => onView(button.dataset.gridView), { signal });
      button.disabled = false;
    }
    for (const button of this.toggles) {
      button.addEventListener('click', () => onView(this.view === 'race' ? 'grid-walk' : 'race'), { signal });
      button.disabled = false;
    }
    for (const surface of this.surfaces) surface.hidden = false;
  }

  update(view, variant = 'switch') {
    this.view = view;
    const toggle = variant === 'toggle';
    for (const button of this.buttons) {
      button.hidden = toggle;
      button.setAttribute('aria-pressed', String(button.dataset.gridView === view));
    }
    for (const button of this.toggles) {
      button.hidden = !toggle;
      const label = button.querySelector?.('[data-control-label]') ?? button;
      label.textContent = view === 'grid-walk' ? 'Start race' : 'Stop race';
    }
  }

  focusRace() {
    const button = [...this.buttons.filter((node) => node.dataset.gridView === 'race'), ...this.toggles]
      .find((node) => !node.hidden && node.checkVisibility());
    button?.focus({ preventScroll: true });
    return Boolean(button);
  }

  destroy() {
    for (const button of [...this.buttons, ...this.toggles]) button.disabled = true;
    for (const surface of this.surfaces) surface.hidden = true;
  }
}
