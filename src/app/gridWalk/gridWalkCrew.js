import { Container, Graphics } from 'pixi.js';

const WALKER_SHIRTS = [0xd7dee5, 0x345b78, 0xb65a43, 0x70937d, 0xc4a564, 0x5c617d];
const WALKER_SKIN = [0xefc7a5, 0xd9a17b, 0xa56b48, 0x754b37];

// Cosmetic variation has its own generator. It never consumes race randomness.
function crowdRandom(cars) {
  let seed = 2166136261;
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
  const first = cars[0];
  const last = cars.at(-1);
  // Wrap outside the occupied grid, rather than teleport beside an entry.
  points.unshift({ x: points[0].x + Math.cos(first.heading) * 100,
    y: points[0].y + Math.sin(first.heading) * 100 });
  points.push({ x: points.at(-1).x - Math.cos(last.heading) * 100,
    y: points.at(-1).y - Math.sin(last.heading) * 100 });
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
  return { segments, length };
}

export class GridWalkCrew {
  constructor(worldLayer, cars) {
    this.container = new Container();
    this.container.eventMode = 'none';
    this.people = [];
    this.walkers = [];
    this.lastElapsed = null;
    this.ambientElapsed = 0;
    for (const car of cars) {
      const team = new Container();
      team.position.set(car.x, car.y);
      team.rotation = car.heading;
      for (const [index, [x, y]] of [[-22, -22], [22, 22], [-26, 23]].entries()) {
        const person = new Graphics()
          .roundRect(-5, -4, 10, 8, 2).fill(0xd9dfe6)
          .circle(4, 0, 3).fill(0xf0cbb1)
          .moveTo(0, -4).lineTo(5, -8).moveTo(0, 4).lineTo(5, 8)
          .stroke({ color: 0x9aa9b8, width: 2 });
        person.position.set(x, y);
        person.rotation = y < 0 ? Math.PI / 2 : -Math.PI / 2;
        this.people.push({ person, x, y, phase: this.people.length + index });
        team.addChild(person);
      }
      team.addChild(new Graphics().roundRect(-36, -35, 18, 8, 2).fill(0x39444f)
        .circle(-32, -26, 2).circle(-22, -26, 2).fill(0x10151a));
      this.container.addChild(team);
    }
    if (cars.length) {
      const random = crowdRandom(cars);
      const count = Math.min(24, Math.max(6, cars.length * 2));
      for (let index = 0; index < count; index += 1) {
        // The two verges leave cars and their mechanics a clear working area.
        const side = index % 2 ? 1 : -1;
        const route = walkingRoute(cars, side * (77 + random() * 6));
        const walker = { ...createWalker(random), route, side,
          distance: random() * route.length, speed: 13 + random() * 9, phase: random() * Math.PI * 2 };
        this.walkers.push(walker);
        this.container.addChild(walker.person);
      }
    }
    worldLayer.addChild(this.container);
    this.render({ active: true, motion: false, elapsed: 0, clearing: false, clearProgress: 0 });
  }

  render({ active, motion, elapsed, clearing, clearProgress }) {
    const delta = active && motion && this.lastElapsed !== null ? Math.max(0, elapsed - this.lastElapsed) : 0;
    this.lastElapsed = elapsed;
    this.container.visible = active;
    if (!active) return;
    this.ambientElapsed += delta;
    this.container.alpha = clearing ? 1 - clearProgress : 1;
    for (const { person, x, y, phase } of this.people) {
      person.position.set(x + Math.sin(this.ambientElapsed / 680 + phase) * 1.4,
        y + (clearing ? Math.sign(y) * clearProgress * 100 : 0));
    }
    for (const walker of this.walkers) {
      const { person, route, side, feet, arms, phase } = walker;
      walker.distance = (walker.distance + delta / 1000 * walker.speed) % route.length;
      const segment = route.segments.find((part) => walker.distance < part.end) ?? route.segments.at(-1);
      const progress = walker.distance - segment.start;
      const exit = clearing ? side * clearProgress * 100 : 0;
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
