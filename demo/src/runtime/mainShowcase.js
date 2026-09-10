import {
  createPaddockSimulator,
  mountCameraControls,
  mountCarDriverOverview,
  mountRaceCanvas,
  mountRaceControls,
  mountRaceDataPanel,
  mountRaceTelemetryDrawer,
  mountSafetyCarControl,
  mountTelemetryCore,
  mountTelemetryLapTimes,
  mountTelemetryPanel,
  mountTelemetrySectorBanner,
  mountTelemetrySectorTimes,
  mountTelemetrySectors,
  mountTimingTower,
} from '@inventure71/paddockjs';
import { createDemoOptions, DEMO_DRIVERS } from '../data/demoOptions.js';

const byId = (id) => document.getElementById(id);

function lifecycleCallbacks(onEvent) {
  return {
    onLoadingChange: ({ loading, phase }) => onEvent(loading ? `Loading · ${phase}` : 'Runtime ready'),
    onReady: () => onEvent('Ready · first frame rendered'),
    onDriverSelect: (driver) => onEvent(`Selected · ${driver.name}`),
    onRaceEvent: (event) => onEvent(`${event.type}${event.driverId ? ` · ${event.driverId}` : ''}`),
    onLapChange: ({ leaderLap }) => onEvent(`Leader · lap ${leaderLap}`),
    onRaceFinish: ({ winner }) => onEvent(`Winner · ${winner?.name ?? winner?.driverId ?? 'classified'}`),
    onDriverOpen: (driver) => onEvent(`Host navigation · ${driver.name}`),
    onError: (error, context) => onEvent(`Error · ${context?.callback ?? error?.message ?? 'runtime'}`),
  };
}

export async function mountMainShowcase({ onEvent }) {
  const callbacks = lifecycleCallbacks(onEvent);
  let hero = null;
  let components = null;
  try {
    hero = createPaddockSimulator(createDemoOptions({ callbacks }));
    mountRaceTelemetryDrawer(byId('broadcast-root'), hero, {
      drawerInitiallyOpen: false,
      raceDataTelemetryDetail: true,
      timingTowerVerticalFit: 'expand-race-view',
      responsiveNarrowLayout: true,
    });

    components = createPaddockSimulator(createDemoOptions({
      seed: 72,
      trackSeed: 7110,
      warmup: false,
      totalLaps: 3,
    }));

    mountRaceControls(byId('race-controls-root'), components);
    mountCameraControls(byId('camera-controls-root'), components);
    mountSafetyCarControl(byId('safety-car-root'), components);
    mountTimingTower(byId('timing-tower-root'), components);
    mountRaceCanvas(byId('race-canvas-root'), components, {
      includeTimingTower: true,
      includeRaceDataPanel: true,
      includeTelemetrySectorBanner: true,
      timingTowerVerticalFit: 'scroll',
      responsiveNarrowLayout: true,
    });
    mountTelemetryPanel(byId('telemetry-panel-root'), components, { includeOverview: true });
    mountTelemetryCore(byId('telemetry-core-root'), components);
    mountTelemetrySectors(byId('telemetry-sectors-root'), components);
    mountTelemetryLapTimes(byId('telemetry-laps-root'), components);
    mountTelemetrySectorTimes(byId('telemetry-sector-times-root'), components);
    mountTelemetrySectorBanner(byId('sector-banner-root'), components);
    mountCarDriverOverview(byId('overview-root'), components);
    mountRaceDataPanel(byId('race-data-root'), components);

    await hero.start();
  } catch (error) {
    hero?.destroy();
    components?.destroy();
    throw error;
  }
  let componentStartPromise = null;

  return {
    hero,
    components,
    primaryDriverId: DEMO_DRIVERS[0].id,
    startComponents() {
      componentStartPromise ??= components.start();
      return componentStartPromise;
    },
    destroy() {
      hero.destroy();
      components.destroy();
    },
  };
}
