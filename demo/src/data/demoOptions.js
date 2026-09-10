import {
  CHAMPIONSHIP_ENTRY_BLUEPRINTS,
  DEMO_PROJECT_DRIVERS,
} from '@inventure71/paddockjs';

const TEAM_PALETTE = [
  ['signal', 'Signal Works', '#ed1c24', 'SW'],
  ['apex', 'Apex Systems', '#ffb000', 'AX'],
  ['vector', 'Vector Lab', '#00a3ff', 'VL'],
  ['kinetic', 'Kinetic Studio', '#b8ff3d', 'KS'],
  ['nightshift', 'Nightshift AI', '#b94cff', 'NA'],
];

export const DEMO_DRIVERS = DEMO_PROJECT_DRIVERS.map((driver, index) => ({
  ...driver,
  customFields: {
    Discipline: ['Product AI', 'Game systems', 'Spatial UI'][index % 3],
    Release: `R${String(index + 1).padStart(2, '0')}`,
  },
}));

export const DEMO_ENTRIES = CHAMPIONSHIP_ENTRY_BLUEPRINTS.map((entry, index) => {
  const [id, name, color, icon] = TEAM_PALETTE[Math.floor(index / 2) % TEAM_PALETTE.length];
  return {
    ...entry,
    team: {
      id,
      name,
      color,
      icon,
      theme: index % 4 < 2 ? 'signal' : 'electric',
      pitCrew: {
        speed: 0.72 + ((index % 4) * 0.07),
        consistency: 0.78 + ((index % 3) * 0.06),
        reliability: 0.9 + ((index % 2) * 0.05),
      },
    },
  };
});

export const DEMO_THEME = {
  mode: 'dark',
  use: 'signal',
  tokens: {
    primary: { dark: '#ed1c24', light: '#c81219' },
    primaryText: '#ffffff',
    surface: { dark: '#090909', light: '#f3f1ec' },
    surfaceRaised: { dark: '#151515', light: '#ffffff' },
    surfacePanel: { dark: '#101010', light: '#f8f5ef' },
    border: { dark: '#353535', light: '#c9c4bc' },
    drsActive: '#36f2cf',
    pitLane: '#b94cff',
  },
  themes: {
    signal: {
      extends: 'default',
      tokens: {
        primary: '#ed1c24',
        warning: '#ffb000',
      },
    },
    electric: {
      extends: 'default',
      tokens: {
        primary: '#36f2cf',
        secondary: '#b94cff',
      },
    },
  },
  componentThemes: {
    'race-controls': 'signal',
    'camera-controls': 'default',
    'timing-tower': 'default',
    selectedDriverPanel: 'selectedTeam',
  },
  teamThemes: Object.fromEntries(TEAM_PALETTE.map(([id], index) => [
    id,
    index % 2 ? 'electric' : 'signal',
  ])),
  timingTowerMaxWidth: '380px',
  raceViewMinHeight: '620px',
};

export function createDemoOptions({ callbacks = {}, ...overrides } = {}) {
  return {
    drivers: DEMO_DRIVERS,
    entries: DEMO_ENTRIES,
    seed: 71,
    trackSeed: 7109,
    totalLaps: 5,
    physicsMode: 'arcade',
    initialCameraMode: 'leader',
    title: 'PaddockJS Grand Prix',
    kicker: 'Live package demo',
    showBackLink: false,
    theme: DEMO_THEME,
    rules: {
      ruleset: 'grandPrix2025',
      modules: {
        stalledDnf: {
          enabled: true,
          maxStoppedSeconds: 5,
        },
      },
    },
    participantInteractions: {
      drivers: {
        clash: 'phantom-race',
      },
    },
    ui: {
      cameraControls: 'external',
      driverCamera: true,
      simulationSpeedControl: true,
      showFps: true,
      raceDataBannerSize: 'auto',
      raceDataTelemetryDetail: true,
      penaltyBanners: true,
      timingPenaltyBadges: true,
      timingGapMode: 'interval',
      timingGapModeToggle: true,
      timingTowerVerticalFit: 'expand-race-view',
      responsiveNarrowLayout: true,
      raceDataBanners: {
        initial: 'project',
        enabled: ['project', 'radio'],
      },
    },
    ...callbacks,
    ...overrides,
  };
}
