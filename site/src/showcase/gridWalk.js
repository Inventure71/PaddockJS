import { siteUrl } from '../shared/routes.js';
import '@inventure71/paddockjs/styles.css';
import { createPaddockSimulator, mountF1Simulator } from '@inventure71/paddockjs';
import { hydrateShowcaseCodeExamples, hydrateShowcaseCoverage } from './showcaseCatalog.js';

const projects = [
  ['Surveyor', 'Map field observations in a shared workspace.', ['TypeScript', 'WebGL']],
  ['Relay', 'Keep a distributed team in sync.', ['JavaScript', 'WebSocket']],
  ['Atlas Research Workspace', 'Turn research notes into connected knowledge.', ['Python', 'SQLite']],
  ['Field Notes', 'Capture ideas wherever work happens.', ['Swift', 'CloudKit']],
  ['Signal', 'Understand the patterns behind live measurements.', ['Rust', 'WebAssembly']],
  ['Foundry', 'Build and share reusable design systems.', ['React', 'CSS']],
  ['Orbit', 'Plan complex work with a clear view of dependencies.', ['TypeScript', 'PostgreSQL']],
  ['Canopy', 'Track the health of a growing ecosystem.', ['Python', 'Sensors']],
  ['Tandem', 'Collaborate on a document in real time.', ['JavaScript', 'CRDT']],
  ['Northstar', 'Find a useful direction in a large dataset.', ['Python', 'Data visualization']],
];
const projectList = document.querySelector('[data-grid-projects]');
for (const [index, [name, summary, technologies]] of projects.entries()) {
  const project = document.createElement('article');
  project.id = `project-${index}`;
  project.className = 'showcase-card grid-walk-project';
  const title = document.createElement('h3');
  title.textContent = name;
  const description = document.createElement('p');
  description.textContent = summary;
  const details = document.createElement('p');
  details.textContent = technologies.join(' · ');
  project.append(title, description, details);
  projectList?.append(project);
}
hydrateShowcaseCodeExamples();
hydrateShowcaseCoverage();

const colors = ['#f05060', '#ffd166', '#00c2a8', '#47a8ff', '#b390ff'];
const drivers = projects.map(([name], index) => ({ id: `project-${index}`, name, color: colors[index % colors.length] }));
const options = {
  drivers,
  entries: projects.map(([name, summary, technologies], index) => ({
    driverId: drivers[index].id,
    presentation: { name, summary, technologies,
      details: ['An independent sample entry supplied by this host.', 'Select any car or its label to inspect it.'],
      href: `#project-${index}`, linkLabel: 'View project',
      ...(index === 0 ? { image: { src: siteUrl('/grid-walk-surveyor.svg'), alt: 'Field survey map with three marked observation points' } } : {}),
    },
  })),
  seed: 71,
  trackSeed: 7110,
  warmup: false,
  gridWalk: { enabled: true },
  ui: { showFps: false, viewControls: new URLSearchParams(location.search).get('viewControls') === 'toggle' ? 'toggle' : 'switch' },
  theme: { raceViewMinHeight: '100%' },
};
let simulator = createPaddockSimulator(options);
simulator.mountViewControls(document.getElementById('grid-view-controls'));
simulator.mountRaceCanvas(document.getElementById('grid-host'));
document.querySelectorAll('[data-host-size]').forEach((button) => button.addEventListener('click', () => {
  const [width, height] = button.dataset.hostSize.split(',');
  document.getElementById('grid-host').style.width = `${width}px`;
  document.getElementById('grid-host').style.height = `${height}px`;
  document.querySelectorAll('[data-host-size]').forEach((control) => {
    control.setAttribute('aria-pressed', String(control === button));
  });
}));
document.querySelector('[data-host-theme]').addEventListener('click', () => {
  simulator.setThemeMode(simulator.getTheme().activeMode === 'light' ? 'dark' : 'light');
});
try {
  await simulator.start();
  document.getElementById('host-status').textContent = 'Grid ready. Race pauses while you explore.';
  // Public controller access for this engineering showcase's browser assertions.
  window.gridWalkShowcase = simulator;
  window.gridWalkMountShell = async ({ enabled = true } = {}) => {
    simulator.destroy();
    const root = document.getElementById('grid-host');
    root.style.height = 'auto';
    simulator = await mountF1Simulator(root, {
      ...options, preset: 'timing-overlay', showBackLink: false,
      gridWalk: { ...options.gridWalk, enabled },
      ui: { ...options.ui, showTelemetry: false, cameraControls: 'embedded' },
      theme: { ...options.theme, raceViewMinHeight: '620px' },
    });
    window.gridWalkShowcase = simulator;
  };
} catch (error) {
  document.getElementById('host-status').textContent = `Unable to start: ${error.message}`;
  throw error;
}
window.addEventListener('beforeunload', () => simulator.destroy(), { once: true });
