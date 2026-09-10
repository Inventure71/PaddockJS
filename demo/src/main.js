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
const eventList = document.querySelector('[data-event-stream]');
const mainStatus = document.querySelector('[data-main-status]');

function pushEvent(message) {
  const item = document.createElement('li');
  item.textContent = message;
  eventList.prepend(item);
  while (eventList.children.length > 5) eventList.lastElementChild?.remove();
}

async function start() {
  cleanups.push(installPageInteractions());
  renderSystemLedger(document.querySelector('[data-system-ledger]'));
  installFeatureInventory({
    root: document.querySelector('[data-feature-inventory]'),
    search: document.querySelector('[data-feature-search]'),
    filters: [...document.querySelectorAll('[data-feature-filter]')],
    empty: document.querySelector('[data-feature-empty]'),
  });

  installHeadlessLab({
    button: document.querySelector('[data-run-headless]'),
    status: document.querySelector('[data-headless-status]'),
    metrics: document.querySelector('[data-headless-metrics]'),
    output: document.querySelector('[data-headless-output]'),
  });

  cleanups.push(installExpertLab({
    button: document.querySelector('[data-launch-expert]'),
    workspace: document.querySelector('[data-expert-workspace]'),
    root: document.getElementById('expert-root'),
    status: document.querySelector('[data-expert-status]'),
  }));

  mainStatus.textContent = 'Building the live workbench…';
  const showcase = await mountMainShowcase({ onEvent: pushEvent });
  cleanups.push(() => showcase.destroy());
  mainStatus.textContent = 'Live package runtime';
  mainStatus.classList.add('is-ready');

  cleanups.push(installControlDeck({
    controller: showcase.hero,
    primaryDriverId: showcase.primaryDriverId,
    readout: document.querySelector('[data-race-readout]'),
    buttons: [...document.querySelectorAll('[data-race-action]')],
  }));

  cleanups.push(onceVisible(document.getElementById('components'), async () => {
    pushEvent('Components · shared runtime starting');
    await showcase.startComponents();
    pushEvent('Components · every public surface ready');
  }, '650px 0px'));

  const presetShowcase = createPresetShowcase({
    root: document.getElementById('preset-root'),
    status: document.querySelector('[data-preset-status]'),
    buttons: [...document.querySelectorAll('[data-preset]')],
  });
  cleanups.push(() => presetShowcase.destroy());
  cleanups.push(onceVisible(document.getElementById('presets'), () => presetShowcase.mountInitial(), '650px 0px'));
}

start().catch((error) => {
  mainStatus.textContent = `Demo failed to initialize: ${error.message}`;
  pushEvent(`Error · ${error.message}`);
  console.error(error);
});

window.addEventListener('beforeunload', () => {
  cleanups.reverse().forEach((cleanup) => cleanup?.());
}, { once: true });
