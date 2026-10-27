export class GridWalkControls {
  constructor(element, { onView, onSelect, onMove }, signal) {
    this.element = element.querySelector('[data-grid-header]');
    this.navigation = element.querySelector('[data-grid-navigation]');
    this.jump = element.querySelector('[data-grid-jump]');
    this.status = element.querySelector('[data-grid-status]');
    this.modes = [...element.querySelectorAll('[data-grid-view]')];
    this.element.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (button?.dataset.gridView) onView(button.dataset.gridView);
      else if (button?.hasAttribute('data-grid-next')) onMove(1);
      else if (button?.hasAttribute('data-grid-previous')) onMove(-1);
    }, { signal });
    this.jump.addEventListener('change', () => onSelect(this.jump.value), { signal });
  }

  update(session, selectedId) {
    this.modes.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.gridView === session.view)));
    this.navigation.hidden = !session.active || session.clearing;
    this.jump.value = selectedId;
    const status = session.clearing ? 'Crew clearing the grid' : session.view === 'grid-walk'
      ? session.hasRaced ? 'Race paused · original starting grid' : 'Explore the starting grid'
      : session.hasRaced ? 'Race in progress' : '';
    if (this.status.textContent !== status) this.status.textContent = status;
  }

  focusRace() { this.modes.find((button) => button.dataset.gridView === 'race').focus({ preventScroll: true }); }
}
