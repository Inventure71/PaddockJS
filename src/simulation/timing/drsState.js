// Suppress the current latch without erasing passage history or next-zone hints.
// External placement uses the separate full reset in vehicleState.js.
export function clearCurrentDrsState(car) {
  car.drsActive = false;
  car.drsEligible = false;
  car.drsZoneId = null;
  car.drsZoneEnabled = false;
}
