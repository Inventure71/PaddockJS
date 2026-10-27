import { Container, Graphics } from 'pixi.js';

const WALKER_SHIRTS = [0xd7dee5, 0x345b78, 0xb65a43, 0x70937d, 0xc4a564, 0x5c617d];
const WALKER_SKIN = [0xefc7a5, 0xd9a17b, 0xa56b48, 0x754b37];

// Cosmetic variation has its own generator. It never consumes race randomness.
function crowdRandom(cars, seed = 2166136261) {
  for (const car of cars) {
    for (const letter of String(car.id)) seed = Math.imul(seed ^ letter.charCodeAt(0), 16777619);
  }
  return () => {
    seed = Math.imul(seed ^ (seed >>> 16), 2246822507);
    seed = Math.imul(seed ^ (seed >>> 13), 3266489909);
    return ((seed ^= seed >>> 16) >>> 0) / 4294967296;
  };
}

function createWalker(random) {
  const person = new Container();
  const shirt = WALKER_SHIRTS[Math.floor(random() * WALKER_SHIRTS.length)];
  const skin = WALKER_SKIN[Math.floor(random() * WALKER_SKIN.length)];
  const feet = [-3, 3].map((y) => {
    const foot = new Graphics().roundRect(-6, -1.5, 7, 3, 1).fill(0x202932);
    foot.y = y;
    person.addChild(foot);
    return foot;
  });
  const arms = [-6, 6].map((y) => {
    const arm = new Graphics().roundRect(-4, -1.5, 8, 3, 1.5).fill(skin);
    arm.y = y;
    person.addChild(arm);
    return arm;
  });
  person.addChild(new Graphics()
    .ellipse(-1, 1, 9, 7).fill({ color: 0x10151a, alpha: 0.12 })
    .roundRect(-5, -5, 10, 10, 3).fill(shirt)
    .circle(4, 0, 3.2).fill(skin)
    .arc(4, 0, 3.2, -Math.PI / 2, Math.PI / 2).stroke({ color: 0x473b33, width: 1.5 }));
  return { person, feet, arms };
}

function walkingRoute(cars, offset) {
  const points = cars.map((car) => ({
    x: car.x - Math.sin(car.heading) * (offset - (car.gridOffset ?? 0)),
    y: car.y + Math.cos(car.heading) * (offset - (car.gridOffset ?? 0)),
  }));
  const coreLength = points.slice(1).reduce((length, point, index) =>
    length + Math.hypot(point.x - points[index].x, point.y - points[index].y), 0);
  return { points, coreLength, frontHeading: cars[0].heading, rearHeading: cars.at(-1).heading,
    before: 0, after: 0, segments: [], length: 0 };
}

function extendRoute(route, before, after) {
  // Panning can introduce tiny floating-point differences in inverse projection.
  before = before > route.before + 0.001 ? before : route.before;
  after = after > route.after + 0.001 ? after : route.after;
  if (before === route.before && after === route.after) return 0;
  const first = route.points[0];
  const last = route.points.at(-1);
  const points = [
    { x: first.x + Math.cos(route.frontHeading) * before,
      y: first.y + Math.sin(route.frontHeading) * before },
    ...route.points,
    { x: last.x - Math.cos(route.rearHeading) * after,
      y: last.y - Math.sin(route.rearHeading) * after },
  ];
  const segments = [];
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const dx = points[index].x - start.x;
    const dy = points[index].y - start.y;
    const distance = Math.hypot(dx, dy);
    if (!distance) continue;
    segments.push({ x: start.x, y: start.y, dx: dx / distance, dy: dy / distance,
      start: length, end: length + distance, heading: Math.atan2(dy, dx) });
    length += distance;
  }
  const shift = before - route.before;
  Object.assign(route, { before, after, segments, length });
  return shift;
}

function createMechanics(cars, people) {
  const random = crowdRandom(cars, 0x6d656368);
  const teams = [];
  const slots = [[-25, -23], [24, -24], [-27, 24], [25, 24], [0, -27], [0, 28]];
  for (const car of cars) {
    const team = new Container();
    team.position.set(car.x, car.y);
    team.rotation = car.heading;
    // Shuffle working positions so teams differ in both size and arrangement.
    const positions = slots.map((slot) => [...slot]);
    for (let index = positions.length - 1; index > 0; index -= 1) {
      const other = Math.floor(random() * (index + 1));
      [positions[index], positions[other]] = [positions[other], positions[index]];
    }
    const count = 2 + Math.floor(random() * 4);
    for (const [slotX, slotY] of positions.slice(0, count)) {
      const x = slotX + (random() - 0.5) * 5;
      const y = slotY + (random() - 0.5) * 3;
      const kneeling = random() < 0.4;
      const working = random() < 0.7;
      const person = new Graphics()
        .roundRect(-5, -4, kneeling ? 8 : 10, 8, 2).fill(0xd9dfe6)
        .circle(kneeling ? 2 : 4, 0, 3).fill(0xf0cbb1)
        .moveTo(0, -4).lineTo(working ? 6 : -3, -7)
        .moveTo(0, 4).lineTo(working ? 6 : -3, 7)
        .stroke({ color: 0x9aa9b8, width: 2 });
      person.position.set(x, y);
      person.rotation = (y < 0 ? Math.PI / 2 : -Math.PI / 2) + (random() - 0.5) * 0.45;
      people.push({ person, x, y, phase: random() * Math.PI * 2,
        amplitude: working ? (kneeling ? 0.45 : 1.2) : 0.2, cadence: 500 + random() * 450 });
      team.addChild(person);
    }
    const equipmentX = random() < 0.5 ? -36 : 22;
    team.addChild(new Graphics().roundRect(equipmentX, -39, 18, 8, 2).fill(0x39444f)
      .circle(equipmentX + 4, -30, 2).circle(equipmentX + 14, -30, 2).fill(0x10151a));
    teams.push(team);
  }
  return teams;
}

export class GridWalkCrew {
  constructor(worldLayer, cars) {
    this.container = new Container();
    this.container.eventMode = 'none';
    this.people = [];
    this.walkers = [];
    this.lastElapsed = null;
    this.ambientElapsed = 0;
    this.heading = cars[0]?.heading ?? 0;
    for (const team of createMechanics(cars, this.people)) this.container.addChild(team);
    this.lanes = [];
    if (cars.length) {
      const random = crowdRandom(cars);
      for (const side of [-1, 1]) {
        const route = walkingRoute(cars, side * 80);
        // Keep a modest density even for unusually long host-supplied grids.
        const spacing = Math.max(150, route.coreLength / 32);
        const lane = { route, side, spacing, speed: 16 + random() * 3,
          phase: random() * spacing, walkers: [], random };
        this.lanes.push(lane);
        this.extendLane(lane, spacing, spacing);
      }
    }
    worldLayer.addChild(this.container);
    this.render({ active: true, motion: false, elapsed: 0, clearing: false, clearProgress: 0 });
  }

  updateCamera(frame, width, height) {
    const cos = Math.cos(frame.rotation);
    const sin = Math.sin(frame.rotation);
    const along = { x: Math.cos(this.heading), y: Math.sin(this.heading) };
    const corners = [];
    // Include controls/banner space too: people are still visible behind HTML.
    for (const pan of [frame.minPosition, frame.maxPosition]) {
      const shift = pan - frame.position;
      for (const x of [0, width]) for (const y of [0, height]) {
        const dx = (x - frame.x) / frame.scale;
        const dy = (y - frame.y) / frame.scale;
        corners.push({ x: dx * cos + dy * sin + shift * along.x,
          y: -dx * sin + dy * cos + shift * along.y });
      }
    }
    const margin = 14 + 24 / frame.scale;
    for (const lane of this.lanes) {
      const { route } = lane;
      const front = route.points[0];
      const rear = route.points.at(-1);
      const before = Math.max(...corners.map((point) => (point.x - front.x) * Math.cos(route.frontHeading) +
        (point.y - front.y) * Math.sin(route.frontHeading))) + margin;
      const after = Math.max(...corners.map((point) => -(point.x - rear.x) * Math.cos(route.rearHeading) -
        (point.y - rear.y) * Math.sin(route.rearHeading))) + margin;
      this.extendLane(lane, before, after);
    }
  }

  extendLane(lane, before, after) {
    const { route, spacing, random, side } = lane;
    const leading = Math.ceil(Math.max(before, route.before) / spacing - 1e-10) * spacing;
    const count = Math.ceil((route.coreLength + leading + Math.max(after, route.after)) / spacing - 1e-10);
    const trailing = count * spacing - route.coreLength - leading;
    // Whole traffic slots extend the route without changing its moving pattern.
    const shift = extendRoute(route, leading, trailing);
    if (!shift && lane.walkers.length === count) return;
    const occupied = new Set();
    for (const walker of lane.walkers) {
      walker.distance += shift;
      // A person just across the old wrap seam still keeps their world pose.
      // Locate occupied slots from current positions rather than their birth order.
      occupied.add((Math.round((walker.distance - lane.phase) / spacing) + count) % count);
    }
    const newSlots = [];
    for (let slot = 0; slot < count; slot += 1) if (!occupied.has(slot)) newSlots.push(slot);
    for (const slot of newSlots) {
      const phase = random() * Math.PI * 2;
      const cadence = 6000 + random() * 5000;
      const amplitude = 4 + random() * 4;
      const wobble = Math.sin(this.ambientElapsed / cadence + phase) * amplitude;
      const distance = slot * spacing + lane.phase + (random() - 0.5) * spacing * 0.24 + wobble;
      const walker = { ...createWalker(random), route, side, phase, cadence, amplitude, wobble,
        lane, lateral: (random() - 0.5) * 6, distance: (distance + route.length) % route.length };
      lane.walkers.push(walker);
      this.walkers.push(walker);
      this.container.addChild(walker.person);
    }
  }

  render({ active, motion, elapsed, clearing, clearProgress }) {
    const delta = active && motion && this.lastElapsed !== null ? Math.max(0, elapsed - this.lastElapsed) : 0;
    this.lastElapsed = elapsed;
    this.container.visible = active;
    if (!active) return;
    this.ambientElapsed += delta;
    this.container.alpha = clearing ? 1 - clearProgress : 1;
    for (const { person, x, y, phase, amplitude, cadence } of this.people) {
      person.position.set(x + Math.sin(this.ambientElapsed / cadence + phase) * amplitude,
        y + (clearing ? Math.sign(y) * clearProgress * 100 : 0));
    }
    for (const lane of this.lanes) lane.phase = (lane.phase + delta / 1000 * lane.speed) % lane.spacing;
    for (const walker of this.walkers) {
      const { person, route, side, feet, arms, phase, lane, cadence, amplitude } = walker;
      // Individual speed variation is bounded in space, so traffic cannot slowly
      // collapse into groups followed by long empty stretches after repeated laps.
      const wobble = Math.sin(this.ambientElapsed / cadence + phase) * amplitude;
      walker.distance = (walker.distance + delta / 1000 * lane.speed + wobble - walker.wobble +
        route.length) % route.length;
      walker.wobble = wobble;
      const segment = route.segments.find((part) => walker.distance < part.end) ?? route.segments.at(-1);
      const progress = walker.distance - segment.start;
      const exit = walker.lateral + (clearing ? side * clearProgress * 100 : 0);
      person.position.set(segment.x + segment.dx * progress + segment.dy * exit,
        segment.y + segment.dy * progress - segment.dx * exit);
      person.rotation = segment.heading;
      const stride = Math.sin(this.ambientElapsed / 155 + phase) * 2.4;
      feet[0].x = arms[1].x = stride;
      feet[1].x = arms[0].x = -stride;
    }
  }

  destroy() { this.container.destroy({ children: true }); }
}
