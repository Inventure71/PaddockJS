import { mountF1Simulator } from '@inventure71/paddockjs';
import { createDemoOptions } from '../data/demoOptions.js';

const VALID_PRESETS = new Set(['dashboard', 'timing-overlay', 'compact-race', 'full-dashboard']);

export function createPresetShowcase({ root, status, buttons }) {
  let controller = null;
  let generation = 0;
  let disposed = false;
  let pendingMount = Promise.resolve();

  async function mount(preset) {
    if (disposed || !VALID_PRESETS.has(preset)) return;
    const currentGeneration = ++generation;
    buttons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.preset === preset)));
    status.textContent = `Loading ${preset.replace('-', ' ')}…`;
    status.classList.remove('is-ready');
    const url = new URL(window.location.href);
    url.searchParams.set('preset', preset);
    window.history.replaceState({}, '', url);

    // A root remains occupied until an outstanding package mount settles.
    pendingMount = pendingMount.then(async () => {
      if (disposed || currentGeneration !== generation) return;
      try {
        controller?.destroy();
        controller = null;
        const nextController = await mountF1Simulator(root, createDemoOptions({
          preset,
          seed: 90 + [...VALID_PRESETS].indexOf(preset),
          trackSeed: 7200 + [...VALID_PRESETS].indexOf(preset),
          warmup: false,
          totalLaps: 3,
          title: `${preset.replace('-', ' ')} preset`,
          kicker: 'All-in-one mount',
        }));
        if (currentGeneration !== generation) {
          nextController.destroy();
          return;
        }
        controller = nextController;
        status.textContent = `${preset.replace('-', ' ')} ready`;
        status.classList.add('is-ready');
      } catch (error) {
        if (currentGeneration !== generation) return;
        status.textContent = `Could not load preset: ${error.message}`;
      }
    });
    return pendingMount;
  }

  const requestedPreset = new URL(window.location.href).searchParams.get('preset');
  const initialPreset = VALID_PRESETS.has(requestedPreset) ? requestedPreset : 'timing-overlay';
  const listeners = buttons.map((button) => {
    const onClick = () => mount(button.dataset.preset);
    button.addEventListener('click', onClick);
    return { button, onClick };
  });

  return {
    mountInitial: () => mount(initialPreset),
    destroy() {
      disposed = true;
      generation += 1;
      listeners.forEach(({ button, onClick }) => button.removeEventListener('click', onClick));
      controller?.destroy();
      controller = null;
    },
  };
}
