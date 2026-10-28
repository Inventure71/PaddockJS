import { detectVehicleCollision } from '../../../src/simulation/collisionGeometry.js';
import { attachTrackQueryIndex, createTrackQueryIndex } from '../../../src/simulation/track/trackQueryIndex.js';
import { createVehicleGeometry } from '../../../src/simulation/vehicle/vehicleGeometry.js';
import { calculateWheelSurfaceState } from '../../../src/simulation/vehicle/wheelSurface.js';
import { NativeScrollSurface } from '../../../src/app/controls/NativeScrollSurface.js';
import { createThrottledJsonReadout } from './debugJsonReadout.js';

const COLLISION_LAB_CENTER_Y = 310;
const COLLISION_LAB_START_X = 80;
const COLLISION_LAB_SAMPLE_SPACING = 20;
const COLLISION_LAB_TRACK = {
  name: 'Collision Lab Straight',
  width: 230,
  kerbWidth: 34,
  gravelWidth: 165,
  runoffWidth: 180,
  length: 880,
  pitLane: { enabled: false },
  samples: Array.from({ length: 45 }, (_, index) => ({
    x: COLLISION_LAB_START_X + index * COLLISION_LAB_SAMPLE_SPACING,
    y: COLLISION_LAB_CENTER_Y,
    distance: index * COLLISION_LAB_SAMPLE_SPACING,
    heading: 0,
    normalX: 0,
    normalY: 1,
    curvature: 0,
  })),
};
attachTrackQueryIndex(COLLISION_LAB_TRACK, createTrackQueryIndex(COLLISION_LAB_TRACK));

function createLabCar(id, label, color, x, y, heading = 0) {
  return {
    id,
    label,
    color,
    x,
    y,
    previousX: x,
    previousY: y,
    heading,
    previousHeading: heading,
    progress: Math.max(0, Math.min(COLLISION_LAB_TRACK.length, x - COLLISION_LAB_START_X)),
    raceDistance: Math.max(0, x - COLLISION_LAB_START_X),
    speed: 0,
  };
}

function setLabCarPose(car, pose) {
  car.previousX = Number.isFinite(pose.previousX) ? pose.previousX : car.x;
  car.previousY = Number.isFinite(pose.previousY) ? pose.previousY : car.y;
  car.previousHeading = Number.isFinite(pose.previousHeading) ? pose.previousHeading : car.heading;
  car.x = pose.x;
  car.y = pose.y;
  car.heading = pose.heading;
  car.progress = Math.max(0, Math.min(COLLISION_LAB_TRACK.length, car.x - COLLISION_LAB_START_X));
  car.raceDistance = car.progress;
}

function createCollisionLabScenarios() {
  const y = COLLISION_LAB_CENTER_Y;
  return {
    'body-body': {
      alpha: { x: 410, y, heading: 0, previousX: 360, previousY: y, previousHeading: 0 },
      beta: { x: 445, y, heading: 0, previousX: 445, previousY: y, previousHeading: 0 },
    },
    'wheel-body': {
      alpha: { x: 410, y, heading: 0, previousX: 370, previousY: y, previousHeading: 0 },
      beta: { x: 470, y, heading: 0, previousX: 470, previousY: y, previousHeading: 0 },
    },
    'near-miss': {
      alpha: { x: 410, y, heading: 0, previousX: 370, previousY: y, previousHeading: 0 },
      beta: { x: 504, y: y + 31, heading: 0, previousX: 504, previousY: y + 31, previousHeading: 0 },
    },
    'one-kerb': {
      alpha: { x: 380, y: y + 95, heading: Math.PI / 2, previousX: 380, previousY: y + 40, previousHeading: Math.PI / 2 },
      beta: { x: 540, y: y - 42, heading: 0, previousX: 540, previousY: y - 42, previousHeading: 0 },
    },
    'one-gravel': {
      alpha: { x: 380, y: y + 130, heading: Math.PI / 2, previousX: 380, previousY: y + 80, previousHeading: Math.PI / 2 },
      beta: { x: 540, y: y - 42, heading: 0, previousX: 540, previousY: y - 42, previousHeading: 0 },
    },
    'all-outside': {
      alpha: { x: 390, y: y + 155, heading: 0, previousX: 340, previousY: y + 155, previousHeading: 0 },
      beta: { x: 550, y: y - 42, heading: 0, previousX: 550, previousY: y - 42, previousHeading: 0 },
    },
    'diagonal-transition': {
      alpha: { x: 410, y: y + 118, heading: Math.PI / 4, previousX: 360, previousY: y + 92, previousHeading: Math.PI / 4 },
      beta: { x: 560, y: y - 42, heading: 0, previousX: 560, previousY: y - 42, previousHeading: 0 },
    },
  };
}

function drawLabRect(context, shape, fill, stroke, lineWidth = 2) {
  context.beginPath();
  shape.corners.forEach((corner, index) => {
    if (index === 0) context.moveTo(corner.x, corner.y);
    else context.lineTo(corner.x, corner.y);
  });
  context.closePath();
  context.fillStyle = fill;
  context.strokeStyle = stroke;
  context.lineWidth = lineWidth;
  context.fill();
  context.stroke();
}

function drawLabTrack(context, canvas) {
  const trackEdge = COLLISION_LAB_TRACK.width / 2;
  const kerbEdge = trackEdge + COLLISION_LAB_TRACK.kerbWidth;
  const gravelEdge = kerbEdge + COLLISION_LAB_TRACK.gravelWidth;
  const runoffEdge = gravelEdge + COLLISION_LAB_TRACK.runoffWidth;
  const left = COLLISION_LAB_START_X;
  const right = COLLISION_LAB_START_X + COLLISION_LAB_TRACK.length;
  const fillBand = (offset, color) => {
    context.fillStyle = color;
    context.fillRect(left, COLLISION_LAB_CENTER_Y - offset, right - left, offset * 2);
  };

  context.fillStyle = '#182015';
  context.fillRect(0, 0, canvas.width, canvas.height);
  fillBand(runoffEdge, '#314024');
  fillBand(gravelEdge, '#67553e');
  fillBand(kerbEdge, '#7b1f24');
  fillBand(trackEdge, '#30343a');
  context.fillStyle = '#e8e5dc';
  context.fillRect(left, COLLISION_LAB_CENTER_Y - trackEdge - 2, right - left, 4);
  context.fillRect(left, COLLISION_LAB_CENTER_Y + trackEdge - 2, right - left, 4);
  context.strokeStyle = 'rgba(241, 198, 91, 0.42)';
  context.lineWidth = 2;
  context.setLineDash([12, 14]);
  context.beginPath();
  context.moveTo(left, COLLISION_LAB_CENTER_Y);
  context.lineTo(right, COLLISION_LAB_CENTER_Y);
  context.stroke();
  context.setLineDash([]);
}

function drawLabCar(context, car, surfaceState, selected) {
  const geometry = createVehicleGeometry(car);
  const previousGeometry = createVehicleGeometry(car, { previous: true });
  const stroke = selected ? '#f1c65b' : car.color;

  context.strokeStyle = `${car.color}66`;
  context.lineWidth = 1.5;
  context.setLineDash([5, 5]);
  context.beginPath();
  context.moveTo(previousGeometry.body.center.x, previousGeometry.body.center.y);
  context.lineTo(geometry.body.center.x, geometry.body.center.y);
  context.stroke();
  context.setLineDash([]);

  drawLabRect(context, geometry.body, `${car.color}44`, stroke, selected ? 3 : 2);
  geometry.wheels.forEach((wheel) => {
    const wheelState = surfaceState.wheels.find((candidate) => candidate.id === wheel.id);
    const fill = wheelState?.surface === 'track'
      ? '#d8dee944'
      : wheelState?.surface === 'kerb'
        ? '#ff4d5f77'
        : wheelState?.surface === 'gravel'
          ? '#d4a15f88'
          : '#7aa65d88';
    drawLabRect(context, wheel, fill, '#f4f1ea', 1.4);
    context.fillStyle = '#f4f1ea';
    context.font = '11px IBM Plex Sans, sans-serif';
    context.fillText(`${wheel.id}:${wheelState?.surface ?? 'n/a'}`, wheel.center.x + 8, wheel.center.y - 8);
  });

  context.fillStyle = '#f4f1ea';
  context.font = '700 13px IBM Plex Sans, sans-serif';
  context.fillText(car.label, geometry.body.center.x - 14, geometry.body.center.y - 18);
}

export function mountCollisionLabPage() {
  const root = document.querySelector('[data-collision-lab]');
  const canvas = document.querySelector('[data-collision-lab-canvas]');
  const readout = document.querySelector('[data-collision-lab-readout]');
  const stage = canvas?.closest('.collision-lab__stage');
  if (!root || !canvas || !readout || !stage) return;

  const context = canvas.getContext('2d');
  const scenarios = createCollisionLabScenarios();
  const cars = {
    alpha: createLabCar('lab-alpha', 'A', '#58a6ff', 410, COLLISION_LAB_CENTER_Y),
    beta: createLabCar('lab-beta', 'B', '#ff5f7a', 445, COLLISION_LAB_CENTER_Y),
  };
  let selectedId = 'alpha';
  let drag = null;
  let snapshot = null;
  let rotationScroll;
  const lifecycle = new AbortController();
  const radiansPerPixel = 0.08 / 100;
  const rotationScrollRange = (Math.PI * 4) / radiansPerPixel;
  let scrollPosition = rotationScrollRange / 2;
  const collisionJsonReadout = createThrottledJsonReadout({ intervalMs: 250 });

  function resetRotationScroll() {
    scrollPosition = rotationScrollRange / 2;
    rotationScroll?.sync({ y: scrollPosition, maxY: rotationScrollRange });
  }

  function applyScenario(name) {
    const scenario = scenarios[name] ?? scenarios['body-body'];
    setLabCarPose(cars.alpha, scenario.alpha);
    setLabCarPose(cars.beta, scenario.beta);
    selectedId = 'alpha';
    resetRotationScroll();
    render({ forceReadout: true });
  }

  function computeSnapshot() {
    const alphaSurface = calculateWheelSurfaceState({ car: cars.alpha, track: COLLISION_LAB_TRACK });
    const betaSurface = calculateWheelSurfaceState({ car: cars.beta, track: COLLISION_LAB_TRACK });
    const collision = detectVehicleCollision(cars.alpha, cars.beta);
    return {
      collision: collision ? {
        contactType: collision.contactType,
        firstShapeId: collision.firstShapeId,
        secondShapeId: collision.secondShapeId,
        depth: Number(collision.depth.toFixed(3)),
        timeOfImpact: Number(collision.timeOfImpact.toFixed(3)),
        axis: {
          x: Number(collision.axis.x.toFixed(3)),
          y: Number(collision.axis.y.toFixed(3)),
        },
      } : null,
      cars: {
        alpha: {
          surface: alphaSurface.effectiveSurface,
          trackLimits: alphaSurface.trackLimits,
          wheels: alphaSurface.wheels.map((wheel) => ({
            id: wheel.id,
            surface: wheel.surface,
            signedOffset: Number(wheel.signedOffset.toFixed(2)),
            fullyOutsideWhiteLine: wheel.fullyOutsideWhiteLine,
          })),
        },
        beta: {
          surface: betaSurface.effectiveSurface,
          trackLimits: betaSurface.trackLimits,
          wheels: betaSurface.wheels.map((wheel) => ({
            id: wheel.id,
            surface: wheel.surface,
            signedOffset: Number(wheel.signedOffset.toFixed(2)),
            fullyOutsideWhiteLine: wheel.fullyOutsideWhiteLine,
          })),
        },
      },
    };
  }

  function render({ forceReadout = false } = {}) {
    snapshot = computeSnapshot();
    drawLabTrack(context, canvas);
    const alphaSurface = calculateWheelSurfaceState({ car: cars.alpha, track: COLLISION_LAB_TRACK });
    const betaSurface = calculateWheelSurfaceState({ car: cars.beta, track: COLLISION_LAB_TRACK });
    drawLabCar(context, cars.alpha, alphaSurface, selectedId === 'alpha');
    drawLabCar(context, cars.beta, betaSurface, selectedId === 'beta');

    if (snapshot.collision) {
      const centerX = (cars.alpha.x + cars.beta.x) / 2;
      const centerY = (cars.alpha.y + cars.beta.y) / 2;
      context.strokeStyle = '#f1c65b';
      context.lineWidth = 4;
      context.beginPath();
      context.moveTo(centerX, centerY);
      context.lineTo(
        centerX + snapshot.collision.axis.x * 46,
        centerY + snapshot.collision.axis.y * 46,
      );
      context.stroke();
    }

    collisionJsonReadout.update(readout, snapshot, { force: forceReadout });
    window.__paddockCollisionLab = {
      snapshot,
      setScenario: applyScenario,
      cars,
    };
  }

  function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function pickCar(point) {
    const candidates = Object.entries(cars).map(([id, car]) => ({
      id,
      distance: Math.hypot(point.x - car.x, point.y - car.y),
    })).sort((first, second) => first.distance - second.distance);
    return candidates[0]?.distance < 70 ? candidates[0].id : selectedId;
  }

  canvas.addEventListener('pointerdown', (event) => {
    const point = canvasPoint(event);
    selectedId = pickCar(point);
    resetRotationScroll();
    const car = cars[selectedId];
    drag = {
      id: selectedId,
      dx: point.x - car.x,
      dy: point.y - car.y,
    };
    canvas.setPointerCapture(event.pointerId);
    render();
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const point = canvasPoint(event);
    const car = cars[drag.id];
    setLabCarPose(car, {
      x: point.x - drag.dx,
      y: point.y - drag.dy,
      heading: car.heading,
    });
    render();
  });

  canvas.addEventListener('pointerup', (event) => {
    drag = null;
    canvas.releasePointerCapture(event.pointerId);
    render({ forceReadout: true });
  });

  function syncStageSize() {
    // Preserve the original canvas aspect ratio and min/max height before
    // adding native overflow content. Its scroll extent must not size the stage.
    const height = Math.max(420, Math.min(stage.clientWidth * canvas.height / canvas.width, window.innerHeight * 0.72));
    stage.style.height = `${height + stage.offsetHeight - stage.clientHeight}px`;
    rotationScroll?.sync({ y: scrollPosition, maxY: rotationScrollRange });
  }

  syncStageSize();
  rotationScroll = new NativeScrollSurface(stage, ({ dy, y }) => {
    scrollPosition = y;
    const car = cars[selectedId];
    setLabCarPose(car, {
      x: car.x,
      y: car.y,
      heading: car.heading + dy * radiansPerPixel,
    });
    render({ forceReadout: true });
  }, lifecycle.signal);
  rotationScroll.sync({ y: scrollPosition, maxY: rotationScrollRange });
  const resizeObserver = new ResizeObserver(syncStageSize);
  resizeObserver.observe(stage);
  window.addEventListener('resize', syncStageSize, { signal: lifecycle.signal, passive: true });
  window.addEventListener('pagehide', (event) => {
    if (event.persisted) return;
    lifecycle.abort();
    resizeObserver.disconnect();
  }, { signal: lifecycle.signal });

  root.addEventListener('click', (event) => {
    const button = event.target instanceof Element
      ? event.target.closest('[data-collision-scenario]')
      : null;
    if (!button) return;
    applyScenario(button.dataset.collisionScenario);
  });

  applyScenario('body-body');
}
