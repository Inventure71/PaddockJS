import { setTextAll, setText } from '../domBindings.js';
import { clamp } from '../../simulation/simMath.js';
import { formatDriverNumber } from '../../data/championship.js';
import { formatTelemetryGap, formatTelemetryTime, setPerformanceClass } from './readoutFormatters.js';

export function renderTelemetryReadouts({ readouts, car, driverById }) {
  if (!car) return;
  const driver = driverById.get(car.id);
  const drsState = car.drsActive ? 'OPEN' : car.drsEligible ? 'READY' : 'OFF';
  const surface = (car.surface ?? 'track').toUpperCase();

  setTextAll(readouts.selectedCode, car.code);
  readouts.selectedCode?.forEach?.((node) => {
    node.style.color = car.color;
  });
  readouts.telemetrySectorBanners?.forEach?.((node) => {
    node.style.setProperty('--driver-color', car.color);
  });
  setTextAll(readouts.selectedName, car.name);
  setTextAll(readouts.speed, `${Math.round(car.speedKph)} km/h`);
  setTextAll(readouts.throttle, `${Math.round(car.throttle * 100)}%`);
  setTextAll(readouts.brake, `${Math.round(car.brake * 100)}%`);
  setTextAll(readouts.tyres, `${Math.round(car.tireEnergy ?? 100)}%`);
  setTextAll(readouts.selectedDrs, drsState);
  setTextAll(readouts.surface, surface);
  setTextAll(
    readouts.gap,
    car.rank === 1
      ? '--'
      : formatTelemetryGap(car, 'interval'),
  );
  setTextAll(
    readouts.leaderGap,
    car.rank === 1
      ? '--'
      : formatTelemetryGap(car, 'leader'),
  );
}

export function renderLapTelemetry(readouts, telemetry) {
  if (!telemetry) return;

  setTextAll(readouts.currentSector, `S${telemetry.currentSector ?? 1}`);
  setTextAll(readouts.completedLaps, `${telemetry.completedLaps ?? 0} laps`);
  setTextAll(readouts.currentLapTime, formatTelemetryTime(telemetry.currentLapTime));
  setTextAll(readouts.lastLapTime, formatTelemetryTime(telemetry.lastLapTime));
  setTextAll(readouts.bestLapTime, formatTelemetryTime(telemetry.bestLapTime));

  readouts.telemetrySectorBars?.forEach((bar) => {
    const sector = Number(bar.dataset.telemetrySectorBar);
    const index = sector - 1;
    const activeIndex = clamp((telemetry.currentSector ?? 1) - 1, 0, 2);
    const isActive = index === activeIndex;
    const isCompletedCurrentSector = index < activeIndex;
    const hasLiveProgress = Array.isArray(telemetry.sectorProgress);
    const progress = index > activeIndex
      ? 0
      : hasLiveProgress
      ? telemetry.sectorProgress[index]
      : isActive
        ? telemetry.currentSectorProgress
        : isCompletedCurrentSector && Number.isFinite(telemetry.currentSectors?.[index])
          ? 1
          : 0;
    const fill = clamp((progress ?? 0) * 100, 0, 100);
    const sectorComplete = fill >= 99.9;
    const fillValue = `${fill.toFixed(1)}%`;
    if (bar.style.getPropertyValue('--sector-fill') !== fillValue) {
      bar.style.setProperty('--sector-fill', fillValue);
    }
    bar.classList.toggle('is-active', isActive);
    bar.classList.toggle('is-complete', sectorComplete);
    setPerformanceClass(bar, isCompletedCurrentSector ? telemetry.sectorPerformance?.current?.[index] : null);
  });

  readouts.telemetrySectorTimes?.forEach((node) => {
    const sector = Number(node.dataset.telemetrySectorTime);
    const index = sector - 1;
    const activeIndex = clamp((telemetry.currentSector ?? 1) - 1, 0, 2);
    const isActive = index === activeIndex;
    const isCompletedCurrentSector = index < activeIndex;
    const hasLiveSectors = Array.isArray(telemetry.liveSectors);
    const value = index > activeIndex
      ? null
      : hasLiveSectors
        ? isActive
          ? telemetry.currentSectorElapsed ?? telemetry.liveSectors[index]
          : telemetry.liveSectors[index]
        : isActive && !Number.isFinite(telemetry.currentSectors?.[index])
          ? telemetry.currentSectorElapsed
          : isCompletedCurrentSector
            ? telemetry.currentSectors?.[index]
            : null;
    setText(node, formatTelemetryTime(value));
    setPerformanceClass(node, isCompletedCurrentSector ? telemetry.sectorPerformance?.current?.[index] : null);
  });

  readouts.telemetrySectorLast?.forEach((node) => {
    const index = Number(node.dataset.telemetrySectorLast) - 1;
    setText(node, formatTelemetryTime(telemetry.lastSectors?.[index]));
    setPerformanceClass(node, telemetry.sectorPerformance?.last?.[index]);
  });

  readouts.telemetrySectorBest?.forEach((node) => {
    const index = Number(node.dataset.telemetrySectorBest) - 1;
    setText(node, formatTelemetryTime(telemetry.bestSectors?.[index]));
    setPerformanceClass(node, telemetry.sectorPerformance?.best?.[index]);
  });
}
