import { toKebabCase } from './themeUtils.js';

export const THEME_MODES = new Set(['dark', 'light', 'system']);

export const THEME_COLOR_TOKEN_KEYS = [
  'primary',
  'primaryText',
  'secondary',
  'secondaryText',
  'surface',
  'surfaceRaised',
  'surfacePanel',
  'text',
  'mutedText',
  'border',
  'success',
  'warning',
  'danger',
  'info',
  'yellowFlag',
  'greenFlag',
  'redFlag',
  'safetyCar',
  'drsActive',
  'pitLane',
  'track',
  'trackEdge',
];

export const THEME_SIZE_TOKEN_KEYS = [
  'timingTowerMaxWidth',
  'raceViewMinHeight',
];

export const THEME_TOKEN_KEYS = [...THEME_COLOR_TOKEN_KEYS, ...THEME_SIZE_TOKEN_KEYS];
export const PADDOCK_THEME_TOKEN_KEYS = THEME_TOKEN_KEYS;
export const THEME_TOKEN_SET = new Set(THEME_TOKEN_KEYS);

export const LEGACY_TOKEN_ALIASES = {
  accentColor: 'primary',
  greenColor: 'greenFlag',
  yellowColor: 'yellowFlag',
  blueColor: 'info',
  raceControlRedColor: 'redFlag',
  surfaceColor: 'surface',
  surfaceRaisedColor: 'surfaceRaised',
  surfacePanelColor: 'surfacePanel',
  lineColor: 'border',
  lineStrongColor: 'border',
  textColor: 'text',
  mutedTextColor: 'mutedText',
  trackColor: 'track',
  trackEdgeColor: 'trackEdge',
};

export const LEGACY_ALIAS_KEYS = Object.keys(LEGACY_TOKEN_ALIASES);

export const PADDOCK_THEME_CSS_VARIABLES = {
  primary: '--paddock-color-primary',
  primaryText: '--paddock-color-primary-text',
  secondary: '--paddock-color-secondary',
  secondaryText: '--paddock-color-secondary-text',
  surface: '--paddock-color-surface',
  surfaceRaised: '--paddock-color-surface-raised',
  surfacePanel: '--paddock-color-surface-panel',
  text: '--paddock-color-text',
  mutedText: '--paddock-color-muted-text',
  border: '--paddock-color-border',
  success: '--paddock-color-success',
  warning: '--paddock-color-warning',
  danger: '--paddock-color-danger',
  info: '--paddock-color-info',
  yellowFlag: '--paddock-color-yellow-flag',
  greenFlag: '--paddock-color-green-flag',
  redFlag: '--paddock-color-red-flag',
  safetyCar: '--paddock-color-safety-car',
  drsActive: '--paddock-color-drs-active',
  pitLane: '--paddock-color-pit-lane',
  track: '--paddock-color-track',
  trackEdge: '--paddock-color-track-edge',
  timingTowerMaxWidth: '--paddock-timing-tower-max-width',
  raceViewMinHeight: '--paddock-race-view-min-height',
};

export const LEGACY_THEME_CSS_VARIABLES = {
  accentColor: '--paddock-accent-color',
  greenColor: '--paddock-green-color',
  yellowColor: '--paddock-yellow-color',
  blueColor: '--paddock-blue-color',
  raceControlRedColor: '--paddock-race-control-red-color',
  surfaceColor: '--paddock-surface-color',
  surfaceRaisedColor: '--paddock-surface-raised-color',
  surfacePanelColor: '--paddock-surface-panel-color',
  lineColor: '--paddock-line-color',
  lineStrongColor: '--paddock-line-strong-color',
  textColor: '--paddock-text-color',
  mutedTextColor: '--paddock-muted-text-color',
  trackColor: '--paddock-track-color',
  trackEdgeColor: '--paddock-track-edge-color',
};

export const DEFAULT_COMPONENT_SLOTS = {
  button: {
    background: 'primary',
    text: 'primaryText',
    border: 'primary',
  },
  raceControls: {
    background: 'surfacePanel',
    text: 'text',
    border: 'border',
    accent: 'primary',
  },
  cameraControls: {
    background: 'surfacePanel',
    text: 'text',
    border: 'border',
    accent: 'primary',
  },
  timingTower: {
    shellBackground: 'surfacePanel',
    rowBackground: 'surfaceRaised',
    driverText: 'text',
    gapText: 'mutedText',
    warningText: 'yellowFlag',
  },
  raceCanvas: {
    track: 'track',
    trackEdge: 'trackEdge',
    pitLane: 'pitLane',
  },
  raceDataPanel: {
    background: 'surfacePanel',
    text: 'text',
    accent: 'primary',
  },
  selectedDriverPanel: {
    background: 'surfacePanel',
    text: 'text',
    accent: 'primary',
  },
  driverRows: {
    background: 'surfaceRaised',
    text: 'text',
    accent: 'primary',
  },
};

export const DEFAULT_COMPONENT_THEME_SELECTORS = {
  'car-driver-overview': 'selectedTeam',
  'race-data-panel': 'selectedTeam',
};

const PADDOCK_COMPONENT_SLOT_CSS_VARIABLES = Object.entries(DEFAULT_COMPONENT_SLOTS).flatMap(([componentName, slots]) => (
  Object.keys(slots).map((slot) => `--paddock-${toKebabCase(componentName)}-${toKebabCase(slot)}`)
));

export const PADDOCK_THEME_SCOPED_CSS_VARIABLES = [
  ...new Set([
    ...Object.values(PADDOCK_THEME_CSS_VARIABLES),
    ...Object.values(LEGACY_THEME_CSS_VARIABLES),
    ...PADDOCK_COMPONENT_SLOT_CSS_VARIABLES,
  ]),
];

export const PACKAGE_COMPONENT_THEME_KEYS = new Set([
  'button',
  'race-controls',
  'camera-controls',
  'safety-car-control',
  'timing-tower',
  'race-canvas',
  'race-data-panel',
  'car-driver-overview',
  'race-telemetry-drawer',
  'telemetry-stack',
  'telemetry-core',
  'telemetry-sectors',
  'telemetry-lap-times',
  'telemetry-sector-times',
  'telemetry-sector-banner',
  'steward-message',
  'driver-rows',
]);

export const COMPONENT_THEME_SELECTOR_ALIASES = {
  selectedDriverPanel: ['car-driver-overview', 'race-data-panel'],
  carDriverOverview: ['car-driver-overview'],
};

export const DEFAULT_DARK_THEME_TOKENS = {
  primary: '#e10600',
  primaryText: '#ffffff',
  secondary: '#151923',
  secondaryText: '#f4f7fb',
  surface: '#08090b',
  surfaceRaised: '#111318',
  surfacePanel: '#171a20',
  text: '#f4f7fb',
  mutedText: '#8d97a7',
  border: 'rgba(255, 255, 255, 0.13)',
  success: '#14c784',
  warning: '#ffd166',
  danger: '#e10600',
  info: '#39a7ff',
  yellowFlag: '#ffd166',
  greenFlag: '#14c784',
  redFlag: '#e10600',
  safetyCar: '#f5c542',
  drsActive: '#8b5cf6',
  pitLane: '#2f3540',
  track: '#262a31',
  trackEdge: '#f4f7fb',
  timingTowerMaxWidth: '390px',
  raceViewMinHeight: '620px',
};

export const DEFAULT_LIGHT_THEME_TOKENS = {
  primary: '#c90400',
  primaryText: '#ffffff',
  secondary: '#eef2f7',
  secondaryText: '#111827',
  surface: '#f6f8fb',
  surfaceRaised: '#ffffff',
  surfacePanel: '#eef2f7',
  text: '#111827',
  mutedText: '#5d6675',
  border: 'rgba(17, 24, 39, 0.16)',
  success: '#0f9f6a',
  warning: '#b97800',
  danger: '#c90400',
  info: '#1e74c9',
  yellowFlag: '#b97800',
  greenFlag: '#0f9f6a',
  redFlag: '#c90400',
  safetyCar: '#b97800',
  drsActive: '#6d28d9',
  pitLane: '#d8dee8',
  track: '#d7dde6',
  trackEdge: '#111827',
  timingTowerMaxWidth: '390px',
  raceViewMinHeight: '620px',
};

export const DEFAULT_PADDOCK_THEME_INPUT = {
  mode: 'dark',
  use: 'default',
};
export const DEFAULT_PADDOCK_THEME = DEFAULT_PADDOCK_THEME_INPUT;

export const DEFAULT_THEME_PACKAGE = {
  tokens: {
    light: DEFAULT_LIGHT_THEME_TOKENS,
    dark: DEFAULT_DARK_THEME_TOKENS,
  },
  components: DEFAULT_COMPONENT_SLOTS,
};
