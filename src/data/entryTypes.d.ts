import type { TeamData } from './teamTypes.js';

export type TireCompound = 'S' | 'M' | 'H';
export interface CustomField {
  label: string;
  value: string;
}

export type CustomFieldInput = CustomField[] | Record<string, string>;
export interface EntryPresentation {
  name?: string;
  summary?: string;
  technologies?: string[];
  details?: string[];
  image?: { src: string; alt?: string } | null;
  href?: string;
  linkLabel?: string;
}

export interface SimulatorDriver {
  presentation?: EntryPresentation;
  id: string;
  name: string;
  color: string;
  link?: string;
  icon?: string;
  code?: string;
  timingName?: string;
  tire?: TireCompound;
  raceData?: string[];
  customFields?: CustomFieldInput;
  team?: TeamData | null;
  driverNumber?: number;
  driverModel?: unknown;
}

export interface DriverRatings {
  pace: number;
  racecraft: number;
  aggression: number;
  riskTolerance: number;
  patience: number;
  consistency: number;
}

export interface VehicleRatings {
  power: number;
  braking: number;
  aero: number;
  dragEfficiency: number;
  mechanicalGrip: number;
  weightControl: number;
  tireCare: number;
}

export interface DriverBlueprint extends Partial<DriverRatings> {
  customFields?: CustomFieldInput;
  driverModel?: unknown;
}

export interface VehicleBlueprint extends Partial<VehicleRatings> {
  id?: string | null;
  name?: string | null;
  customFields?: CustomFieldInput;
  driverModel?: unknown;
}

export interface DriverConstructorArgs {
  ratings: DriverRatings;
  customFields: CustomField[];
  driverModel: unknown | null;
  pace: number;
  racecraft: number;
  consistency: number;
  personality: {
    aggression: number;
    riskTolerance: number;
    patience: number;
  };
}

export interface VehicleConstructorArgs {
  id: string | null;
  name: string | null;
  ratings: VehicleRatings;
  customFields: CustomField[];
  driverModel: unknown | null;
  powerNewtons: number;
  brakeNewtons: number;
  downforceCoefficient: number;
  dragCoefficient: number;
  tireGrip: number;
  mass: number;
  tireCare: number;
}

export class DriverData {
  constructor(input?: DriverBlueprint);
  readonly pace: number;
  readonly racecraft: number;
  readonly aggression: number;
  readonly riskTolerance: number;
  readonly patience: number;
  readonly consistency: number;
  readonly customFields: CustomField[];
  readonly driverModel: unknown | null;
  ratings(): DriverRatings;
  toConstructorArgs(): DriverConstructorArgs;
}

export class VehicleData {
  constructor(input?: VehicleBlueprint);
  readonly id: string | null;
  readonly name: string | null;
  readonly power: number;
  readonly braking: number;
  readonly aero: number;
  readonly dragEfficiency: number;
  readonly mechanicalGrip: number;
  readonly weightControl: number;
  readonly tireCare: number;
  readonly customFields: CustomField[];
  readonly driverModel: unknown | null;
  ratings(): VehicleRatings;
  toConstructorArgs(): VehicleConstructorArgs;
}

export interface ChampionshipEntryBlueprint {
  presentation?: EntryPresentation;
  driverId: string;
  driverNumber?: number;
  timingName?: string;
  driver?: DriverData | DriverBlueprint;
  vehicle?: VehicleData | VehicleBlueprint;
  team?: TeamData;
}

export interface NormalizedSimulatorDriver extends SimulatorDriver {
  code: string;
  timingCode: string;
  raceName: string;
  driverNumber: number;
  team: TeamData | null;
  pace: number;
  racecraft: number;
  consistency: number;
  personality: DriverConstructorArgs['personality'];
  vehicle: VehicleConstructorArgs;
  constructorArgs: {
    driver: DriverConstructorArgs;
    vehicle: VehicleConstructorArgs;
  };
  championship: {
    id: string;
    name: string;
    season: number;
    entryIndex: number;
    vehicleId: string | null;
  };
}
