import { Container, Graphics } from 'pixi.js';

export class GridWalkCrew {
  constructor(worldLayer, cars) {
    this.container = new Container();
    this.container.eventMode = 'none';
    this.people = [];
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
    worldLayer.addChild(this.container);
  }

  render({ active, motion, elapsed, clearing, clearProgress }) {
    this.container.visible = active;
    if (!active) return;
    this.container.alpha = clearing ? 1 - clearProgress : 1;
    for (const { person, x, y, phase } of this.people) {
      person.position.set(x + (motion ? Math.sin(elapsed / 680 + phase) * 1.4 : 0),
        y + (clearing ? Math.sign(y) * clearProgress * 100 : 0));
    }
  }

  destroy() { this.container.destroy({ children: true }); }
}
