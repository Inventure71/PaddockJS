import { installLayoutSupport } from '../app/layoutSupport.js';
import { applyPaddockThemeCssVariables } from '../config/defaultOptions.js';
import { formatCssUrl } from '../config/cssValues.js';

function assertMountTarget(root, label) {
  if (!root || typeof root !== 'object' || !('innerHTML' in root)) {
    throw new Error(`${label} requires a DOM element root.`);
  }
}

function setPackageCssVariables(root, assets, theme, context = {}) {
  root.classList?.add?.('f1-sim-component');
  root.style?.setProperty?.('--broadcast-panel-surface', formatCssUrl(assets.broadcastPanel));
  applyPaddockThemeCssVariables(root, theme, context);
}

function createCompositeRoot(getRoots, getOptions) {
  return {
    style: {
      setProperty(name, value) {
        getRoots().forEach((root) => root.style?.setProperty?.(name, value));
      },
      removeProperty(name) {
        getRoots().forEach((root) => root.style?.removeProperty?.(name));
      },
    },
    querySelector(selector) {
      for (const root of getRoots()) {
        const match = root.querySelector?.(selector);
        if (match) return match;
      }
      return null;
    },
    querySelectorAll(selector) {
      return getRoots().flatMap((root) => [...(root.querySelectorAll?.(selector) ?? [])]);
    },
    setAttribute(name, value) {
      getRoots().forEach((root) => root.setAttribute?.(name, value));
    },
    removeAttribute(name) {
      getRoots().forEach((root) => root.removeAttribute?.(name));
    },
    applyCssVariables(context = {}) {
      const options = getOptions();
      getRoots().forEach((root) => setPackageCssVariables(root, options.assets, options.theme, context));
    },
  };
}

// Owns mounted DOM surfaces, layout-support lifetimes and their composite query
// root. The simulator controller supplies runtime availability and options.
export class MountedSimulatorComponents {
  constructor({ getOptions, canMount }) {
    this.getOptions = getOptions;
    this.canMount = canMount;
    this.roots = new Map();
    this.mountRenderers = new Map();
    this.layoutSupportCleanups = new Map();
    this.compositeRoot = createCompositeRoot(() => [...this.roots.values()], getOptions);
  }

  mount(root, key, createMarkup) {
    assertMountTarget(root, `mount ${key}`);
    if (!this.canMount()) {
      throw new Error('Mount PaddockJS components before calling start().');
    }
    const occupiedEntry = [...this.roots.entries()]
      .find(([mountedKey, mountedRoot]) => mountedKey !== key && mountedRoot === root);
    if (occupiedEntry) {
      throw new Error(`Mount ${key} requires its own root; this root already hosts ${occupiedEntry[0]}.`);
    }
    const render = typeof createMarkup === 'function' ? createMarkup : () => createMarkup;
    const previousRoot = this.roots.get(key);
    this.layoutSupportCleanups.get(key)?.();
    if (previousRoot && previousRoot !== root) previousRoot.innerHTML = '';
    root.innerHTML = render();
    setPackageCssVariables(root, this.getOptions().assets, this.getOptions().theme);
    this.layoutSupportCleanups.set(key, installLayoutSupport(root));
    this.roots.set(key, root);
    this.mountRenderers.set(key, render);
    return root;
  }

  rerender() {
    this.roots.forEach((root, key) => {
      const render = this.mountRenderers.get(key);
      if (render) root.innerHTML = render();
      setPackageCssVariables(root, this.getOptions().assets, this.getOptions().theme);
      this.layoutSupportCleanups.get(key)?.();
      this.layoutSupportCleanups.set(key, installLayoutSupport(root));
    });
  }

  destroy() {
    this.layoutSupportCleanups.forEach((cleanup) => cleanup());
    this.layoutSupportCleanups.clear();
    this.roots.forEach((root) => { root.innerHTML = ''; });
    this.roots.clear();
    this.mountRenderers.clear();
  }
}
