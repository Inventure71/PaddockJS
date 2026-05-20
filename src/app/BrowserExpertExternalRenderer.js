import { renderTrackSurface } from './rendering/trackRenderer.js';

export function createBrowserExpertExternalRendererBridge(app) {
  let unsubscribeExternalRenderer = null;
  let attached = false;
  let lastMeta = null;
  let lastFrameAt = null;
  let lastError = null;
  let driverIdMap = new Map();
  let trackFingerprint = null;
  let appliedTrackSurface = false;

  function localDriverRecords() {
    const source = Array.isArray(app.drivers) && app.drivers.length > 0
      ? app.drivers
      : app.options?.drivers;
    return Array.isArray(source) ? source : [];
  }

  function localDriverIds() {
    return localDriverRecords()
      .map((driver) => driver?.id)
      .filter((id) => typeof id === 'string' && id.length > 0);
  }

  function localDriverById() {
    return new Map(localDriverRecords().map((driver) => [driver.id, driver]));
  }

  function rewriteFrame(frame) {
    if (!frame || typeof frame !== 'object') return frame;
    const snapshot = frame.snapshot;
    if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.cars)) return frame;

    const knownLocalIds = localDriverIds();
    if (knownLocalIds.length === 0) return frame;
    const knownLocalIdSet = new Set(knownLocalIds);

    const activeRawIds = new Set();
    const usedLocalIds = new Set();

    snapshot.cars.forEach((car, index) => {
      const rawId = typeof car?.id === 'string' && car.id.length > 0
        ? car.id
        : `external-${String(index)}`;
      activeRawIds.add(rawId);
      if (knownLocalIdSet.has(rawId) && !usedLocalIds.has(rawId)) {
        driverIdMap.set(rawId, rawId);
        usedLocalIds.add(rawId);
        return;
      }
      const mapped = driverIdMap.get(rawId);
      if (typeof mapped === 'string' && mapped.length > 0 && !usedLocalIds.has(mapped)) {
        usedLocalIds.add(mapped);
        return;
      }
      const nextLocalId = knownLocalIds.find((id) => !usedLocalIds.has(id));
      if (nextLocalId) {
        driverIdMap.set(rawId, nextLocalId);
        usedLocalIds.add(nextLocalId);
        return;
      }
      driverIdMap.set(rawId, rawId);
      usedLocalIds.add(rawId);
    });

    for (const rawId of Array.from(driverIdMap.keys())) {
      if (!activeRawIds.has(rawId)) driverIdMap.delete(rawId);
    }

    const mapId = (value) => {
      if (typeof value !== 'string' || value.length === 0) return value;
      return driverIdMap.get(value) ?? value;
    };

    const drivers = localDriverById();
    const mappedCars = snapshot.cars.map((car, index) => {
      const rawId = typeof car?.id === 'string' && car.id.length > 0
        ? car.id
        : `external-${String(index)}`;
      const mappedId = mapId(rawId);
      const driver = drivers.get(mappedId);
      return {
        ...car,
        id: mappedId,
        code: car?.code ?? driver?.code ?? mappedId,
        timingCode: car?.timingCode ?? driver?.timingCode ?? driver?.code ?? mappedId,
        name: car?.name ?? driver?.name ?? mappedId,
        color: car?.color ?? driver?.color ?? '#9ca3af',
        icon: car?.icon ?? driver?.icon ?? (driver?.code ?? mappedId),
        team: car?.team ?? driver?.team ?? null,
      };
    });

    const mappedEvents = Array.isArray(snapshot.events)
      ? snapshot.events.map((event) => ({
        ...event,
        carId: mapId(event?.carId),
        otherCarId: mapId(event?.otherCarId),
        winnerId: mapId(event?.winnerId),
      }))
      : snapshot.events;

    const mappedPenalties = Array.isArray(snapshot.penalties)
      ? snapshot.penalties.map((penalty) => ({
        ...penalty,
        driverId: mapId(penalty?.driverId),
      }))
      : snapshot.penalties;

    const raceControl = snapshot.raceControl && typeof snapshot.raceControl === 'object'
      ? {
        ...snapshot.raceControl,
        winner: snapshot.raceControl.winner && typeof snapshot.raceControl.winner === 'object'
          ? {
            ...snapshot.raceControl.winner,
            id: mapId(snapshot.raceControl.winner.id),
          }
          : snapshot.raceControl.winner,
        classification: Array.isArray(snapshot.raceControl.classification)
          ? snapshot.raceControl.classification.map((entry) => ({
            ...entry,
            id: mapId(entry?.id),
            driverId: mapId(entry?.driverId),
          }))
          : snapshot.raceControl.classification,
      }
      : snapshot.raceControl;

    let mappedObservation = frame.observation;
    if (frame.observation && typeof frame.observation === 'object' && !Array.isArray(frame.observation)) {
      mappedObservation = {};
      Object.entries(frame.observation).forEach(([driverId, value]) => {
        mappedObservation[mapId(driverId)] = value;
      });
    }

    return {
      ...frame,
      snapshot: {
        ...snapshot,
        cars: mappedCars,
        events: mappedEvents,
        penalties: mappedPenalties,
        raceControl,
      },
      observation: mappedObservation,
      meta: {
        ...(frame.meta && typeof frame.meta === 'object' ? frame.meta : {}),
        externalDriverMap: Object.fromEntries(driverIdMap.entries()),
      },
    };
  }

  function fingerprintTrack(snapshot) {
    const track = snapshot?.track;
    if (!track || typeof track !== 'object') return null;
    const drs = Array.isArray(track.drsZones)
      ? track.drsZones.map((zone) => [zone?.id ?? null, zone?.start ?? null, zone?.end ?? null])
      : [];
    const firstSample = Array.isArray(track.samples) && track.samples.length > 0 ? track.samples[0] : null;
    const lastSample = Array.isArray(track.samples) && track.samples.length > 0
      ? track.samples[track.samples.length - 1]
      : null;
    return JSON.stringify({
      name: track.name ?? null,
      length: track.length ?? null,
      width: track.width ?? null,
      sampleCount: track.sampleCount ?? null,
      finish: track.finish
        ? {
          x: track.finish.x ?? null,
          y: track.finish.y ?? null,
          heading: track.finish.heading ?? null,
        }
        : null,
      firstSample: firstSample
        ? {
          x: firstSample.x ?? null,
          y: firstSample.y ?? null,
          heading: firstSample.heading ?? null,
        }
        : null,
      lastSample: lastSample
        ? {
          x: lastSample.x ?? null,
          y: lastSample.y ?? null,
          heading: lastSample.heading ?? null,
        }
        : null,
      drs,
    });
  }

  function syncTrackSurface(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;
    const nextFingerprint = fingerprintTrack(snapshot);
    if (!nextFingerprint) return;
    if (nextFingerprint === trackFingerprint) return;
    if (
      !app.trackAsset ||
      !app.drsLayer ||
      !app.sensorLayer ||
      !app.pitLaneStatusLayer
    ) {
      trackFingerprint = nextFingerprint;
      return;
    }
    app.pitLaneStatusRenderer?.reset?.();
    app.cameraController?.invalidateTrackCaches?.();
    renderTrackSurface({
      drsLayer: app.drsLayer,
      sensorLayer: app.sensorLayer,
      pitLaneStatusLayer: app.pitLaneStatusLayer,
      trackAsset: app.trackAsset,
      snapshot,
    });
    trackFingerprint = nextFingerprint;
    appliedTrackSurface = true;
  }

  function assertDetached(method) {
    if (!attached) return;
    throw new Error(`Browser expert ${method}() is disabled while external renderer mode is attached.`);
  }

  function detach() {
    if (typeof unsubscribeExternalRenderer === 'function') {
      try {
        unsubscribeExternalRenderer();
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    unsubscribeExternalRenderer = null;
    attached = false;
    driverIdMap = new Map();
    if (appliedTrackSurface && typeof app.renderTrack === 'function') {
      try {
        app.renderTrack();
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    trackFingerprint = null;
    appliedTrackSurface = false;
  }

  function attach(source) {
    if (!source || typeof source.subscribe !== 'function') {
      throw new Error('attachExternalRenderer(source) requires a source with subscribe(onFrame).');
    }
    detach();
    lastError = null;
    const unsubscribe = source.subscribe((frame) => {
      if (!frame || typeof frame !== 'object') {
        lastError = 'Invalid external frame payload.';
        return;
      }
      const rewrittenFrame = rewriteFrame(frame);
      const snapshot = rewrittenFrame.snapshot;
      if (!snapshot || typeof snapshot !== 'object') {
        lastError = 'External frame is missing snapshot.';
        return;
      }
      try {
        syncTrackSurface(snapshot);
        app.renderExpertFrame(snapshot, {
          forceDomUpdate: true,
          observation: rewrittenFrame.observation && typeof rewrittenFrame.observation === 'object'
            ? rewrittenFrame.observation
            : {},
        });
        lastMeta = rewrittenFrame.meta ?? null;
        lastFrameAt = Date.now();
        lastError = null;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    });
    if (typeof unsubscribe !== 'function') {
      throw new Error('attachExternalRenderer(source) subscribe(onFrame) must return an unsubscribe function.');
    }
    unsubscribeExternalRenderer = unsubscribe;
    attached = true;
  }

  function getState() {
    return {
      attached,
      lastMeta,
      lastFrameAt,
      lastError,
    };
  }

  return {
    assertDetached,
    attach,
    detach,
    getState,
  };
}
