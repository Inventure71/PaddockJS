import { createComponentSurfaceMarkup } from './templateUtils.js';

export function createViewControlsMarkup({ gridWalk = {}, ui = {} } = {}) {
  const enabled = gridWalk.enabled === true;
  const view = enabled && gridWalk.initialView === 'grid-walk' ? 'grid-walk' : 'race';
  const toggle = ui.viewControls === 'toggle';
  return createComponentSurfaceMarkup({
    tagName: 'div',
    className: 'camera-controls camera-controls--external paddock-view-controls',
    componentName: 'view-controls',
    ariaLabel: 'Simulator view',
    attributes: `role="group"${enabled ? '' : ' hidden'}`,
    body: `
      <button type="button" data-grid-view="grid-walk" aria-pressed="${view === 'grid-walk'}" disabled${toggle ? ' hidden' : ''}>Grid Walk</button>
      <button type="button" data-grid-view="race" aria-pressed="${view === 'race'}" disabled${toggle ? ' hidden' : ''}>Race</button>
      <button type="button" data-grid-action="${view === 'grid-walk' ? 'start' : 'stop'}" data-grid-toggle data-size-label="Start race" disabled${toggle ? '' : ' hidden'}><span data-control-label>${view === 'grid-walk' ? 'Start race' : 'Stop race'}</span></button>
    `,
    unsupportedLabel: 'Simulator view',
    loadingLabel: 'Simulator view',
  });
}
