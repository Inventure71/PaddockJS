import carSpriteUrl from '../../assets/f1-car-sprite-game.png';
import safetyCarSpriteUrl from '../../assets/f1-safety-car-sprite.png';
import broadcastPanelSurfaceUrl from '../../assets/f1-broadcast-panel-surface.png';
import asphaltTextureUrl from '../../assets/f1-texture-asphalt.png';
import f1LogoUrl from '../../assets/f1Logo.png';
import driverHelmetUrl from '../../assets/f1-driver-helmet.png';

export const DEFAULT_F1_SIMULATOR_ASSETS = {
  car: carSpriteUrl,
  carOverview: carSpriteUrl,
  driverHelmet: driverHelmetUrl,
  safetyCar: safetyCarSpriteUrl,
  broadcastPanel: broadcastPanelSurfaceUrl,
  f1Logo: f1LogoUrl,
  trackTextures: {
    asphalt: asphaltTextureUrl,
  },
};

export function resolveF1SimulatorAssets(overrides = {}) {
  return {
    ...DEFAULT_F1_SIMULATOR_ASSETS,
    ...overrides,
    trackTextures: {
      ...DEFAULT_F1_SIMULATOR_ASSETS.trackTextures,
      ...(overrides.trackTextures ?? {}),
    },
  };
}
