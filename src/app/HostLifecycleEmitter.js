export class HostLifecycleEmitter {
  constructor(getOptions) {
    this.getOptions = getOptions;
    this.reset();
  }

  reset() {
    this.lastLeaderLap = null;
    this.emittedRaceEventKeys = new Set();
    this.raceFinishEmitted = false;
  }

  emitCallback(name, ...args) {
    const options = this.getOptions?.();
    const callback = options?.[name];
    if (typeof callback !== 'function') return;
    try {
      callback(...args);
    } catch (error) {
      if (name !== 'onError' && typeof options?.onError === 'function') {
        try {
          options.onError(error, { callback: name });
        } catch {
          // Host callbacks should not break the simulator runtime.
        }
      }
    }
  }

  emitSnapshot(snapshot) {
    const leader = snapshot.cars[0];
    const leaderLap = leader?.lap;
    if (Number.isFinite(leaderLap)) {
      if (this.lastLeaderLap != null && leaderLap !== this.lastLeaderLap) {
        this.emitCallback('onLapChange', {
          previousLeaderLap: this.lastLeaderLap,
          leaderLap,
          leader,
          snapshot,
        });
      }
      this.lastLeaderLap = leaderLap;
    }

    this.emitRaceEvents(snapshot.events, snapshot);

    if (snapshot.raceControl.finished && !this.raceFinishEmitted) {
      this.raceFinishEmitted = true;
      this.emitCallback('onRaceFinish', {
        winner: snapshot.raceControl.winner,
        classification: snapshot.raceControl.classification ?? [],
        snapshot,
      });
    }
  }

  emitRaceEvents(events = [], snapshot) {
    events.forEach((event) => {
      const key = [
        event.type,
        event.at ?? snapshot?.time,
        event.id ?? '',
        event.penaltyId ?? '',
        event.driverId ?? '',
        event.carId ?? '',
        event.otherCarId ?? '',
        event.winnerId ?? '',
        event.sequence ?? '',
        event.status ?? '',
      ].join(':');
      if (this.emittedRaceEventKeys.has(key)) return;
      this.emittedRaceEventKeys.add(key);
      this.emitCallback('onRaceEvent', event, snapshot);
    });
  }
}
