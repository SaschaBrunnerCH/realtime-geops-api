// GeoJSON types for geOps API responses

export interface GeoJSONLineString {
  type: 'LineString';
  coordinates: [number, number][]; // Array of [x, y] in EPSG:3857
}

// [timestamp_ms, fraction_along_line (0-1), rotation_radians]
export type TimeInterval = [number, number, number];

export interface TrajectoryProperties {
  train_id: string;
  line?: {
    id: number;
    name: string;
    color?: string;
  };
  type?: string; // Vehicle type (e.g., 'rail', 'tram', 'bus')
  time_intervals: TimeInterval[];
  delay?: number;
  state?: string;
  destination?: string;
}

export interface TrajectoryFeature {
  type: 'Feature';
  geometry: GeoJSONLineString;
  properties: TrajectoryProperties;
}

// Vehicle state from realtime API
export type VehicleState = 'DRIVING' | 'BOARDING' | 'JOURNEY_CANCELLED';

// Simplified vehicle representation for our application
export interface Vehicle {
  id: string;
  x: number; // coordinate in EPSG:3857
  y: number;
  rotation: number; // in radians
  lineName?: string;
  lineColor?: string;
  destination?: string;
  delay?: number;
  type?: string;
  state?: VehicleState;
}

// BBox type
export interface BBox {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

// Default bounding box (Switzerland in EPSG:3857)
// Approximate bounds: 5.9°E to 10.5°E, 45.8°N to 47.8°N
const DEFAULT_BBOX: BBox = {
  left: 657000,
  bottom: 5751000,
  right: 1168000,
  top: 6076000,
};

// Parse bbox from string format "left,bottom,right,top"
function parseBBox(bboxString: string | null | undefined): BBox | null {
  if (!bboxString) return null;
  const parts = bboxString.split(',').map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return null;
  return {
    left: parts[0],
    bottom: parts[1],
    right: parts[2],
    top: parts[3],
  };
}

// Get bbox from query string or env var, fallback to default
function getBBox(): BBox {
  const urlParams = new URLSearchParams(window.location.search);
  const queryBBox = parseBBox(urlParams.get('bbox'));
  if (queryBBox) return queryBBox;

  const envBBox = parseBBox(import.meta.env.VITE_BBOX);
  if (envBBox) return envBBox;

  return DEFAULT_BBOX;
}

// API config
export const GEOPS_CONFIG = {
  API_KEY: import.meta.env.VITE_GEOPS_API_KEY || '',
  REST_BASE_URL: 'https://api.geops.io/tracker/v1',
  WEBSOCKET_URL: 'wss://api.geops.io/tracker-ws/v1/ws',
  BBOX: getBBox(),
};

// Long-distance train prefixes (single source of truth)
export const LONG_DISTANCE_PREFIXES = ['IC', 'ICE', 'EC', 'TGV', 'RJX', 'NJ', 'EN', 'IR'] as const;

// Utility to check if a line name corresponds to a long-distance train
export function isLongDistanceTrain(lineName: string | undefined): boolean {
  if (!lineName) return false;
  const upperName = lineName.toUpperCase();
  return LONG_DISTANCE_PREFIXES.some((prefix) => upperName.startsWith(prefix));
}
