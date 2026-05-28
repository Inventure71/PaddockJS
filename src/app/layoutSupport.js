import { createRafScheduler } from './layoutScheduler.js';

export const PADDOCK_MIN_SUPPORTED_INLINE_SIZE = 320;

const MIN_INLINE_SIZE_BY_COMPONENT = {
  'race-controls': 260,
  'camera-controls': 160,
  'safety-car-control': 44,
  'timing-tower': 255,
  'race-canvas': 180,
  'race-telemetry-drawer': 280,
  'telemetry-stack': 260,
  'telemetry-core': 260,
  'telemetry-sectors': 240,
  'telemetry-lap-times': 240,
  'telemetry-sector-times': 240,
  'telemetry-sector-banner': 240,
  'car-driver-overview': 260,
  'race-data-panel': 260,
  'steward-message': 240,
};

const MIN_BLOCK_SIZE_BY_COMPONENT = {
  'race-controls': 88,
  'camera-controls': 56,
  'safety-car-control': 44,
  'timing-tower': 220,
  'race-canvas': 180,
  'race-telemetry-drawer': 340,
  'telemetry-stack': 180,
  'telemetry-core': 150,
  'telemetry-sectors': 96,
  'telemetry-lap-times': 120,
  'telemetry-sector-times': 140,
  'telemetry-sector-banner': 88,
  'car-driver-overview': 180,
  'race-data-panel': 88,
  'steward-message': 64,
};

function componentMinimumInlineSize(element) {
  if (element.hasAttribute('data-f1-simulator-shell')) return PADDOCK_MIN_SUPPORTED_INLINE_SIZE;
  const componentName = element.getAttribute('data-paddock-component');
  if (componentName && MIN_INLINE_SIZE_BY_COMPONENT[componentName]) {
    return MIN_INLINE_SIZE_BY_COMPONENT[componentName];
  }
  return PADDOCK_MIN_SUPPORTED_INLINE_SIZE;
}

function componentMinimumBlockSize(element) {
  const componentName = element.getAttribute('data-paddock-component');
  if (componentName && MIN_BLOCK_SIZE_BY_COMPONENT[componentName]) {
    return MIN_BLOCK_SIZE_BY_COMPONENT[componentName];
  }
  return element.hasAttribute('data-f1-simulator-shell') ? 360 : 0;
}

function isRendered(element) {
  if (
    element.hidden ||
    element.getAttribute('aria-hidden') === 'true' ||
    element.classList?.contains('is-hidden')
  ) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return rect.width > 0 &&
    rect.height > 0 &&
    style.display !== 'none' &&
    style.visibility !== 'hidden';
}

function clearElementSupportState(element) {
  if (element.dataset.paddockSizeUnsupported !== 'false') {
    element.dataset.paddockSizeUnsupported = 'false';
  }
  delete element.dataset.paddockSizeUnsupportedReason;
}

function syncElementSupportState(element) {
  if (!isRendered(element)) {
    clearElementSupportState(element);
    return;
  }
  const rect = element.getBoundingClientRect();
  const minInlineSize = componentMinimumInlineSize(element);
  const minBlockSize = componentMinimumBlockSize(element);
  const inlineUnsupported = rect.width < minInlineSize;
  const blockUnsupported = minBlockSize > 0 && rect.height < minBlockSize;
  const unsupported = inlineUnsupported || blockUnsupported;
  const unsupportedValue = unsupported ? 'true' : 'false';
  if (element.dataset.paddockSizeUnsupported !== unsupportedValue) {
    element.dataset.paddockSizeUnsupported = unsupportedValue;
  }
  if (inlineUnsupported) {
    if (element.dataset.paddockSizeUnsupportedReason !== 'inline') {
      element.dataset.paddockSizeUnsupportedReason = 'inline';
    }
  } else if (blockUnsupported) {
    if (element.dataset.paddockSizeUnsupportedReason !== 'block') {
      element.dataset.paddockSizeUnsupportedReason = 'block';
    }
  } else {
    delete element.dataset.paddockSizeUnsupportedReason;
  }
}

function layoutSupportElements(root) {
  const queryRoot = root?.children ? root : null;
  if (!queryRoot) return [];
  const elements = [];
  if (root.matches?.('[data-f1-simulator-shell], [data-paddock-component]')) {
    elements.push(root);
  } else {
    elements.push(
      ...[...queryRoot.children].filter((element) => (
        element.matches?.('[data-f1-simulator-shell], [data-paddock-component]')
      )),
    );
  }
  return [...new Set(elements)];
}

export function installLayoutSupport(root) {
  const elements = layoutSupportElements(root);
  const syncElements = () => elements.forEach(syncElementSupportState);
  const scheduler = createRafScheduler(syncElements);
  scheduler.runNow();

  if (typeof ResizeObserver !== 'function') {
    return () => {};
  }

  const observer = new ResizeObserver((entries) => {
    if (typeof requestAnimationFrame !== 'function') {
      entries.forEach((entry) => syncElementSupportState(entry.target));
      return;
    }
    scheduler.queue();
  });
  elements.forEach((element) => observer.observe(element));

  const mutationObserver = typeof MutationObserver === 'function'
    ? new MutationObserver(scheduler.queue)
    : null;
  elements.forEach((element) => {
    mutationObserver?.observe(element, {
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
    observer.disconnect();
    mutationObserver?.disconnect();
    scheduler.cancel();
  };
}
