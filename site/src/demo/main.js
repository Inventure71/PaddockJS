import '@inventure71/paddockjs/styles.css';
import './styles.css';
import { installControlDeck } from './runtime/controlDeck.js';
import { installExpertLab } from './runtime/expertLab.js';
import { installHeadlessLab } from './runtime/headlessLab.js';
import { mountMainShowcase } from './runtime/mainShowcase.js';
import { createPresetShowcase } from './runtime/presetShowcase.js';
import { installFeatureInventory, renderSystemLedger } from './ui/featureInventory.js';
import { installPageInteractions, onceVisible } from './ui/pageInteractions.js';

const cleanups = [];
let disposed = false;
function own(cleanup) { if (disposed) cleanup?.(); else cleanups.push(cleanup); }
const eventList = document.querySelector('[data-event-stream]');
const mainStatus = document.querySelector('[data-main-status]');

function pushEvent(message) {
  const item = document.createElement('li');
  item.textContent = message;
  eventList.prepend(item);
  while (eventList.children.length > 5) eventList.lastElementChild?.remove();
}

async function start() {
  own(installPageInteractions());
  renderSystemLedger(document.querySelector('[data-system-ledger]'));
  own(installFeatureInventory({
    root: document.querySelector('[data-feature-inventory]'),
    search: document.querySelector('[data-feature-search]'),
    filters: [...document.querySelectorAll('[data-feature-filter]')],
    empty: document.querySelector('[data-feature-empty]'),
  }));

  installHeadlessLab({
    button: document.querySelector('[data-run-headless]'),
    status: document.querySelector('[data-headless-status]'),
    metrics: document.querySelector('[data-headless-metrics]'),
    output: document.querySelector('[data-headless-output]'),
  });

  own(installExpertLab({
    button: document.querySelector('[data-launch-expert]'),
    workspace: document.querySelector('[data-expert-workspace]'),
    root: document.getElementById('expert-root'),
    status: document.querySelector('[data-expert-status]'),
  }));

  mainStatus.textContent = 'Building the live workbench…';
  const showcase = await mountMainShowcase({ onEvent: pushEvent });
  own(() => showcase.destroy());
  if (disposed) return;
  mainStatus.textContent = 'Live package runtime';
  mainStatus.classList.add('is-ready');

  own(installControlDeck({
    controller: showcase.hero,
    primaryDriverId: showcase.primaryDriverId,
    readout: document.querySelector('[data-race-readout]'),
    buttons: [...document.querySelectorAll('[data-race-action]')],
  }));

  own(onceVisible(document.getElementById('components'), async () => {
    pushEvent('Components · shared runtime starting');
    await showcase.startComponents();
    pushEvent('Components · every public surface ready');
  }, '650px 0px', (error) => pushEvent(`Components failed · ${error.message}`)));

  const presetShowcase = createPresetShowcase({
    root: document.getElementById('preset-root'),
    status: document.querySelector('[data-preset-status]'),
    buttons: [...document.querySelectorAll('[data-preset]')],
  });
  own(() => presetShowcase.destroy());
  own(onceVisible(document.getElementById('presets'), () => presetShowcase.mountInitial(), '650px 0px', (error) => pushEvent(`Preset failed · ${error.message}`)));
}

start().catch((error) => {
  if (disposed) return;
  mainStatus.textContent = `Demo failed to initialize: ${error.message}`;
  pushEvent(`Error · ${error.message}`);
  console.error(error);
});

window.addEventListener('beforeunload', () => {
  disposed = true;
  cleanups.splice(0).reverse().forEach((cleanup) => cleanup?.());
}, { once: true });
