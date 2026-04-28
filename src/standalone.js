import { DEMO_PROJECT_DRIVERS, mountF1Simulator } from './index.js';

const root = document.getElementById('f1-simulator-root');

if (root) {
  mountF1Simulator(root, {
    drivers: DEMO_PROJECT_DRIVERS,
    onDriverOpen(driver) {
      if (driver.link) window.location.href = driver.link;
    },
  }).catch((error) => {
    root.dataset.simulatorState = 'error';
    console.error('F1 simulator failed to initialize.', error);
  });
}
