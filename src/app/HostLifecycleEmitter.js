export class HostLifecycleEmitter {
  constructor(getOptions, getDispatchSource = () => undefined) {
    this.getOptions = getOptions;
    this.getDispatchSource = getDispatchSource;
    this.reset();
  }

  reset() {
    this.dispatchGeneration = (this.dispatchGeneration ?? 0) + 1;
    this.lastLeaderLap = null;
    this.emittedRaceEventKeys = new Set();
    this.raceFinishEmitted = false;
  }

  captureDispatch() {
    return { generation: this.dispatchGeneration, source: this.getDispatchSource() };
  }

  isDispatchCurrent(dispatch) {
    return dispatch.source !== false &&
      dispatch.generation === this.dispatchGeneration &&
      dispatch.source === this.getDispatchSource();
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
    const dispatch = this.captureDispatch();
    if (!this.isDispatchCurrent(dispatch)) return;
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
        if (!this.isDispatchCurrent(dispatch)) return;
      }
      this.lastLeaderLap = leaderLap;
    }

    this.emitRaceEvents(snapshot.events, snapshot, dispatch);
    if (!this.isDispatchCurrent(dispatch)) return;

    if (snapshot.raceControl.finished && !this.raceFinishEmitted) {
      this.raceFinishEmitted = true;
      this.emitCallback('onRaceFinish', {
        winner: snapshot.raceControl.winner,
        classification: snapshot.raceControl.classification ?? [],
        snapshot,
      });
    }
  }

  emitRaceEvents(events = [], snapshot, dispatch = this.captureDispatch()) {
    for (const event of events) {
      if (!this.isDispatchCurrent(dispatch)) return;
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
      if (this.emittedRaceEventKeys.has(key)) continue;
      this.emittedRaceEventKeys.add(key);
      this.emitCallback('onRaceEvent', event, snapshot);
    }
  }
}
