export type PaddockThemeSelector =
  | 'default'
  | 'active'
  | 'selectedTeam'
  | 'team'
  | `team:${string}`
  | string;

export interface PaddockPitCrewStats {
  speed?: number;
  consistency?: number;
  reliability?: number;
}

export interface TeamData {
  id?: string;
  name?: string;
  color?: string;
  icon?: string;
  theme?: PaddockThemeSelector;
  pitCrew?: PaddockPitCrewStats;
  pitCrewStats?: PaddockPitCrewStats;
}
