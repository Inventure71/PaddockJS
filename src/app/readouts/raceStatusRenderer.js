import { getRaceControlStatusBanner } from '../../ui/raceControlStatusBanner.js';
import { setText } from '../domBindings.js';
import { escapeHtml } from './readoutFormatters.js';

export function renderStartLights(readouts, startLightNodes, raceControl) {
  const panel = readouts.startLights;
  if (!panel) return;

  const start = raceControl.start;
  const visible = Boolean(start?.visible);
  panel.hidden = !visible;
  if (!visible) return;

  startLightNodes.forEach((light, index) => {
    light.classList.toggle('is-lit', index < (start.lightsLit ?? 0));
  });
  panel.classList.toggle('is-lights-out', raceControl.mode === 'green' && start.released);

  if (readouts.startLightsLabel) {
    readouts.startLightsLabel.textContent = raceControl.mode === 'green' && start.released
      ? 'Lights out'
      : `${start.lightsLit}/${start.lightCount}`;
  }
}

export function renderRaceFinish({ readouts, snapshot, driverById, lastFinishClassificationMarkup }) {
  const panel = readouts.finishPanel;
  if (!panel) return lastFinishClassificationMarkup;

  panel.hidden = !snapshot.raceControl.finished;
  if (!snapshot.raceControl.finished) return lastFinishClassificationMarkup;

  const winner = snapshot.raceControl.winner;
  const winnerDriver = winner ? driverById.get(winner.id) : null;
  const winnerName = winnerDriver?.name ?? winner?.name ?? 'Winner';
  panel.style.setProperty('--driver-color', winner?.color ?? winnerDriver?.color ?? 'var(--red)');
  setText(readouts.finishWinner, winnerName);

  if (readouts.finishClassification) {
    const topThree = (snapshot.raceControl.classification ?? []).slice(0, 3);
    const classificationMarkup = topThree.map((entry) => `
        <li>
          <span>P${escapeHtml(entry.rank)}</span>
          <strong>${escapeHtml(entry.timingCode ?? entry.code ?? entry.id)}</strong>
        </li>
      `).join('');
    if (classificationMarkup !== lastFinishClassificationMarkup) {
      readouts.finishClassification.innerHTML = classificationMarkup;
      return classificationMarkup;
    }
  }

  return lastFinishClassificationMarkup;
}

export function renderRaceStatusReadouts({
  readouts,
  startLightNodes,
  snapshot,
  camera,
  fps,
  activeDrs,
  contactCount,
  driverById,
  lastFinishClassificationMarkup,
}) {
  const leader = snapshot.cars[0];

  if (readouts.mode) {
    const modeLabel = snapshot.raceControl.mode === 'safety-car'
        ? 'SC'
        : snapshot.raceControl.mode === 'red-flag'
          ? 'RED'
        : snapshot.raceControl.finished
          ? 'FINISH'
          : 'GREEN';
    readouts.mode.textContent = modeLabel;
    readouts.mode.style.color = snapshot.raceControl.mode === 'safety-car'
      ? 'var(--yellow)'
      : snapshot.raceControl.mode === 'red-flag'
        ? 'var(--race-control-red)'
        : snapshot.raceControl.mode === 'finished'
          ? 'var(--red)'
          : 'var(--green)';
  }
  if (readouts.lap) readouts.lap.textContent = `${leader?.lap ?? 1}/${snapshot.totalLaps}`;
  if (readouts.towerLap) readouts.towerLap.textContent = leader?.lap ?? 1;
  if (readouts.towerTotalLaps) readouts.towerTotalLaps.textContent = snapshot.totalLaps;
  if (readouts.timingTower) {
    readouts.timingTower.classList.toggle('is-safety-car', snapshot.raceControl.mode === 'safety-car');
    readouts.timingTower.classList.toggle('is-red-flag', snapshot.raceControl.mode === 'red-flag');
    readouts.timingTower.classList.toggle('is-pre-start', snapshot.raceControl.mode === 'pre-start');
  }
  if (readouts.towerRaceControlBanner) {
    const raceControlBanner = getRaceControlStatusBanner(snapshot.raceControl.mode);
    readouts.towerRaceControlBanner.hidden = !raceControlBanner;
    readouts.towerRaceControlBanner.classList?.toggle?.('is-safety-car', raceControlBanner?.status === 'safety-car');
    readouts.towerRaceControlBanner.classList?.toggle?.('is-red-flag', raceControlBanner?.status === 'red-flag');
    if (raceControlBanner && readouts.towerRaceControlBanner.dataset) {
      readouts.towerRaceControlBanner.dataset.raceControlStatus = raceControlBanner.status;
    } else if (readouts.towerRaceControlBanner.dataset) {
      delete readouts.towerRaceControlBanner.dataset.raceControlStatus;
    }
    if (raceControlBanner) {
      setText(readouts.towerRaceControlKicker, raceControlBanner.kicker);
      setText(readouts.towerRaceControlTitle, raceControlBanner.title);
    }
  }
  if (readouts.drs) {
    readouts.drs.textContent = ['safety-car', 'red-flag'].includes(snapshot.raceControl.mode)
      ? 'DISABLED'
      : activeDrs
        ? `${activeDrs} OPEN`
        : 'ARMED';
  }
  if (readouts.contacts) readouts.contacts.textContent = String(contactCount);
  renderStartLights(readouts, startLightNodes, snapshot.raceControl);
  if (readouts.camera) {
    const zoom = Math.round(camera.zoom * 100);
    const mode = camera.free ? 'FREE' : camera.mode.toUpperCase().replace('-', ' ');
    readouts.camera.textContent = `${mode} ${zoom}%`;
  }
  if (readouts.fps) {
    readouts.fps.textContent = fps.current ? `${fps.current}` : '--';
  }

  return renderRaceFinish({
    readouts,
    snapshot,
    driverById,
    lastFinishClassificationMarkup,
  });
}
