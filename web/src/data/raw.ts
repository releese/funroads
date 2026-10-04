// Shapes of the generated caches as written by src/funroads/route.py and
// src/funroads/linked.py. Read-only: the UI never writes these back.
import { DEFAULT_COUNTRY } from './countries';

export type LonLat = [number, number];
export type Home = string;
export const HOMES: Home[] = DEFAULT_COUNTRY.homes;

export const DIMENSIONS = ['corners', 'flow', 'quiet', 'speed', 'elevation', 'surface', 'scenery'] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export interface RawRoad {
  name: string;
  km: number;
  fun: number; // 0-100
}

export interface RawDetail {
  climb_m?: number | null;
  corner_count?: { tight: number; sweet: number; flowing: number };
  corners?: { dir: string; lat: number; lon: number; r: number; v: number }[];
  stops?: { type: string; note: string; lat: number; lon: number }[];
  curv?: [number, number][];
  elev?: [number, number][];
  seg?: { i0: number; i1: number; fun: number; lim: number; v: number }[];
  why?: string[];
}

export interface RawCircuit extends RawDetail {
  id: string;
  name: string;
  area_id: string;
  area_name: string;
  km: number;
  fun_km: number;
  drive_min: number;
  reach_min: number | null; // from the Zaandam graph origin only
  climb_m: number | null;
  corner_count: { tight: number; sweet: number; flowing: number };
  corners: { dir: string; lat: number; lon: number; r: number; v: number }[];
  curv: [number, number][]; // [km, 0-1]
  elev: [number, number][]; // [km, m]
  seg: { i0: number; i1: number; fun: number; lim: number; v: number }[];
  flags: string[];
  line: LonLat[];
  links: { gmaps?: string };
  roads: RawRoad[];
  score: Record<Dimension | 'total', number>; // 0-100
  start: { label?: string; lat: number; lon: number };
  distance_km?: Record<string, number>; // straight-line per home; absent in the NL circuit export
  stops: { type: string; note: string; lat: number; lon: number }[];
  why: string[];
  windows: string[];
}

export interface RawSprint extends RawDetail {
  id: string;
  name: string;
  km: number;
  fun: number; // 0-1
  fun_km: number;
  drive_min?: number; // modeled duration, not time to reach the sprint
  distance_km: Record<Home, number>;
  start: { lat: number; lon: number };
  end: { lat: number; lon: number };
  line: LonLat[];
  return: string;
  roads: RawRoad[];
  score: Record<Dimension, number>; // 0-1
  traits: string[];
  windows: string[];
}

export interface RawArea {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface RawTopRoad {
  name: string;
  fun: number;
  line: LonLat[];
  windows: string[];
}

export interface RoutesDoc {
  meta: { generated?: string; title?: string; tagline?: string; windows?: string; country?: string; schema_version?: number };
  home?: { lat: number; lon: number; name: string };
  routes: RawCircuit[];
  sprints: RawSprint[];
  areas: RawArea[];
  toproads: RawTopRoad[];
}

export interface RawRide extends RawDetail {
  id: string;
  type: 'open' | 'circuit';
  area: number; // local cluster id, not a place
  name: string;
  km: number;
  fun_km: number;
  connector_share: number;
  /** Share driven twice in opposite directions, on the same road or its other carriageway. */
  retrace_share?: number;
  drive_min: number;
  distance_km: Record<Home, number>;
  line: LonLat[];
  roads: RawRoad[];
  anchor_roads?: string[]; // mined high-fun stretches in driving order, not connectors
  score: Record<Dimension | 'total', number>; // 0-100
  windows: string[];
}

export type LinkedProfile = 'scenic' | 'technical' | 'quiet';

export interface LinkedDoc {
  meta: { generated?: string; note?: string; country?: string; schema_version?: number };
  rides: RawRide[];
  profiles: Partial<Record<LinkedProfile, string[]>>;
  nearby_100km: Partial<Record<Home, Partial<Record<LinkedProfile, string[]>>>>;
}
