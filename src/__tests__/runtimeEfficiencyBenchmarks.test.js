import { execFileSync } from 'node:child_process';
import { beforeAll, describe, expect, test } from 'vitest';
import {
  REQUIRED_RUNTIME_BENCHMARK_CATEGORIES,
  runRuntimeEfficiencyBenchmarks,
  validateRuntimeEfficiencyBenchmarkResults,
} from '../../scripts/runtimeEfficiencyBenchmarks.mjs';

describe('runtime efficiency benchmarks', () => {
  let smokeResults;

  beforeAll(() => {
    smokeResults = runRuntimeEfficiencyBenchmarks({
      profile: 'smoke',
      format: 'json',
      now: () => performance.now(),
    });
  });

  function getSmokeResults() {
    return smokeResults;
  }

  test('cover the simulation, sensor, snapshot, render, and DOM hot paths', () => {
    const results = getSmokeResults();

    expect(results.profile).toBe('smoke');
    expect(results.benchmarks.length).toBeGreaterThanOrEqual(REQUIRED_RUNTIME_BENCHMARK_CATEGORIES.length);
    expect(new Set(results.benchmarks.map((benchmark) => benchmark.category))).toEqual(
      new Set(REQUIRED_RUNTIME_BENCHMARK_CATEGORIES),
    );
    expect(results.benchmarks.find((benchmark) => benchmark.category === 'simulation-phases')?.checks.phaseNames).toEqual(
      expect.arrayContaining(['prePhysicsWheelSurface', 'runoffResponse', 'localSurfaceRefresh', 'broadRaceCommit']),
    );
    expect(results.benchmarks.find((benchmark) => benchmark.category === 'simulation-phases')?.checks).toEqual(
      expect.objectContaining({
        localRefreshNearestQueries: expect.any(Number),
        localRefreshHintedArcQueries: expect.any(Number),
        localRefreshSegmentNeighborhoodQueries: expect.any(Number),
        localRefreshSegmentNeighborhoodBatchCalls: expect.any(Number),
        runoffNearestQueries: expect.any(Number),
        runoffHintedArcQueries: expect.any(Number),
        runoffSegmentNeighborhoodQueries: expect.any(Number),
        runoffRadius1Queries: expect.any(Number),
        runoffRadius2Queries: expect.any(Number),
      }),
    );
    expect(results.benchmarks.find((benchmark) => benchmark.name === 'timing-line gap without stored crossings')?.checks).toEqual(
      expect.objectContaining({
        iterations: expect.any(Number),
        noStoredTimingLineNumericGets: expect.any(Number),
      }),
    );
    expect(results.benchmarks.find((benchmark) => benchmark.category === 'pit-lane-transition')?.checks).toEqual(
      expect.objectContaining({
        iterations: expect.any(Number),
        routeSegments: expect.any(Number),
        sampleRouteIntoCalls: expect.any(Number),
        sampleRouteAllocations: 0,
        segmentFallbackScans: 0,
        sampleContainerReused: true,
        projectionScratchReused: true,
        limiterActiveSamples: expect.any(Number),
        finiteLimiterDistances: expect.any(Number),
      }),
    );
    expect(results.benchmarks.find((benchmark) => benchmark.category === 'simulation')?.checks).toEqual(
      expect.objectContaining({
        broadCommitSurfaceRefreshSkips: expect.any(Number),
        broadCommitDrsFieldScans: expect.any(Number),
        broadCommitDrsReferenceScratchBuilds: expect.any(Number),
        broadCommitDrsReferenceFullFieldFastPathCalls: expect.any(Number),
        broadCommitDrsReferenceOrderedFastPathCalls: expect.any(Number),
        broadCommitDrsNextZoneScans: expect.any(Number),
        broadCommitDrsNextZoneCacheHits: expect.any(Number),
        broadCommitDrsNextZoneFastPathChecks: expect.any(Number),
        broadCommitAggressionFieldScans: expect.any(Number),
        broadCommitFinishEvalOrderedScans: expect.any(Number),
        broadCommitFinishEvalNoFinishFastPathCalls: expect.any(Number),
        broadCommitExcludedCarResetScans: expect.any(Number),
        broadCommitExcludedCarResetSkips: expect.any(Number),
        broadCommitTimingStateUpdates: expect.any(Number),
        broadCommitLeaderGapAccumulated: expect.any(Number),
        broadCommitLeaderGapFallbackEstimates: expect.any(Number),
        sectorPerformanceDirtyCommits: expect.any(Number),
        sectorPerformanceRebuilds: expect.any(Number),
        sectorPerformanceSkippedRebuilds: expect.any(Number),
        sectorPerformanceChangedCars: expect.any(Number),
        sectorPerformanceUpdatedCars: expect.any(Number),
        sectorPerformanceOverallBestChanges: expect.any(Number),
        telemetryBuffersReused: expect.any(Boolean),
      }),
    );
    expect(results.benchmarks.find((benchmark) => benchmark.category === 'snapshots')?.checks).toEqual(
      expect.objectContaining({
        fullSnapshots: expect.any(Number),
        renderSnapshots: expect.any(Number),
        observationSnapshots: expect.any(Number),
        trainingSnapshots: expect.any(Number),
      }),
    );
    expect(results.benchmarks.find((benchmark) => benchmark.category === 'snapshot-json')?.checks).toEqual(
      expect.objectContaining({
        fullBytes: expect.any(Number),
        fullBytesPerSnapshot: expect.any(Number),
        fullTrackBytesPerSnapshot: expect.any(Number),
        fullTrackUsesSampleSchema: expect.any(Boolean),
        fullTrackSampleSchemaLength: expect.any(Number),
        fullTrackSamplesUseArrays: expect.any(Boolean),
        fullTrackPitBoxesDropTeamMetadata: expect.any(Boolean),
        renderBytes: expect.any(Number),
        renderBytesPerSnapshot: expect.any(Number),
      }),
    );
    expect(results.benchmarks.find((benchmark) => benchmark.category === 'policy-server-json')?.checks).toEqual(
      expect.objectContaining({
        richBytes: expect.any(Number),
        compactBytes: expect.any(Number),
        byteReductionRatio: expect.any(Number),
        richStringifyMs: expect.any(Number),
        compactStringifyMs: expect.any(Number),
        stringifyReductionRatio: expect.any(Number),
        compactVectorsAligned: expect.any(Boolean),
        compactPreviousActionsAligned: expect.any(Boolean),
        compactMetricsAligned: expect.any(Boolean),
        resetHasCompactFields: expect.any(Boolean),
      }),
    );
    expect(results.benchmarks.find((benchmark) => benchmark.category === 'sensor-rays')?.checks).toEqual(
      expect.objectContaining({
        nearestQueries: expect.any(Number),
        hintedArcQueries: expect.any(Number),
        segmentNeighborhoodQueries: expect.any(Number),
        raySegmentObjectAllocations: expect.any(Number),
        directPathCount: expect.any(Number),
        sampledPathCount: expect.any(Number),
        fallbackCount: expect.any(Number),
        rayChannelSetAllocations: expect.any(Number),
        carRayCallerVectorCount: expect.any(Number),
        carRayComputedVectorCount: expect.any(Number),
        carRayResultTargetCount: expect.any(Number),
        rayTargetContainersReused: expect.any(Boolean),
        rayFilteredCarTargetContainersReused: expect.any(Boolean),
        rayOptionsNormalizedReused: expect.any(Boolean),
        rayContainersReused: expect.any(Boolean),
        rayChannelContainersReused: expect.any(Boolean),
        rayChannelFlagContainersReused: expect.any(Boolean),
        rayBoundaryContainersMaterialized: expect.any(Boolean),
        rayBoundaryContainersReused: expect.any(Boolean),
        rayBoundaryDistanceArraysReused: expect.any(Boolean),
        rayTracePointReused: expect.any(Boolean),
      }),
    );
    expect(results.benchmarks.find((benchmark) => benchmark.category === 'sensor-surface-rays')?.checks).toEqual(
      expect.objectContaining({
        rayCount: expect.any(Number),
        hitCount: expect.any(Number),
        nearestQueries: 0,
        nearestFallbacks: 0,
        hintedArcQueries: 0,
        raySegmentObjectAllocations: 0,
        directPathCount: expect.any(Number),
        sampledPathCount: 0,
        fallbackCount: 0,
        traceResultContainersReused: true,
        traceResultChannelObjectsReused: true,
        surfaceBoundaryContainersReused: true,
        surfaceBoundaryDistanceArraysReused: true,
        rayTracePointReused: true,
      }),
    );
    expect(results.benchmarks.find((benchmark) => benchmark.category === 'sensor-rays')?.checks).toEqual(
      expect.objectContaining({
        nearestQueries: 0,
        hintedArcQueries: 0,
        raySegmentObjectAllocations: 0,
        rayChannelSetAllocations: 0,
        carRayComputedVectorCount: 0,
      }),
    );
    expect(results.benchmarks.find((benchmark) => benchmark.name === 'sensor ray barrier illegal-surface validation')?.checks).toEqual(
      expect.objectContaining({
        rayCount: expect.any(Number),
        hitCount: expect.any(Number),
        nearestQueries: 0,
        hintedArcQueries: 0,
        segmentNeighborhoodQueries: expect.any(Number),
        directPathCount: expect.any(Number),
        sampledPathCount: 0,
        fallbackCount: 0,
        raySegmentObjectAllocations: 0,
        rayTracePointReused: true,
      }),
    );
    expect(results.benchmarks.find((benchmark) => benchmark.name === 'sensor ray barrier off-track recovery')?.checks).toEqual(
      expect.objectContaining({
        rayCount: expect.any(Number),
        hitCount: expect.any(Number),
        nearestQueries: 0,
        hintedArcQueries: 0,
        segmentNeighborhoodQueries: expect.any(Number),
        segmentNeighborhoodBatchCalls: expect.any(Number),
        directPathCount: expect.any(Number),
        sampledPathCount: 0,
        fallbackCount: 0,
        raySegmentObjectAllocations: 0,
        rayTracePointReused: true,
      }),
    );
    expect(results.benchmarks.find((benchmark) => benchmark.name === 'sensor ray pit-lane direct boundary')?.checks).toEqual(
      expect.objectContaining({
        rayCount: expect.any(Number),
        hitCount: expect.any(Number),
        nearestQueries: 0,
        hintedArcQueries: 0,
        segmentNeighborhoodQueries: expect.any(Number),
        segmentNeighborhoodBatchCalls: 0,
        directPathCount: expect.any(Number),
        sampledPathCount: 0,
        fallbackCount: 0,
        raySegmentObjectAllocations: 0,
      }),
    );
    expect(results.benchmarks.find((benchmark) => benchmark.category === 'wheel-surface')?.checks).toEqual(
      expect.objectContaining({
        fullSamples: expect.any(Number),
        connectorAnalyticSamples: expect.any(Number),
        nearestQueries: expect.any(Number),
        hintedArcQueries: expect.any(Number),
        segmentNeighborhoodQueries: expect.any(Number),
        segmentNeighborhoodBatchCalls: expect.any(Number),
        pitQueries: expect.any(Number),
        pitBoxGridMisses: expect.any(Number),
        connectorQueriedStatePoolLength: expect.any(Number),
        wheelContainersReused: expect.any(Boolean),
        wheelSampleStateObjectsReused: expect.any(Boolean),
        trackStateObjectReused: expect.any(Boolean),
        trackLimitStateObjectReused: expect.any(Boolean),
        wheelSummaryContainerReused: expect.any(Boolean),
        trackLimitStateFromSummary: expect.any(Boolean),
        connectorQueriedStateObjectsReused: expect.any(Boolean),
        connectorProjectionObjectsReused: expect.any(Boolean),
        currentGeometryStateReusedOnPreviousPoseOnly: expect.any(Boolean),
        currentGeometryContainersReusedOnPoseChange: expect.any(Boolean),
        currentGeometryStateHasNoHotSignatures: expect.any(Boolean),
      }),
    );
    expect(results.benchmarks.find((benchmark) => benchmark.name === 'wheel surface main-track analytic')?.checks).toEqual(
      expect.objectContaining({
        analyticSamples: expect.any(Number),
        fullSamples: expect.any(Number),
        nearestQueries: expect.any(Number),
        hintedArcQueries: expect.any(Number),
        segmentNeighborhoodQueries: expect.any(Number),
        segmentNeighborhoodBatchCalls: expect.any(Number),
        pitQueries: expect.any(Number),
        wheelContainersReused: expect.any(Boolean),
        wheelSampleStateObjectsReused: expect.any(Boolean),
        trackStateObjectReused: expect.any(Boolean),
        trackLimitStateObjectReused: expect.any(Boolean),
        wheelSummaryContainerReused: expect.any(Boolean),
        trackLimitStateFromSummary: expect.any(Boolean),
        currentGeometryStateReusedOnPreviousPoseOnly: expect.any(Boolean),
        currentGeometryContainersReusedOnPoseChange: expect.any(Boolean),
        currentGeometryStateHasNoHotSignatures: expect.any(Boolean),
      }),
    );
    expect(results.benchmarks.find((benchmark) => benchmark.name === 'wheel surface connector local-refresh path')?.checks).toEqual(
      expect.objectContaining({
        connectorAnalyticSamples: expect.any(Number),
        fullSamples: expect.any(Number),
        nearestQueries: expect.any(Number),
        hintedArcQueries: expect.any(Number),
        segmentNeighborhoodQueries: expect.any(Number),
        segmentNeighborhoodBatchCalls: expect.any(Number),
        pitQueries: expect.any(Number),
        connectorQueriedStatePoolLength: expect.any(Number),
        wheelContainersReused: expect.any(Boolean),
        wheelSampleStateObjectsReused: expect.any(Boolean),
        trackStateObjectReused: expect.any(Boolean),
        trackLimitStateObjectReused: expect.any(Boolean),
        wheelSummaryContainerReused: expect.any(Boolean),
        trackLimitStateFromSummary: expect.any(Boolean),
        connectorQueriedStateObjectsReused: expect.any(Boolean),
        connectorProjectionObjectsReused: expect.any(Boolean),
        currentGeometryStateReusedOnPreviousPoseOnly: expect.any(Boolean),
        currentGeometryContainersReusedOnPoseChange: expect.any(Boolean),
        currentGeometryStateHasNoHotSignatures: expect.any(Boolean),
      }),
    );
    expect(results.benchmarks.find((benchmark) => benchmark.name === 'wheel surface connector local-refresh path')?.checks).toEqual(
      expect.objectContaining({
        nearestQueries: 0,
        hintedArcQueries: 0,
        segmentNeighborhoodQueries: expect.any(Number),
        segmentNeighborhoodBatchCalls: expect.any(Number),
        pitQueries: 0,
      }),
    );
    expect(results.benchmarks.find((benchmark) => benchmark.name === 'wheel surface near pit connector')?.checks).toEqual(
      expect.objectContaining({
        directCalculationConnectorAnalyticSamples: expect.any(Number),
        directCalculationScratchlessScalarWheelBatches: expect.any(Number),
        directCalculationScratchlessScalarWheelWrites: expect.any(Number),
        directCalculationSingleSampleWheels: expect.any(Boolean),
        directCalculationFreshWheelArrays: expect.any(Boolean),
        nearestQueries: 0,
        hintedArcQueries: 0,
        segmentNeighborhoodQueries: expect.any(Number),
        segmentNeighborhoodBatchCalls: expect.any(Number),
        pitQueries: 0,
      }),
    );
    expect(results.benchmarks.find((benchmark) => benchmark.category === 'collision')?.checks).toEqual(
      expect.objectContaining({
        candidatePairs: expect.any(Number),
        collisions: expect.any(Number),
        sweptCollisions: expect.any(Number),
        reusedCandidateArray: expect.any(Boolean),
        reusedProjectionScratch: expect.any(Boolean),
        reusedSweepScratch: expect.any(Boolean),
        reusedCollisionResult: expect.any(Boolean),
        reusedCollisionAxis: expect.any(Boolean),
        reusedShapeCollisionResult: expect.any(Boolean),
        reusedShapeCollisionAxis: expect.any(Boolean),
        contactVelocityResponses: expect.any(Number),
        contactVelocityVectorObjectAllocations: expect.any(Number),
        collisionCandidatePairMarksReused: expect.any(Boolean),
        collisionCandidateKeysSetAllocated: expect.any(Boolean),
        collisionCarOrderMapAllocated: expect.any(Boolean),
        collisionMissingDistanceSetAllocated: expect.any(Boolean),
        collisionDistanceEntryPoolReused: expect.any(Boolean),
        collisionMissingDistanceFlagsReused: expect.any(Boolean),
        collisionMissingDistanceIndexesReused: expect.any(Boolean),
        collisionCollidableCarsReused: expect.any(Boolean),
        collisionReportedContactMarksReused: expect.any(Boolean),
        collisionReportedContactsSetAllocated: expect.any(Boolean),
        collisionStewardContextReused: expect.any(Boolean),
        collisionStewardReviews: expect.any(Number),
        collisionStewardPenaltyArrayAllocations: expect.any(Number),
      }),
    );
    expect(results.benchmarks.find((benchmark) => benchmark.category === 'environment')?.checks).toEqual(
      expect.objectContaining({
        steps: expect.any(Number),
        controlledDrivers: expect.any(Number),
        vectorObservations: expect.any(Number),
        minVectorLength: expect.any(Number),
        stateIsNull: expect.any(Boolean),
        observationCarsByIdMapReused: expect.any(Boolean),
        observationEventsByDriverSkippedWithoutEvents: expect.any(Boolean),
        metricsPreviousCarsByIdMapReused: expect.any(Boolean),
        metricsCurrentCarsByIdMapReused: expect.any(Boolean),
        metricsContactCountsSkippedWithoutEvents: expect.any(Boolean),
      }),
    );
    expect(results.benchmarks.find((benchmark) => benchmark.category === 'track-query')?.checks).toEqual(
      expect.objectContaining({
        trackQueryIterations: expect.any(Number),
        nearestQueries: expect.any(Number),
        hintDistanceCacheHits: expect.any(Number),
        precomputedSegmentNeighborhoodHits: expect.any(Number),
        nearestProjectionScratchReused: expect.any(Boolean),
        precomputedSegmentProjectionScalars: expect.any(Boolean),
        nearestEmptyCellSkippedRings: expect.any(Number),
        nearestIsolatedHintQueries: expect.any(Number),
        nearestLowDensityHintQueries: expect.any(Number),
        nearestLowDensityCellExactQueries: expect.any(Number),
        nearestLowDensityCellDirectQueries: expect.any(Number),
        nearestSparseGridExactQueries: expect.any(Number),
        nearestRing2NeighborhoodExactQueries: expect.any(Number),
        arcBucketRadius2PrecomputedQueries: expect.any(Number),
        hintedArcQueries: expect.any(Number),
        hintedSegmentFastPathQueries: expect.any(Number),
        hintedSegmentWideRadiusQueries: expect.any(Number),
        hintedSegmentWideRadiusHits: expect.any(Number),
        candidateProjectionObjectAllocations: expect.any(Number),
        segmentNeighborhoodIdScratchLength: expect.any(Number),
        pitQueries: expect.any(Number),
        pitOverrideMainRoadSkips: expect.any(Number),
        pitConnectorDirectStateHits: expect.any(Number),
        pitConnectorDirectSkips: expect.any(Number),
        pitConnectorProjectionScratchReused: expect.any(Boolean),
        pitConnectorEndpointWindowProjectionCalls: expect.any(Number),
        pitConnectorFullRouteProjectionScans: expect.any(Number),
        pitRoadGridHits: expect.any(Number),
        pitRoadEndpointWindowHits: expect.any(Number),
        pitRoadGridMisses: expect.any(Number),
        pitRoadProjectionScratchReused: expect.any(Boolean),
        pitRoadPrecomputedRouteDistances: expect.any(Boolean),
        pitRoadCumulativeDistanceRebuilds: expect.any(Number),
        pitRoadQueryPoints: expect.any(Number),
        pitRoadQueryCalls: expect.any(Number),
        pitFallbacks: expect.any(Number),
      }),
    );
    expect(results.benchmarks.find((benchmark) => benchmark.name === 'timing history and line maintenance')?.checks).toEqual(
      expect.objectContaining({
        activeHistorySamplesMax: expect.any(Number),
        storedHistorySamplesMax: expect.any(Number),
        lineStoredSpanMax: expect.any(Number),
        maxAllowedLineSpan: expect.any(Number),
        carsWithPrunedTimingLines: expect.any(Number),
        directSegmentCacheHits: expect.any(Number),
        zeroTravelCalls: expect.any(Number),
        zeroTravelOwnKeysCalls: expect.any(Number),
      }),
    );
    expect(results.benchmarks.find((benchmark) => benchmark.name === 'lap telemetry in-progress sync')?.checks).toEqual(
      expect.objectContaining({
        iterations: expect.any(Number),
        cars: expect.any(Number),
        sectorArraysReused: expect.any(Boolean),
        noBoundaryCrosses: expect.any(Boolean),
      }),
    );
    expect(() => validateRuntimeEfficiencyBenchmarkResults(results)).not.toThrow();
  });

  test('rejects benchmark results that do not exercise their intended workload', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark, index) => (
        index === 0
          ? {
              ...benchmark,
              operations: 0,
              checks: { ...benchmark.checks, operations: 0 },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/did not execute/i);
  });

  test('rejects simulation-phase benchmarks that stop using the tight runoff local-segment path', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'simulation-phases'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                runoffRadius1Queries: 0,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/runoffRadius1Queries/);
  });

  test('rejects timing-maintenance benchmarks that let timing history or timing-line retention grow unbounded', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.name === 'timing history and line maintenance'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                storedHistorySamplesMax: benchmark.checks.maxAllowedLineSpan + 1000,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/storedHistorySamplesMax/);
  });

  test('rejects timing-maintenance benchmarks that rescan timing-line keys on unchanged zero-travel updates', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.name === 'timing history and line maintenance'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                zeroTravelOwnKeysCalls: 1,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/zeroTravelOwnKeysCalls/);
  });

  test('rejects timing-maintenance benchmarks that stop hitting the direct interpolation segment cache', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.name === 'timing history and line maintenance'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                directSegmentCacheHits: 0,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/directSegmentCacheHits/);
  });

  test('rejects timing-line gap benchmarks that still read crossings without stored timing-line bounds', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.name === 'timing-line gap without stored crossings'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                noStoredTimingLineNumericGets: 1,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/noStoredTimingLineNumericGets/);
  });

  test('rejects lap-telemetry in-progress benchmarks that stop reusing the in-place sector buffers', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.name === 'lap telemetry in-progress sync'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                sectorArraysReused: false,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/sectorArraysReused/);
  });

  test('rejects pit route transition benchmarks that allocate sampled route points', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'pit-lane-transition'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                sampleRouteIntoCalls: benchmark.checks.iterations - 1,
                sampleRouteAllocations: 1,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/sampleRouteIntoCalls|sampleRouteAllocations/);
  });

  test('rejects sensor ray benchmarks that leave the direct path', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'sensor-rays'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                directPathCount: benchmark.checks.rayCount - 1,
                sampledPathCount: 0,
                fallbackCount: 1,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/directPathCount|fallbackCount/);
  });

  test('rejects sensor ray benchmarks that keep the direct path but still overuse nearest-track classification', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'sensor-rays'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                nearestQueries: 1,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/nearestQueries/);
  });

  test('rejects sensor ray benchmarks that spend more than one indexed boundary-neighborhood query per direct ray', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'sensor-rays'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                segmentNeighborhoodQueries: benchmark.checks.rayCount + 1,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/segmentNeighborhoodQueries/);
  });

  test('rejects sensor ray benchmarks that spill direct validation onto hinted arc queries', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'sensor-rays'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                hintedArcQueries: 1,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/hintedArcQueries/);
  });

  test('rejects sensor ray benchmarks that replace rich ray channel containers on the scratch path', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'sensor-rays'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                rayChannelContainersReused: false,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/rayChannelContainersReused/);
  });

  test('rejects sensor ray benchmarks that allocate channel sets or replace channel flags on the scratch path', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'sensor-rays'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                rayChannelSetAllocations: 1,
                rayChannelFlagContainersReused: false,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/rayChannelSetAllocations|rayChannelFlagContainersReused/);
  });

  test('rejects sensor ray benchmarks that replace indexed ray boundary containers on the scratch path', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'sensor-rays'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                rayBoundaryContainersReused: false,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/rayBoundaryContainersReused/);
  });

  test('rejects sensor ray benchmarks that replace indexed ray boundary distance arrays on the scratch path', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'sensor-rays'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                rayBoundaryDistanceArraysReused: false,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/rayBoundaryDistanceArraysReused/);
  });

  test('rejects sensor ray benchmarks that materialize track segment objects on the direct path', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'sensor-rays'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                raySegmentObjectAllocations: 1,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/raySegmentObjectAllocations/);
  });

  test('rejects sensor ray benchmarks that allocate a fresh ray trace sample point', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'sensor-rays'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                rayTracePointReused: false,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/rayTracePointReused/);
  });

  test('rejects batch-training surface ray benchmarks that leave tracer-owned direct geometry', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'sensor-surface-rays'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                directPathCount: benchmark.checks.rayCount - 1,
                sampledPathCount: 1,
                fallbackCount: 1,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/directPathCount|sampledPathCount|fallbackCount/);
  });

  test('rejects batch-training surface ray benchmarks that replace tracer-owned result containers', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'sensor-surface-rays'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                traceResultContainersReused: false,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/traceResultContainersReused/);
  });

  test('rejects batch-training surface ray benchmarks that replace surface-boundary arrays', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'sensor-surface-rays'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                surfaceBoundaryDistanceArraysReused: false,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/surfaceBoundaryDistanceArraysReused/);
  });

  test('rejects sensor ray benchmarks that recompute car-ray vectors on the scratch path', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'sensor-rays'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                carRayComputedVectorCount: 1,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/carRayComputedVectorCount/);
  });

  test('rejects sensor ray benchmarks that do not write car-ray hits into scratch result targets', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'sensor-rays'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                carRayResultTargetCount: benchmark.checks.carRayCallerVectorCount - 1,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/carRayResultTargetCount/);
  });

  test('rejects sensor ray benchmarks that rebuild ray target wrappers on the scratch path', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'sensor-rays'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                rayTargetContainersReused: false,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/rayTargetContainersReused/);
  });

  test('rejects sensor ray benchmarks that rebuild filtered car target containers on the scratch path', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'sensor-rays'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                rayFilteredCarTargetContainersReused: false,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/rayFilteredCarTargetContainersReused/);
  });

  test('rejects sensor ray benchmarks that rebuild normalized ray options on the scratch path', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'sensor-rays'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                rayOptionsNormalizedReused: false,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/rayOptionsNormalizedReused/);
  });

  test('rejects barrier illegal-surface validation benchmarks that fall back to full nearest-track classification', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.name === 'sensor ray barrier illegal-surface validation'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                nearestQueries: 1,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/nearestQueries/);
  });

  test('rejects barrier off-track recovery ray benchmarks that fall back to full nearest-track classification', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.name === 'sensor ray barrier off-track recovery'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                nearestQueries: 1,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/nearestQueries/);
  });

  test('rejects barrier off-track recovery ray benchmarks that regress back to sampled local marching', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.name === 'sensor ray barrier off-track recovery'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                sampledPathCount: 1,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/sampledPathCount/);
  });

  test('rejects pit-lane direct boundary ray benchmarks that leave tracer-owned direct geometry', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.name === 'sensor ray pit-lane direct boundary'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                nearestQueries: 1,
                directPathCount: benchmark.checks.rayCount - 1,
                sampledPathCount: 1,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/nearestQueries|directPathCount|sampledPathCount/);
  });



  test('rejects simulation benchmarks that rescan field depth inside broad-commit aggression updates', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'simulation'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                broadCommitAggressionFieldScans: 1,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/broadCommitAggressionFieldScans/);
  });

  test('rejects simulation benchmarks that stop using the indexed DRS reference scratch path on broad commit', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'simulation'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                broadCommitDrsReferenceScratchBuilds: benchmark.checks.broadRaceStateCommits - 1,
                broadCommitDrsReferenceOrderedFastPathCalls: 0,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/broadCommitDrsReferenceScratchBuilds|broadCommitDrsReferenceOrderedFastPathCalls/);
  });

  test('rejects simulation benchmarks that stop using the common full-field DRS reference fast path on broad commit', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'simulation'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                broadCommitDrsReferenceFullFieldFastPathCalls: 0,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/broadCommitDrsReferenceFullFieldFastPathCalls/);
  });

  test('rejects simulation benchmarks that lose the cached next-zone DRS path on broad commit', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'simulation'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                broadCommitDrsNextZoneScans: benchmark.checks.cars + 1,
                broadCommitDrsNextZoneCacheHits: 0,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/broadCommitDrsNextZoneScans|broadCommitDrsNextZoneCacheHits/);
  });

  test('rejects simulation benchmarks that stop using the no-finish fast path on broad commit', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'simulation'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                broadCommitFinishEvalNoFinishFastPathCalls: 0,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/broadCommitFinishEvalNoFinishFastPathCalls/);
  });

  test('rejects simulation benchmarks that still scan the full field looking for excluded cars on the normal broad-commit path', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'simulation'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                broadCommitExcludedCarResetScans: 1,
                broadCommitExcludedCarResetSkips: benchmark.checks.broadRaceStateCommits - 1,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/broadCommitExcludedCarResetScans|broadCommitExcludedCarResetSkips/);
  });

  test('rejects simulation benchmarks that do not record timing state exactly once per car per broad commit', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'simulation'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                broadCommitTimingStateUpdates: benchmark.checks.broadRaceStateCommits,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/broadCommitTimingStateUpdates/);
  });

  test('rejects simulation benchmarks that fall back to direct leader-gap estimation in the standard broad-commit path', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'simulation'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                broadCommitLeaderGapAccumulated: 0,
                broadCommitLeaderGapFallbackEstimates: 1,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/broadCommitLeaderGapAccumulated|broadCommitLeaderGapFallbackEstimates/);
  });

  test('rejects simulation benchmarks that still rebuild sector-performance classifications on every broad commit', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'simulation'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                sectorPerformanceSkippedRebuilds: 0,
                sectorPerformanceUpdatedCars: benchmark.checks.cars + 1,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/sectorPerformanceSkippedRebuilds|sectorPerformanceUpdatedCars/);
  });

  test('rejects wheel-surface benchmarks that still rely on full connector sampling', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'wheel-surface'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                fullSamples: 1,
                connectorAnalyticSamples: benchmark.checks.wheelIterations - 1,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/fullSamples|connectorAnalyticSamples/);
  });

  test('rejects wheel-surface benchmarks that still spend too many nearest-track queries', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'wheel-surface'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                nearestQueries: benchmark.checks.wheelIterations * 3,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/nearestQueries/);
  });

  test('rejects near-pit connector wheel-surface benchmarks that fall back to a broad center nearest query', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.name === 'wheel surface near pit connector'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                nearestQueries: 1,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/nearestQueries/);
  });

  test('rejects near-pit connector wheel-surface benchmarks that still spend straight main-track wheel-center queries', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.name === 'wheel surface near pit connector'
          ? {
              ...benchmark,
              checks: {
              ...benchmark.checks,
                segmentNeighborhoodQueries: 1,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/segmentNeighborhoodQueries/);
  });

  test('rejects near-pit connector wheel-surface benchmarks whose direct path stops using scalar wheel writers', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.name === 'wheel surface near pit connector'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                directCalculationScratchlessScalarWheelBatches: benchmark.checks.wheelIterations - 1,
                directCalculationScratchlessScalarWheelWrites: benchmark.checks.wheelIterations * 4 - 1,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(
      /directCalculationScratchlessScalarWheelBatches|directCalculationScratchlessScalarWheelWrites/,
    );
  });

  test('rejects wheel-surface benchmarks that still use hinted arc queries', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'wheel-surface'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                hintedArcQueries: 1,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/hintedArcQueries/);
  });

  test('rejects wheel-surface benchmarks that stop reusing connector queried-state objects', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'wheel-surface'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                connectorQueriedStateObjectsReused: false,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/connectorQueriedStateObjectsReused/);
  });

  test('rejects wheel-surface benchmarks that stop reusing connector projection objects', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'wheel-surface'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                connectorProjectionObjectsReused: false,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/connectorProjectionObjectsReused/);
  });

  test('rejects wheel-surface benchmarks that still waste pit-box grid misses', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'wheel-surface'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                pitBoxGridMisses: 1,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/pitBoxGridMisses/);
  });

  test('rejects wheel-surface benchmarks that stop reusing sampled-state objects', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'wheel-surface'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                wheelSampleStateObjectsReused: false,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/wheelSampleStateObjectsReused/);
  });

  test('rejects wheel-surface benchmarks that replace the track-state object on recompute', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'wheel-surface'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                trackStateObjectReused: false,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/trackStateObjectReused/);
  });

  test('rejects connector local-refresh wheel-surface benchmarks that materialize connector queried track-state pools on the all-main-track route', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.name === 'wheel surface connector local-refresh path'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                connectorQueriedStatePoolLength: 1,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/connectorQueriedStatePoolLength/);
  });

  test('rejects wheel-surface benchmarks that rebuild current geometry when only previous pose changes', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'wheel-surface'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                currentGeometryStateReusedOnPreviousPoseOnly: false,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/currentGeometryStateReusedOnPreviousPoseOnly/);
  });

  test('rejects wheel-surface benchmarks that replace current-geometry containers after a pose change', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'wheel-surface'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                currentGeometryContainersReusedOnPoseChange: false,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/currentGeometryContainersReusedOnPoseChange/);
  });

  test('rejects wheel-surface benchmarks that rebuild hot current-geometry signature bookkeeping', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'wheel-surface'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                currentGeometryStateHasNoHotSignatures: false,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/currentGeometryStateHasNoHotSignatures/);
  });

  test('rejects wheel-surface benchmarks that detach track limits from the reusable summary', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'wheel-surface'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                trackLimitStateObjectReused: false,
                wheelSummaryContainerReused: false,
                trackLimitStateFromSummary: false,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(
      /trackLimitStateObjectReused|wheelSummaryContainerReused|trackLimitStateFromSummary/,
    );
  });

  test('rejects collision benchmarks that do not reuse sweep scratch', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'collision'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                reusedSweepScratch: false,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/reusedSweepScratch/);
  });

  test('rejects collision benchmarks that do not reuse SAT projection scratch', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'collision'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                reusedProjectionScratch: false,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/reusedProjectionScratch/);
  });

  test('rejects collision benchmarks that replace collision result containers', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'collision'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                reusedCollisionResult: false,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/reusedCollisionResult/);
  });

  test('rejects collision benchmarks that replace collision axis containers', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'collision'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                reusedCollisionAxis: false,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/reusedCollisionAxis/);
  });

  test('rejects collision benchmarks that replace shape collision result containers', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'collision'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                reusedShapeCollisionResult: false,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/reusedShapeCollisionResult/);
  });

  test('rejects collision benchmarks that replace shape collision axis containers', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'collision'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                reusedShapeCollisionAxis: false,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/reusedShapeCollisionAxis/);
  });

  test('rejects collision benchmarks that rebuild vector objects during contact velocity response', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'collision'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                contactVelocityVectorObjectAllocations: 1,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/contactVelocityVectorObjectAllocations/);
  });

  test('rejects collision benchmarks that replace resolver-owned phase scratch containers', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'collision'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                collisionCollidableCarsReused: false,
                collisionReportedContactMarksReused: false,
                collisionReportedContactsSetAllocated: true,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(
      /collisionCollidableCarsReused|collisionReportedContactMarksReused|collisionReportedContactsSetAllocated/,
    );
  });

  test('rejects collision benchmarks that rebuild steward context containers per contact', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'collision'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                collisionStewardContextReused: false,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/collisionStewardContextReused/);
  });

  test('rejects collision benchmarks that review contacts through array-returning steward paths', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'collision'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                collisionStewardPenaltyArrayAllocations: 1,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/collisionStewardPenaltyArrayAllocations/);
  });

  test('rejects collision benchmarks that regress to broadphase key-set allocation', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'collision'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                collisionCandidatePairMarksReused: false,
                collisionCandidateKeysSetAllocated: true,
                collisionCarOrderMapAllocated: true,
                collisionMissingDistanceSetAllocated: true,
                collisionDistanceEntryPoolReused: false,
                collisionMissingDistanceFlagsReused: false,
                collisionMissingDistanceIndexesReused: false,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(
      /collisionCandidatePairMarksReused|collisionCandidateKeysSetAllocated|collisionCarOrderMapAllocated|collisionMissingDistanceSetAllocated|collisionDistanceEntryPoolReused|collisionMissingDistanceFlagsReused|collisionMissingDistanceIndexesReused/,
    );
  });

  test('rejects track-query benchmarks that do not exercise indexed pit queries', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'track-query'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                pitQueries: 0,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/pitQueries/);
  });

  test('rejects track-query benchmarks that stop skipping pit overrides on proven main-road queries', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'track-query'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                pitOverrideMainRoadSkips: 0,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/pitOverrideMainRoadSkips/);
  });

  test('rejects track-query benchmarks that stop exercising direct connector pit-road state resolution', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'track-query'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                pitConnectorDirectStateHits: 0,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/pitConnectorDirectStateHits/);
  });

  test('rejects track-query benchmarks that stop proving direct connector skip coverage', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'track-query'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                pitConnectorDirectSkips: 0,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/pitConnectorDirectSkips/);
  });

  test('rejects track-query benchmarks that stop reusing direct connector projection scratch', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'track-query'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                pitConnectorProjectionScratchReused: false,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/pitConnectorProjectionScratchReused/);
  });

  test('rejects track-query benchmarks that stop using connector endpoint projection windows', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'track-query'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                pitConnectorEndpointWindowProjectionCalls: 0,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/pitConnectorEndpointWindowProjectionCalls/);
  });

  test('rejects track-query benchmarks that scan full pit-road routes in the direct connector shortcut', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'track-query'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                pitConnectorFullRouteProjectionScans: 1,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/pitConnectorFullRouteProjectionScans/);
  });

  test('rejects track-query benchmarks that let indexed pit queries climb above the measured route ceiling', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'track-query'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                pitQueries: benchmark.checks.trackQueryIterations * (benchmark.checks.pitRoadQueryPoints + 2) + 1,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/pitQueries/);
  });

  test('rejects track-query benchmarks that still use hinted arc fallback work', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'track-query'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                hintedArcQueries: 1,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/hintedArcQueries/);
  });

  test('rejects track-query benchmarks that stop using isolated hinted nearest-query fast paths', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'track-query'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                nearestIsolatedHintQueries: 0,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/nearestIsolatedHintQueries/);
  });

  test('rejects track-query benchmarks that stop using low-density hinted nearest-query fast paths', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'track-query'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                nearestLowDensityHintQueries: 0,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/nearestLowDensityHintQueries/);
  });

  test('rejects track-query benchmarks that stop using low-density cell exact nearest-query fast paths', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'track-query'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                nearestLowDensityCellExactQueries: 0,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/nearestLowDensityCellExactQueries/);
  });

  test('rejects track-query benchmarks that route low-density cell exact nearest queries through arc prepasses again', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'track-query'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                nearestLowDensityCellDirectQueries: 0,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/nearestLowDensityCellDirectQueries/);
  });

  test('rejects track-query benchmarks that stop using sparse exact-grid nearest-query paths outside runoff', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'track-query'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                nearestSparseGridExactQueries: 0,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/nearestSparseGridExactQueries/);
  });

  test('rejects track-query benchmarks that stop hitting the repeated progress-hint cache', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'track-query'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                hintDistanceCacheHits: 0,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/hintDistanceCacheHits/);
  });

  test('rejects track-query benchmarks that stop using precomputed wrapped segment neighborhoods', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'track-query'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                precomputedSegmentNeighborhoodHits: 0,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/precomputedSegmentNeighborhoodHits/);
  });




  test('rejects track-query benchmarks that stop using ring-2 neighborhood exact nearest-query fast paths', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'track-query'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                nearestRing2NeighborhoodExactQueries: 0,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/nearestRing2NeighborhoodExactQueries/);
  });

  test('rejects track-query benchmarks that stop using precomputed radius-2 arc neighborhoods', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'track-query'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                arcBucketRadius2PrecomputedQueries: 0,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/arcBucketRadius2PrecomputedQueries/);
  });

  test('rejects track-query benchmarks that stop reusing internal nearest projection scratch', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'track-query'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                nearestProjectionScratchReused: false,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/nearestProjectionScratchReused/);
  });

  test('rejects track-query benchmarks that stop reusing pit-road projection scratch', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'track-query'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                pitRoadProjectionScratchReused: false,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/pitRoadProjectionScratchReused/);
  });

  test('rejects track-query benchmarks that stop using precomputed pit-road route distances', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'track-query'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                pitRoadPrecomputedRouteDistances: false,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/pitRoadPrecomputedRouteDistances/);
  });

  test('rejects track-query benchmarks that rebuild pit-road cumulative distances per query', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'track-query'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                pitRoadCumulativeDistanceRebuilds: 1,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/pitRoadCumulativeDistanceRebuilds/);
  });

  test('rejects track-query benchmarks that stop exposing precomputed segment projection scalars', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'track-query'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                precomputedSegmentProjectionScalars: false,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/precomputedSegmentProjectionScalars/);
  });

  test('rejects track-query benchmarks that stop skipping empty exact-grid rings before the first occupied segment cell', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'track-query'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                nearestEmptyCellSkippedRings: 0,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/nearestEmptyCellSkippedRings/);
  });

  test('rejects track-query benchmarks that stop using the hinted segment fast path', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'track-query'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                hintedSegmentFastPathQueries: 0,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/hintedSegmentFastPathQueries/);
  });

  test('rejects track-query benchmarks that stop exercising the wide-runoff wide-radius segment path', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'track-query'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                hintedSegmentWideRadiusQueries: 0,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/hintedSegmentWideRadiusQueries/);
  });

  test('rejects track-query benchmarks that materialize neighborhood id scratch arrays', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'track-query'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                segmentNeighborhoodIdScratchLength: 1,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/segmentNeighborhoodIdScratchLength/);
  });

  test('rejects track-query benchmarks that allocate transient candidate projection objects', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'track-query'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                candidateProjectionObjectAllocations: 1,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/candidateProjectionObjectAllocations/);
  });

  test('rejects snapshot JSON benchmarks that regress serialized track size', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'snapshot-json'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                fullTrackBytesPerSnapshot: 50001,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/fullTrackBytesPerSnapshot/);
  });

  test('rejects simulation phase benchmarks that still spend hinted runoff projections', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'simulation-phases'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                runoffHintedArcQueries: 1,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/runoffHintedArcQueries/);
  });

  test('rejects simulation phase benchmarks that stop exercising local runoff projections', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'simulation-phases'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                runoffSegmentNeighborhoodQueries: 0,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/runoffSegmentNeighborhoodQueries/);
  });

  test('rejects simulation phase benchmarks that still spend nearest-track queries in runoff', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'simulation-phases'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                runoffNearestQueries: 1,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/runoffNearestQueries/);
  });

  test('rejects simulation phase benchmarks that still spend nearest-track queries in local refresh', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'simulation-phases'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                localRefreshNearestQueries: 1,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/localRefreshNearestQueries/);
  });

  test('rejects simulation phase benchmarks that still spend hinted arc queries in local refresh', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'simulation-phases'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                localRefreshHintedArcQueries: 1,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/localRefreshHintedArcQueries/);
  });

  test('rejects simulation phase benchmarks that overuse local segment queries in local refresh', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'simulation-phases'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                localRefreshSegmentNeighborhoodQueries: 749,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/localRefreshSegmentNeighborhoodQueries/);
  });

  test('rejects simulation phase benchmarks that overuse batched local segment queries in local refresh', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'simulation-phases'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                localRefreshSegmentNeighborhoodBatchCalls: 188,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/localRefreshSegmentNeighborhoodBatchCalls/);
  });


  test('rejects simulation benchmarks that still recompute surfaces during the broad commit', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'simulation'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                broadCommitSurfaceRefreshSkips: benchmark.checks.broadRaceStateCommits - 1,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/broadCommitSurfaceRefreshSkips/);
  });

  test('rejects simulation benchmarks that still scan the field for DRS references during the broad commit', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'simulation'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                broadCommitDrsFieldScans: 1,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/broadCommitDrsFieldScans/);
  });

  test('rejects simulation benchmarks that stop reusing lap telemetry buffers', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'simulation'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                telemetryBuffersReused: false,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/telemetryBuffersReused/);
  });

  test('rejects environment benchmarks that rebuild observation lookup maps on the scratch path', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'environment'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                observationCarsByIdMapReused: false,
                observationEventsByDriverSkippedWithoutEvents: false,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/observationCarsByIdMapReused|observationEventsByDriverSkippedWithoutEvents/);
  });

  test('rejects environment benchmarks that rebuild metric lookup maps on the scratch path', () => {
    const results = getSmokeResults();
    const invalid = {
      ...results,
      benchmarks: results.benchmarks.map((benchmark) => (
        benchmark.category === 'environment'
          ? {
              ...benchmark,
              checks: {
                ...benchmark.checks,
                metricsPreviousCarsByIdMapReused: false,
                metricsCurrentCarsByIdMapReused: false,
                metricsContactCountsSkippedWithoutEvents: false,
              },
            }
          : benchmark
      )),
    };

    expect(() => validateRuntimeEfficiencyBenchmarkResults(invalid)).toThrow(/metricsPreviousCarsByIdMapReused|metricsCurrentCarsByIdMapReused|metricsContactCountsSkippedWithoutEvents/);
  });


  test('CLI verify mode emits machine-readable benchmark evidence', () => {
    const output = execFileSync(
      process.execPath,
      ['scripts/benchmark-runtime-efficiency.mjs', '--profile=smoke', '--json', '--verify'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      },
    );
    const parsed = JSON.parse(output);

    expect(parsed.profile).toBe('smoke');
    expect(parsed.benchmarks.map((benchmark) => benchmark.name)).toContain('simulation.step advanced field');
    expect(() => validateRuntimeEfficiencyBenchmarkResults(parsed)).not.toThrow();
  });
});
