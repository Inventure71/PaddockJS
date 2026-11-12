import { createRafScheduler } from '../layoutScheduler.js';

// Owns overlay geometry and restoration of any Race chrome it covers.
export class GridWalkLayout {
  constructor({ element, panel, canvasHost, root }) {
    Object.assign(this, { element, panel, canvasHost, root });
    this.coveredTowers = new Map();
  }

  observe(onResize) {
    if (typeof ResizeObserver !== 'function') return;
    this.scheduler = createRafScheduler(onResize);
    this.resizeObserver = new ResizeObserver(this.scheduler.queue);
    for (const selector of ['[data-grid-header]', '[data-grid-project-banner]']) {
      const element = this.element.querySelector(selector);
      if (element) this.resizeObserver.observe(element);
    }
  }

  update(active) {
    this.active = active;
    this.syncCoveredTowers();
  }

  measure(bannerSize) {
    const canvas = this.canvasHost.getBoundingClientRect();
    const header = this.element.querySelector('[data-grid-header]').getBoundingClientRect();
    const scale = canvas.height / this.canvasHost.clientHeight || 1;
    return { left: 16, right: this.canvasHost.clientWidth - 16,
      top: Math.max(16, (header.bottom - canvas.top) / scale + 12),
      bottom: this.canvasHost.clientHeight - 16 - bannerSize };
  }

  syncCoveredTowers() {
    const canvas = this.canvasHost.getBoundingClientRect();
    for (const tower of this.root.querySelectorAll('[data-timing-tower]')) {
      const rect = tower.getBoundingClientRect();
      const covered = this.active && rect.width > 0 && rect.height > 0 &&
        rect.right > canvas.left && rect.left < canvas.right && rect.bottom > canvas.top && rect.top < canvas.bottom;
      if (covered && !this.coveredTowers.has(tower)) {
        this.coveredTowers.set(tower, tower.hasAttribute('inert'));
        tower.classList.add('is-grid-walk-covered');
        tower.setAttribute('inert', '');
      } else if (!covered && this.coveredTowers.has(tower)) {
        tower.classList.remove('is-grid-walk-covered');
        if (!this.coveredTowers.get(tower)) tower.removeAttribute('inert');
        this.coveredTowers.delete(tower);
      }
      if (covered && !tower.hasAttribute('inert')) tower.setAttribute('inert', '');
    }
  }

  destroy() {
    this.resizeObserver?.disconnect();
    this.scheduler?.cancel();
    for (const [tower, wasInert] of this.coveredTowers) {
      tower.classList.remove('is-grid-walk-covered');
      if (!wasInert) tower.removeAttribute('inert');
    }
    this.coveredTowers.clear();
  }
}
