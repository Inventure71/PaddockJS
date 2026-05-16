import { createEnvironmentRuntime } from '../environment/runtime.js';
import { resolveEnvironmentOptions } from '../environment/options.js';
import { renderTrackSurface } from './rendering/trackRenderer.js';

export function createBrowserExpertAdapter(app, expertOptions = {}) {
  let resolvedOptions = resolveBrowserExpertOptions(app.options, expertOptions);
  let frameRenderSuppressed = false;
  let externalRendererUnsubscribe = null;
  let externalRendererAttached = false;
  let externalRendererLastMeta = null;
  let externalRendererLastFrameAt = null;
  let externalRendererLastError = null;
  let externalRendererDriverIdMap = new Map();
  let externalRendererTrackFingerprint = null;

  function resolveBrowserExpertOptions(appOptions, nextExpertOptions = {}) {
    const options = resolveEnvironmentOptions({
      ...appOptions,
      ...nextExpertOptions,
      controlledDrivers: nextExpertOptions.controlledDrivers,
    });
    if (options.result.stateOutput !== 'none') return options;
    return {
      ...options,
      result: {
        ...options.result,
        stateOutput: 'minimal',
      },
    };
  }

  function renderableSnapshot(result) {
    return result?.state?.snapshot ?? app.sim?.snapshotObservation?.() ?? app.sim?.snapshot?.() ?? null;
  }

  /*
   * Browser expert mode is a visual adapter. Compact headless options may ask for
   * no state payload, but the canvas still needs a snapshot to render.
   */
  function renderExpertResult(result, renderOptions = {}) {
    const snapshot = renderableSnapshot(result);
    if (!snapshot) return;
    app.renderExpertFrame(snapshot, {
      ...renderOptions,
      observation: result?.observation,
    });
  }

  function initialResolvedOptions() {
    return resolveBrowserExpertOptions(app.options, expertOptions);
  }

  resolvedOptions = initialResolvedOptions();

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

  function rewriteExternalFrame(frame) {
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
        externalRendererDriverIdMap.set(rawId, rawId);
        usedLocalIds.add(rawId);
        return;
      }
      const mapped = externalRendererDriverIdMap.get(rawId);
      if (typeof mapped === 'string' && mapped.length > 0 && !usedLocalIds.has(mapped)) {
        usedLocalIds.add(mapped);
        return;
      }
      const nextLocalId = knownLocalIds.find((id) => !usedLocalIds.has(id));
      if (nextLocalId) {
        externalRendererDriverIdMap.set(rawId, nextLocalId);
        usedLocalIds.add(nextLocalId);
        return;
      }
      externalRendererDriverIdMap.set(rawId, rawId);
      usedLocalIds.add(rawId);
    });

    for (const rawId of Array.from(externalRendererDriverIdMap.keys())) {
      if (!activeRawIds.has(rawId)) externalRendererDriverIdMap.delete(rawId);
    }

    const mapId = (value) => {
      if (typeof value !== 'string' || value.length === 0) return value;
      return externalRendererDriverIdMap.get(value) ?? value;
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
        externalDriverMap: Object.fromEntries(externalRendererDriverIdMap.entries()),
      },
    };
  }

  function trackFingerprint(snapshot) {
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

  function syncExternalTrackSurface(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;
    const nextFingerprint = trackFingerprint(snapshot);
    if (!nextFingerprint) return;
    if (nextFingerprint === externalRendererTrackFingerprint) return;
    if (
      !app.trackAsset ||
      !app.drsLayer ||
      !app.sensorLayer ||
      !app.pitLaneStatusLayer
    ) {
      externalRendererTrackFingerprint = nextFingerprint;
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
    externalRendererTrackFingerprint = nextFingerprint;
  }

  const runtime = createEnvironmentRuntime({
    getSimulation: () => app.sim,
    setSimulation(nextSim) {
      app.sim = nextSim;
    },
    createSimulation(nextOptions) {
      app.applyExpertOptions(nextOptions);
      return app.createRaceSimulation(nextOptions);
    },
    getOptions: () => resolvedOptions,
    setOptions(nextOptions) {
      resolvedOptions = nextOptions.result?.stateOutput === 'none'
        ? { ...nextOptions, result: { ...nextOptions.result, stateOutput: 'minimal' } }
        : nextOptions;
    },
    afterReset(result) {
      app.renderTrack();
      renderExpertResult(result, { forceDomUpdate: true });
    },
    afterStep(result) {
      if (frameRenderSuppressed) return;
      renderExpertResult(result);
    },
  });

  function assertExternalRendererDetached(method) {
    if (!externalRendererAttached) return;
    throw new Error(`Browser expert ${method}() is disabled while external renderer mode is attached.`);
  }

  function detachExternalRenderer() {
    if (typeof externalRendererUnsubscribe === 'function') {
      try {
        externalRendererUnsubscribe();
      } catch (error) {
        externalRendererLastError = error instanceof Error ? error.message : String(error);
      }
    }
    externalRendererUnsubscribe = null;
    externalRendererAttached = false;
    externalRendererDriverIdMap = new Map();
    externalRendererTrackFingerprint = null;
  }

  function attachExternalRenderer(source) {
    if (!source || typeof source.subscribe !== 'function') {
      throw new Error('attachExternalRenderer(source) requires a source with subscribe(onFrame).');
    }
    detachExternalRenderer();
    externalRendererLastError = null;
    const unsubscribe = source.subscribe((frame) => {
      if (!frame || typeof frame !== 'object') {
        externalRendererLastError = 'Invalid external frame payload.';
        return;
      }
      const rewrittenFrame = rewriteExternalFrame(frame);
      const snapshot = rewrittenFrame.snapshot;
      if (!snapshot || typeof snapshot !== 'object') {
        externalRendererLastError = 'External frame is missing snapshot.';
        return;
      }
      try {
        syncExternalTrackSurface(snapshot);
        app.renderExpertFrame(snapshot, {
          forceDomUpdate: true,
          observation: rewrittenFrame.observation && typeof rewrittenFrame.observation === 'object'
            ? rewrittenFrame.observation
            : {},
        });
        externalRendererLastMeta = rewrittenFrame.meta ?? null;
        externalRendererLastFrameAt = Date.now();
        externalRendererLastError = null;
      } catch (error) {
        externalRendererLastError = error instanceof Error ? error.message : String(error);
      }
    });
    if (typeof unsubscribe !== 'function') {
      throw new Error('attachExternalRenderer(source) subscribe(onFrame) must return an unsubscribe function.');
    }
    externalRendererUnsubscribe = unsubscribe;
    externalRendererAttached = true;
  }

  function getExternalRendererState() {
    return {
      attached: externalRendererAttached,
      lastMeta: externalRendererLastMeta,
      lastFrameAt: externalRendererLastFrameAt,
      lastError: externalRendererLastError,
    };
  }

  return {
    ...runtime,
    reset(options = {}) {
      assertExternalRendererDetached('reset');
      return runtime.reset(options);
    },
    step(actions = {}) {
      assertExternalRendererDetached('step');
      return runtime.step(actions);
    },
    resetDrivers(placements = {}, resultOptions = {}) {
      assertExternalRendererDetached('resetDrivers');
      return runtime.resetDrivers(placements, resultOptions);
    },
    destroy() {
      detachExternalRenderer();
      runtime.destroy();
    },
    setFrameRenderSuppressed(suppressed) {
      frameRenderSuppressed = Boolean(suppressed);
    },
    attachExternalRenderer,
    detachExternalRenderer,
    getExternalRendererState,
  };
}
