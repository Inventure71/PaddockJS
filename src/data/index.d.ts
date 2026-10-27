import type { TeamData } from './teamTypes.js';

export type {
  PaddockPitCrewStats,
  PaddockThemeSelector,
  TeamData,
} from './teamTypes.js';

import type { PaddockProceduralTrackProfile, PaddockProceduralTrackOptions, PaddockTrackPoint, PaddockDrsZone, PaddockResolvedProceduralTrackOptions, PaddockProceduralTrack } from './trackTypes.js';
import type { TireCompound, CustomField, CustomFieldInput, EntryPresentation, SimulatorDriver, DriverRatings, VehicleRatings, DriverBlueprint, VehicleBlueprint, DriverConstructorArgs, VehicleConstructorArgs, DriverData, VehicleData, ChampionshipEntryBlueprint, NormalizedSimulatorDriver } from './entryTypes.js';
export type { PaddockProceduralTrackProfile, PaddockProceduralTrackOptions, PaddockTrackPoint, PaddockDrsZone, PaddockResolvedProceduralTrackOptions, PaddockProceduralTrack } from './trackTypes.js';
export type { TireCompound, CustomField, CustomFieldInput, EntryPresentation, SimulatorDriver, DriverRatings, VehicleRatings, DriverBlueprint, VehicleBlueprint, DriverConstructorArgs, VehicleConstructorArgs, ChampionshipEntryBlueprint, NormalizedSimulatorDriver } from './entryTypes.js';
export { DriverData, VehicleData } from './entryTypes.js';

export const CHAMPIONSHIP_ENTRY_BLUEPRINTS: ChampionshipEntryBlueprint[];
export const DEMO_PROJECT_DRIVERS: SimulatorDriver[];

export function buildChampionshipDriverGrid(
  drivers?: SimulatorDriver[],
  entries?: ChampionshipEntryBlueprint[],
): NormalizedSimulatorDriver[];
export function formatDriverNumber(driverNumber: number | string | null | undefined): string;
export function normalizeSimulatorDrivers(
  drivers: SimulatorDriver[],
  options?: { entries?: ChampionshipEntryBlueprint[]; caller?: string },
): NormalizedSimulatorDriver[];
export function createProceduralTrack(seed?: number | string, options?: PaddockProceduralTrackOptions): PaddockProceduralTrack;
export function kphToSimSpeed(kph: number): number;
export function simSpeedToKph(simSpeed: number): number;
