import { createComponentSurfaceMarkup } from './templateUtils.js';

export function createViewControlsMarkup({ gridWalk = {} } = {}) {
  const enabled = gridWalk.enabled === true;
  const view = enabled && gridWalk.initialView === 'grid-walk' ? 'grid-walk' : 'race';
  return createComponentSurfaceMarkup({
    tagName: 'div',
    className: 'camera-controls camera-controls--external paddock-view-controls',
    componentName: 'view-controls',
    ariaLabel: 'Simulator view',
    attributes: `role="group"${enabled ? '' : ' hidden'}`,
    body: `
      <button type="button" data-grid-view="grid-walk" aria-pressed="${view === 'grid-walk'}" disabled>Grid Walk</button>
      <button type="button" data-grid-view="race" aria-pressed="${view === 'race'}" disabled>Race</button>
    `,
    unsupportedLabel: 'Simulator view',
    loadingLabel: 'Simulator view',
  });
}
