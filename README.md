# PaddockJS

This folder is the extractable F1 simulator component. It owns the simulator source, bundled simulator assets, CSS, demo data, and the public mount API.

## API

```js
import { mountF1Simulator } from '@inventure71/paddockjs';

const simulator = await mountF1Simulator(document.getElementById('sim-root'), {
  drivers: [
    {
      id: 'budget',
      name: 'Budget Buddy',
      color: '#ff2d55',
      link: '/project_details/project-budget-buddy.html',
      raceData: ['AI finance coach', 'Python + LLM', 'Budget guardrails'],
    },
  ],
  entries: [
    {
      driverId: 'budget',
      driverNumber: 71,
      timingName: 'Budget',
      driver: { pace: 52, racecraft: 74, aggression: 38, riskTolerance: 47, patience: 81, consistency: 86 },
      vehicle: { id: 'budget-bb01', name: 'BB-01 Ledger', power: 48, braking: 72, aero: 55, dragEfficiency: 66, mechanicalGrip: 63, weightControl: 58, tireCare: 82 },
    },
  ],
  onDriverOpen(driver) {
    window.location.href = driver.link;
  },
});
```

`drivers` is the host-owned project/pilot list. `entries` is the optional driver/car pairing sheet. Assets are bundled by default, so the host website does not need to provide simulator images or textures.

The returned object supports:

- `destroy()`
- `restart(nextOptions)`
- `selectDriver(driverId)`
- `setSafetyCarDeployed(deployed)`
- `getSnapshot()`
