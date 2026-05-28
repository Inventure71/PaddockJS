import { getRaceControlStatusBanner } from '../../ui/raceControlStatusBanner.js';
import { resolveNodes, setStyleProperty, setText } from '../domBindings.js';
import { escapeHtml, formatCssColor } from './readoutFormatters.js';

function setTextEvery(nodes, node, value) {
  resolveNodes(nodes, node).forEach((target) => {
    if (target.textContent !== value) target.textContent = value;
  });
}

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
  setStyleProperty(panel, '--driver-color', formatCssColor(winner?.color ?? winnerDriver?.color));
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
  setTextEvery(readouts.towerLaps, readouts.towerLap, leader?.lap ?? 1);
  setTextEvery(readouts.towerTotalLapsAll, readouts.towerTotalLaps, snapshot.totalLaps);
  resolveNodes(readouts.timingTowers, readouts.timingTower).forEach((timingTower) => {
    timingTower.classList.toggle('is-safety-car', snapshot.raceControl.mode === 'safety-car');
    timingTower.classList.toggle('is-red-flag', snapshot.raceControl.mode === 'red-flag');
    timingTower.classList.toggle('is-pre-start', snapshot.raceControl.mode === 'pre-start');
  });
  const raceControlBanners = resolveNodes(readouts.towerRaceControlBanners, readouts.towerRaceControlBanner);
  if (raceControlBanners.length > 0) {
    const raceControlBanner = getRaceControlStatusBanner(snapshot.raceControl.mode);
    raceControlBanners.forEach((banner) => {
      banner.hidden = !raceControlBanner;
      banner.classList?.toggle?.('is-safety-car', raceControlBanner?.status === 'safety-car');
      banner.classList?.toggle?.('is-red-flag', raceControlBanner?.status === 'red-flag');
      if (raceControlBanner && banner.dataset) {
        banner.dataset.raceControlStatus = raceControlBanner.status;
      } else if (banner.dataset) {
        delete banner.dataset.raceControlStatus;
      }
    });
    if (raceControlBanner) {
      setTextEvery(readouts.towerRaceControlKickers, readouts.towerRaceControlKicker, raceControlBanner.kicker);
      setTextEvery(readouts.towerRaceControlTitles, readouts.towerRaceControlTitle, raceControlBanner.title);
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
