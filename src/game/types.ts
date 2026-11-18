export type MapId = 'alpine' | 'canyon' | 'midnight' | 'coastal';

export type CameraMode = 'chase' | 'far' | 'cockpit' | 'hood' | 'bumper' | 'aerial';

export interface CameraOption {
  id: CameraMode;
  label: string;
  shortLabel: string;
  keyHint: string;
}

export const CAMERA_OPTIONS: CameraOption[] = [
  { id: 'chase', label: 'Chase Dekat', shortLabel: 'Chase', keyHint: '1' },
  { id: 'far', label: 'Chase Jauh', shortLabel: 'Jauh', keyHint: '2' },
  { id: 'cockpit', label: 'Kokpit Pengemudi', shortLabel: 'Kokpit', keyHint: '3' },
  { id: 'hood', label: 'Kap Mesin', shortLabel: 'Kap', keyHint: '4' },
  { id: 'bumper', label: 'Bumper Depan', shortLabel: 'Bumper', keyHint: '5' },
  { id: 'aerial', label: 'Helikopter', shortLabel: 'Udara', keyHint: '6' },
];

export interface CarColorOption {
  id: string;
  name: string;
  hex: number;
  css: string;
  accentHex: number;
}

export const CAR_COLORS: CarColorOption[] = [
  { id: 'rosso', name: 'Rosso Corsa', hex: 0xd91c24, css: '#d91c24', accentHex: 0xf59e0b },
  { id: 'cobalt', name: 'Cobalt GT', hex: 0x1652f0, css: '#1652f0', accentHex: 0x38bdf8 },
  { id: 'silver', name: 'Titanium Silver', hex: 0xcbd5e1, css: '#cbd5e1', accentHex: 0xef4444 },
  { id: 'amber', name: 'Solar Amber', hex: 0xea7a08, css: '#ea7a08', accentHex: 0x111827 },
  { id: 'emerald', name: 'British Emerald', hex: 0x0b7a4b, css: '#0b7a4b', accentHex: 0xfbbf24 },
];

export interface MapConfig {
  id: MapId;
  name: string;
  subtitle: string;
  terrainLabel: string;
  trackWidth: number;
  totalLaps: number;
  skyTopColor: string;
  skyHorizonColor: string;
  fogColor: number;
  fogDensity: number;
  sunColor: number;
  sunIntensity: number;
  sunPosition: [number, number, number];
  hemiSkyColor: number;
  hemiGroundColor: number;
  hemiIntensity: number;
  groundColor: number;
  asphaltRoughness: number;
  asphaltWetness: number;
  curbPrimary: string;
  curbSecondary: string;
  isNight: boolean;
  waypoints: [number, number, number][];
}

export interface MinimapPoint {
  x: number;
  y: number;
}

export interface MinimapEntity {
  id: string;
  x: number;
  y: number;
  isPlayer: boolean;
  color: string;
}

export interface RaceTelemetry {
  speedKmh: number;
  rpmRatio: number;
  gear: number;
  nitro: number;
  isNitroActive: boolean;
  isDrifting: boolean;
  isOffRoad: boolean;
  lap: number;
  totalLaps: number;
  position: number;
  totalRacers: number;
  lapTimeMs: number;
  bestLapMs: number | null;
  totalTimeMs: number;
  countdown: number; // >0 = counting down (3,2,1), 0 = GO / racing
  raceFinished: boolean;
  minimapTrack: MinimapPoint[];
  minimapEntities: MinimapEntity[];
}

export interface ControlInput {
  throttle: boolean;
  brake: boolean;
  left: boolean;
  right: boolean;
  handbrake: boolean;
  nitro: boolean;
}
