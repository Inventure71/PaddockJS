const CLEARANCE_CLASS = 'sim-canvas-panel--needs-banner-clearance';
import { createRafScheduler } from './layoutScheduler.js';

const CLEARANCE_VAR = '--race-overlay-banner-clearance';
const OVERLAY_GAP_PX = 12;

function parsePixelValue(value, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isVisible(element) {
  if (!element || element.hidden || element.classList?.contains('is-hidden')) return false;
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return rect.width > 0 &&
    rect.height > 0 &&
    style.display !== 'none' &&
    style.visibility !== 'hidden';
}

function relativeBounds(panel, element) {
  const panelRect = panel.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left - panelRect.left,
    right: rect.right - panelRect.left,
    top: rect.top - panelRect.top,
    bottom: rect.bottom - panelRect.top,
    width: rect.width,
    height: rect.height,
  };
}

function timingEntryBounds(panel, tower) {
  const panelRect = panel.getBoundingClientRect();
  const towerStyle = getComputedStyle(tower);
  const towerRect = tower.getBoundingClientRect();
  const towerOpenLeft = parsePixelValue(towerStyle.left, towerRect.left - panelRect.left);

  return Array.from(tower.querySelectorAll?.('.timing-row') ?? [])
    .filter(isVisible)
    .map((row) => {
      const rowRect = row.getBoundingClientRect();
      const rowLeftInTower = rowRect.left - towerRect.left;
      const left = towerOpenLeft + rowLeftInTower;
      return {
        left,
        right: left + rowRect.width,
        top: rowRect.top - panelRect.top,
        bottom: rowRect.bottom - panelRect.top,
      };
    });
}

function rectanglesOverlap(first, second) {
  return first.left < second.right &&
    first.right > second.left &&
    first.top < second.bottom &&
    first.bottom > second.top;
}

function createPanelOverlayRecord(panel) {
  return {
    panel,
    tower: panel.querySelector?.('[data-timing-tower]') ?? null,
    banner: panel.querySelector?.('[data-race-data-panel]') ?? null,
    toggle: panel.querySelector?.('[data-timing-panel-toggle]') ?? null,
  };
}

function syncPanelOverlayClearance(record) {
  const { panel, tower, banner, toggle } = record;
  if (!panel.classList?.contains('sim-canvas-panel--responsive-narrow')) {
    panel.classList?.remove(CLEARANCE_CLASS);
    panel.style?.removeProperty(CLEARANCE_VAR);
    return;
  }

  const toggleStyle = toggle ? getComputedStyle(toggle) : null;
  const timingRevealMode = Boolean(toggle && toggleStyle?.display !== 'none' && toggleStyle?.visibility !== 'hidden');
  if (!timingRevealMode || !tower || !isVisible(banner)) {
    panel.classList?.remove(CLEARANCE_CLASS);
    panel.style?.removeProperty(CLEARANCE_VAR);
    return;
  }

  const currentClearance = parsePixelValue(getComputedStyle(panel).getPropertyValue(CLEARANCE_VAR), 0);
  const bannerBounds = relativeBounds(panel, banner);
  const bannerWithoutClearance = {
    ...bannerBounds,
    top: bannerBounds.top - currentClearance,
    bottom: bannerBounds.bottom - currentClearance,
  };
  const needsClearance = timingEntryBounds(panel, tower)
    .some((entryBounds) => rectanglesOverlap(entryBounds, bannerWithoutClearance));

  panel.classList?.toggle(CLEARANCE_CLASS, needsClearance);
  if (!needsClearance) {
    panel.style?.removeProperty(CLEARANCE_VAR);
    return;
  }

  const panelRect = panel.getBoundingClientRect();
  const bannerRect = banner.getBoundingClientRect();
  const clearance = Math.max(0, Math.ceil(panelRect.bottom - bannerRect.top + OVERLAY_GAP_PX));
  panel.style?.setProperty(CLEARANCE_VAR, `${clearance}px`);
}

function raceCanvasPanels(root) {
  const queryRoot = root?.querySelectorAll ? root : null;
  if (!queryRoot) return [];
  const panels = [];
  if (root.matches?.('.sim-canvas-panel--with-timing-tower')) panels.push(root);
  panels.push(...queryRoot.querySelectorAll('.sim-canvas-panel--with-timing-tower'));
  return [...new Set(panels)];
}

export function installRaceOverlayClearanceSupport(root) {
  const panelRecords = raceCanvasPanels(root).map(createPanelOverlayRecord);
  if (panelRecords.length === 0) return () => {};

  const syncPanels = () => panelRecords.forEach(syncPanelOverlayClearance);
  const scheduler = createRafScheduler(syncPanels);

  scheduler.runNow();

  const resizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(scheduler.queue)
    : null;
  panelRecords.forEach(({ panel, tower, banner }) => {
    resizeObserver?.observe(panel);
    if (tower) resizeObserver?.observe(tower);
    if (banner) resizeObserver?.observe(banner);
  });

  const mutationObserver = typeof MutationObserver === 'function'
    ? new MutationObserver(scheduler.queue)
    : null;
  panelRecords.forEach(({ panel }) => {
    mutationObserver?.observe(panel, {
      attributes: true,
      attributeFilter: ['aria-hidden', 'class', 'hidden', 'style'],
      childList: true,
      subtree: true,
    });
  });

  if (typeof requestAnimationFrame === 'function') {
    scheduler.queue();
  }

  return () => {
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    scheduler.cancel();
  };
}
