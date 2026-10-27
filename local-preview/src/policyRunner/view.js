import { renderPolicySenses } from './senseReadout.js';
import { POLICY_ACTION_HOLD_FRAMES } from './settings.js';
const POLICY_DIAGNOSTIC_RENDER_INTERVAL_MS = 100;
const POLICY_SENSES_RENDER_INTERVAL_MS = 250;

// Readouts consume the active session result; model senses remain sourced from
// its observation rather than recomputing information from the visual snapshot.
export function createPolicyRunnerView({ getContext, sensesPanel, readout, status, frameCounter, policyJsonReadout }) {
  let lastPolicyDiagnosticRenderAt = 0, lastPolicySensesRenderAt = 0;
  let lastPolicySensesDriverId = null, lastPolicyStatusText = '';
  function render(action, { force = false, forceReadout = false, forceSenses = false } = {}) {
    if (!force) return;
    const { activePrimaryDriver, result, snapshot, activeController, activeCheckpointUrl, activePayload, activeControlledDrivers, trainingReplayStats, policyStep, visualFrame, heldFramesRemaining, liveNodeStatusInfo, liveNodeConnectionError, socketConnected, controllerLoop, configuration, trackProfileId, trackProfile, controllerKind, controllerMetadata, liveUrl, externalRenderer, serverUrl, physicsMode, playbackSpeed, rayLayout, policyPhysicsMode, metrics } = getContext();
    const now = performance.now();
    lastPolicyDiagnosticRenderAt = now;
    const observation = activePrimaryDriver ? result?.observation?.[activePrimaryDriver] : null;
    const trackDiagnostics = snapshot?.track ? {
      hasTrackIndex: Boolean(snapshot.track.queryIndex),
      queryIndexEnumerable: Object.keys(snapshot.track).includes('queryIndex'),
    } : null;
    const shouldRenderSenses = forceSenses || activePrimaryDriver !== lastPolicySensesDriverId ||
      now - lastPolicySensesRenderAt >= POLICY_SENSES_RENDER_INTERVAL_MS;
    if (shouldRenderSenses) {
      renderPolicySenses(
        sensesPanel,
        observation,
        activeController,
        activePrimaryDriver,
        physicsMode,
      );
      lastPolicySensesRenderAt = now;
      lastPolicySensesDriverId = activePrimaryDriver;
    }
    if (readout && policyJsonReadout.due({ force: forceReadout })) {
      policyJsonReadout.update(readout, {
        configuration: configuration.id,
        trackProfile: trackProfileId,
        trackGeneration: trackProfile.trackGeneration,
        controller: controllerMetadata,
        distilledPolicy: controllerKind === 'distilled-policy' ? {
          url: activeCheckpointUrl,
          loaded: Boolean(activePayload),
        } : null,
        policyServer: controllerKind === 'policy-server' ? activeController.debugState : null,
        liveNode: controllerKind === 'live-node-view' ? {
          url: liveUrl,
          socketConnected: socketConnected,
          renderer: externalRenderer,
        } : null,
        physicsMode: physicsMode,
        loadedDistilledPolicy: controllerKind === 'distilled-policy' && Boolean(activePayload),
        generation: controllerKind === 'distilled-policy' ? activePayload?.generation ?? null : null,
        policyStep,
        visualFrame,
        activeCars: activeControlledDrivers.length,
        selectedDriver: activePrimaryDriver,
        trainingBatchReplay: trainingReplayStats,
        playbackSpeed: playbackSpeed,
        visualFrameSkip: POLICY_ACTION_HOLD_FRAMES,
        heldFramesRemaining,
        frameMetrics: metrics,
        trackDiagnostics,
        metadata: controllerKind === 'distilled-policy' && activePayload ? {
          format: activePayload.format,
          stage: activePayload.stage,
          steps: activePayload.steps,
          obsDim: activePayload.obsDim,
          hiddenSize: activePayload.hiddenSize,
          rayLayout: rayLayout,
          physicsMode: policyPhysicsMode,
          score: activePayload.score,
        } : null,
        step: result?.info?.step,
        action,
        self: observation?.object?.self ?? null,
        nearbyCars: observation?.object?.nearbyCars?.slice(0, 3),
        rays: observation?.object?.rays,
        actionSpec: controllerLoop?.actionSpec,
        observationSpec: controllerLoop?.observationSpec,
      }, { force: forceReadout });
    }
    if (status) {
      const nextStatusText = controllerKind === 'live-node-view'
        ? [
          'Active controller Live preview stream',
          liveUrl || '(unset)',
          liveNodeStatusInfo,
          liveNodeConnectionError ? `error ${liveNodeConnectionError}` : null,
        ].filter(Boolean).join(' · ')
        : controllerKind === 'policy-server'
        ? [
          'Active controller Policy server',
          activeController.debugState?.connected ? 'connected' : `waiting for ${serverUrl}`,
          `physics ${policyPhysicsMode}`,
          activeController.debugState?.error ? `error ${activeController.debugState.error}` : null,
        ].filter(Boolean).join(' · ')
        : controllerKind === 'distilled-policy' && activePayload
        ? [
          'Active controller Distilled policy',
          activeCheckpointUrl,
          `Loaded ${activePayload.format}`,
          activePayload.stage ? `stage ${activePayload.stage}` : null,
          `physics ${policyPhysicsMode}`,
          `track ${trackProfile.label}`,
          Number.isFinite(activePayload.steps) ? `${activePayload.steps} training steps` : null,
        ].filter(Boolean).join(' · ')
        : 'Active controller Distilled policy · no exported policy found.';
      if (nextStatusText !== lastPolicyStatusText) {
        status.textContent = nextStatusText;
        lastPolicyStatusText = nextStatusText;
      }
    }
    renderFrameCounter();
  }

  function renderFrameCounter() { frameCounter.update(getContext().metrics); }

  function shouldRenderPolicyDiagnostics(now = performance.now()) {
    return now - lastPolicyDiagnosticRenderAt >= POLICY_DIAGNOSTIC_RENDER_INTERVAL_MS;
  }


  return { render, renderFrameCounter, shouldRenderPolicyDiagnostics,
    reset() { lastPolicyDiagnosticRenderAt = lastPolicySensesRenderAt = 0; lastPolicySensesDriverId = null; lastPolicyStatusText = ''; },
  };
}
