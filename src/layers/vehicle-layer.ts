import * as projectOperator from '@arcgis/core/geometry/operators/projectOperator';
import Point from '@arcgis/core/geometry/Point';
import SpatialReference from '@arcgis/core/geometry/SpatialReference';
import StreamLayer from '@arcgis/core/layers/StreamLayer';
import UniqueValueRenderer from '@arcgis/core/renderers/UniqueValueRenderer';
import IconSymbol3DLayer from '@arcgis/core/symbols/IconSymbol3DLayer';
import PointSymbol3D from '@arcgis/core/symbols/PointSymbol3D';

import type { Vehicle, VehicleState } from '../types/geops';

// Visualization mode type
type VisualizationMode = 'elevated' | '3d';

// Current visualization mode
const currentMode: VisualizationMode = 'elevated';

// Current scale factor for icons (1.0 = default size, smaller = smaller icons)
let currentScaleFactor: number = 1.0;

// Current extent area in km² (used to determine if line numbers should be shown)
let currentAreaKm2: number = 0;

// Spatial references
const WEB_MERCATOR = new SpatialReference({ wkid: 3857 });
let targetSpatialReference: SpatialReference = new SpatialReference({ wkid: 3857 }); // Default to Web Mercator

// Set the target spatial reference (called from main.ts when scene is ready)
export function setTargetSpatialReference(sr: SpatialReference): void {
  targetSpatialReference = sr;
}

// Load the project operator
let projectionLoaded = false;
let projectionLoading: Promise<void> | null = null;

async function ensureProjectionLoaded(): Promise<void> {
  if (projectionLoaded) return;
  if (!projectionLoading) {
    projectionLoading = projectOperator.load().then(() => {
      projectionLoaded = true;
    });
  }
  await projectionLoading;
}

// Initialize projection at module load (fire-and-forget)
void ensureProjectionLoaded();

// Project a point from Web Mercator to target spatial reference
function projectToTarget(x: number, y: number, z: number): Point {
  const sourcePoint = new Point({
    x,
    y,
    z,
    spatialReference: WEB_MERCATOR,
  });
  return projectOperator.execute(sourcePoint, targetSpatialReference) as Point;
}

// Default colors
const SBB_RED = '#e2231a';

// StreamLayer ID system:
// - TRACKID: Stable ID per vehicle, used by StreamLayer to group observations
// - OBJECTID: Unique per message, must increment for StreamLayer to process updates
const vehicleTrackIds = new Map<string, number>();
let nextTrackId = 1;
let objectIdCounter = 1;

// Get next OBJECTID with overflow protection (resets at 1 billion)
// Safe because old features are purged via maxObservations and ageReceived
function getNextObjectId(): number {
  if (objectIdCounter >= 1_000_000_000) {
    objectIdCounter = 1;
  }
  return objectIdCounter++;
}

// Track which symbol combinations have been added to renderer
const addedSymbolKeys = new Set<string>();

// Reference to the renderer for dynamic symbol updates
let vehicleRenderer: UniqueValueRenderer | null = null;

// Reference to the stream layer
let streamLayer: StreamLayer | null = null;

// Shape types for vehicle icons
type IconShape = 'circle' | 'square';

// Icon configuration
const ICON_CONFIG = {
  MAX_CACHE_SIZE: 500,
  DEFAULT_SIZE: 64,
  BASE_SIZES: { rail: 38, bus: 19 },
  MIN_SIZE: 8,
  FONT_SIZE_RATIOS: [0.45, 0.38, 0.32, 0.28, 0.24],
  TEXT_LENGTH_THRESHOLDS: [2, 3, 4, 5],
};

// Area thresholds for scale-based decluttering (3 discrete steps)
export const AREA_THRESHOLDS = {
  MEDIUM: 10000, // km² - below: detailed (all vehicles, 100% icons), above: reduced (trains only, 60% icons)
  SMALL: 50000, // km² - above: minimal (long-distance only, 30% icons, no line numbers)
};

// Cache for SVG icons by line name (with max size to prevent memory leak)
const svgIconCache = new Map<string, string>();

// Calculate font size based on text length
function calculateFontSize(textLength: number, size: number): number {
  const { FONT_SIZE_RATIOS, TEXT_LENGTH_THRESHOLDS } = ICON_CONFIG;
  for (let i = 0; i < TEXT_LENGTH_THRESHOLDS.length; i++) {
    if (textLength <= TEXT_LENGTH_THRESHOLDS[i]) {
      return size * FONT_SIZE_RATIOS[i];
    }
  }
  return size * FONT_SIZE_RATIOS[FONT_SIZE_RATIOS.length - 1];
}

// Generate SVG icon with line name text
function createLineNameSvg(
  lineName: string,
  bgColor: string = '#22c55e',
  size: number = ICON_CONFIG.DEFAULT_SIZE,
  vehicleType: string = '',
  showText: boolean = true,
  shape: IconShape = 'circle',
): string {
  // Rail and tram get the outer gray ring/border
  const hasOuterBorder = vehicleType === 'rail' || vehicleType === 'tram';
  const cacheKey = `${lineName}-${bgColor}-${size}-${vehicleType}-${showText}-${shape}`;
  if (svgIconCache.has(cacheKey)) {
    return svgIconCache.get(cacheKey)!;
  }

  // Prevent unbounded cache growth by clearing oldest entries when limit is reached
  if (svgIconCache.size >= ICON_CONFIG.MAX_CACHE_SIZE) {
    const firstKey = svgIconCache.keys().next().value;
    if (firstKey) {
      svgIconCache.delete(firstKey);
    }
  }

  const fontSize = calculateFontSize(lineName.length, size);
  const center = size / 2;
  let outerShape = '';
  let innerShape = '';

  if (shape === 'square') {
    // Square shape (for BOARDING vehicles) - 10% smaller than circle
    const outerSize = (hasOuterBorder ? size / 2 - 6 : size / 2 - 2) * 0.9;
    const innerSize = (hasOuterBorder ? size / 2 - 12 : size / 2 - 4) * 0.9;

    // Outer gray border for rail and tram
    if (hasOuterBorder) {
      outerShape = `<rect x="${center - outerSize}" y="${center - outerSize}"
        width="${outerSize * 2}" height="${outerSize * 2}"
        fill="none" stroke="#6b7280" stroke-width="6" rx="3"/>`;
    }

    // Inner filled square
    innerShape = `<rect x="${center - innerSize}" y="${center - innerSize}"
      width="${innerSize * 2}" height="${innerSize * 2}"
      fill="${bgColor}" stroke="white" stroke-width="2" rx="2"/>`;
  } else {
    // Circle shape (existing behavior)
    const innerRadius = hasOuterBorder ? size / 2 - 10 : size / 2 - 2;

    // For rail and tram vehicles, add an outer gray ring
    if (hasOuterBorder) {
      outerShape = `<circle cx="${center}" cy="${center}" r="${size / 2 - 4}" fill="none" stroke="#6b7280" stroke-width="8"/>`;
    }

    innerShape = `<circle cx="${center}" cy="${center}" r="${innerRadius}" fill="${bgColor}" stroke="white" stroke-width="3"/>`;
  }

  // Only show text if showText is true
  const textElement = showText
    ? `<text x="${center}" y="${center}" text-anchor="middle" dominant-baseline="central"
          font-family="Arial, sans-serif" font-size="${fontSize}px" font-weight="bold" fill="white">
      ${escapeXml(lineName)}
    </text>`
    : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${outerShape}
    ${innerShape}
    ${textElement}
  </svg>`;

  const dataUrl = `data:image/svg+xml;base64,${btoa(svg)}`;
  svgIconCache.set(cacheKey, dataUrl);
  return dataUrl;
}

// Escape XML special characters
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Get delay color based on delay value in milliseconds
function getDelayColor(delay: number): string {
  if (delay < 60000) return '#22c55e'; // green (< 1 min)
  if (delay < 300000) return '#f59e0b'; // orange (1-5 min)
  return '#ef4444'; // red (>= 5 min)
}

// Get delay category for renderer (reduces unique combinations)
function getDelayCategory(delay: number): string {
  if (delay < 60000) return 'on-time'; // green (< 1 min)
  if (delay < 300000) return 'delayed'; // orange (1-5 min)
  return 'very-delayed'; // red (>= 5 min)
}

// Get current scale key for renderer (combines scale factor and text visibility)
function getScaleKey(): string {
  const showText = shouldShowLineNumber();
  return `${currentScaleFactor}-${showText}`;
}

// Create renderer key from vehicle properties
function getRendererKey(type: string, lineName: string, delayCategory: string, state: string): string {
  return `${type}|${lineName}|${delayCategory}|${state}|${getScaleKey()}`;
}

// Ensure symbol exists in renderer, add if not
function ensureSymbolInRenderer(type: string, lineName: string, delay: number, state: VehicleState): void {
  if (!vehicleRenderer) return;

  const delayCategory = getDelayCategory(delay);
  const stateStr = state || 'DRIVING';
  const key = getRendererKey(type, lineName, delayCategory, stateStr);

  if (addedSymbolKeys.has(key)) return;

  // Create symbol for this combination
  const symbol = createVehicleSymbol(lineName, delay, 0, type, state);

  vehicleRenderer.addUniqueValueInfo({
    value: key,
    symbol: symbol,
  });

  addedSymbolKeys.add(key);
}

// Create a StreamLayer for vehicles
export function createVehicleLayer(): StreamLayer {
  // Create renderer with dynamic unique values
  const defaultSymbol = new PointSymbol3D({
    symbolLayers: [
      new IconSymbol3DLayer({
        resource: { primitive: 'circle' },
        material: { color: [128, 128, 128] },
        size: 12,
      }),
    ],
  });

  vehicleRenderer = new UniqueValueRenderer({
    field: 'symbolKey',
    defaultSymbol: defaultSymbol,
    uniqueValueInfos: [],
  });

  streamLayer = new StreamLayer({
    id: 'vehicles',
    title: 'Vehicles',
    objectIdField: 'OBJECTID',
    geometryType: 'point',
    spatialReference: targetSpatialReference,
    timeInfo: {
      trackIdField: 'TRACKID',
    },
    updateInterval: 50,
    purgeOptions: {
      displayCount: 10000,
      maxObservations: 1, // Only keep latest position per track
      ageReceived: 1, // Remove features not updated in 1 minute (fallback cleanup)
    },
    fields: [
      { name: 'OBJECTID', alias: 'Object ID', type: 'oid' },
      { name: 'TRACKID', alias: 'Track ID', type: 'long' },
      { name: 'vehicleId', alias: 'Vehicle ID', type: 'string' },
      { name: 'lineName', alias: 'Line Name', type: 'string' },
      { name: 'destination', alias: 'Destination', type: 'string' },
      { name: 'delay', alias: 'Delay', type: 'integer' },
      { name: 'type', alias: 'Vehicle Type', type: 'string' },
      { name: 'state', alias: 'State', type: 'string' },
      { name: 'lineColor', alias: 'Line Color', type: 'string' },
      { name: 'symbolKey', alias: 'Symbol Key', type: 'string' },
    ],
    elevationInfo: {
      mode: 'relative-to-ground',
    },
    renderer: vehicleRenderer,
  });

  return streamLayer;
}

// Create symbol for a vehicle based on current mode and state
function createVehicleSymbol(
  lineName: string,
  delay: number,
  rotation: number,
  type?: string,
  state?: VehicleState,
): __esri.Symbol {
  const delayColor = getDelayColor(delay);
  const iconSize = getIconSize(type);
  const showText = shouldShowLineNumber();
  // Use square shape for BOARDING, circle for DRIVING (default)
  const shape: IconShape = state === 'BOARDING' ? 'square' : 'circle';
  const iconUrl = createLineNameSvg(lineName, delayColor, iconSize * 4, type || '', showText, shape); // Quadruple size for better resolution

  if (currentMode === '3d') {
    return {
      type: 'point-3d',
      symbolLayers: [
        {
          type: 'object',
          resource: { primitive: state === 'BOARDING' ? 'cube' : 'cone' },
          material: { color: delayColor },
          height: iconSize * 6,
          width: iconSize * 3,
          depth: iconSize * 3,
          heading: rotation,
        },
      ],
    } as unknown as __esri.Symbol;
  }

  // Elevated mode (default) - SVG icon with line name
  return {
    type: 'point-3d',
    symbolLayers: [
      {
        type: 'icon',
        resource: { href: iconUrl },
        size: iconSize,
      },
    ],
    verticalOffset: {
      screenLength: 20,
      maxWorldLength: 250,
      minWorldLength: 50,
    },
    callout: {
      type: 'line',
      color: [150, 150, 150],
      size: 1,
      border: { color: [255, 255, 255, 0.7] },
    },
  } as unknown as __esri.Symbol;
}

// Get icon size based on vehicle type and current scale factor
function getIconSize(type?: string): number {
  const { BASE_SIZES, MIN_SIZE } = ICON_CONFIG;
  const baseSize = type === 'rail' ? BASE_SIZES.rail : BASE_SIZES.bus;
  return Math.max(MIN_SIZE, Math.round(baseSize * currentScaleFactor));
}

// Set the scale factor for icons based on extent size
// Uses 3 discrete steps to limit icon variations
// The animation loop applies changes automatically via symbolKey
export function setIconScaleFactor(areaKm2: number): void {
  currentAreaKm2 = areaKm2;

  // 3 discrete scale steps based on area
  const { MEDIUM, SMALL } = AREA_THRESHOLDS;
  if (areaKm2 < MEDIUM) {
    currentScaleFactor = 1.0;
  } else if (areaKm2 < SMALL) {
    currentScaleFactor = 0.6;
  } else {
    currentScaleFactor = 0.3;
  }
}

// Check if line numbers should be shown (hidden when very zoomed out)
function shouldShowLineNumber(): boolean {
  return currentAreaKm2 < AREA_THRESHOLDS.SMALL;
}

// Get or create a numeric TRACKID for a vehicle (stable across updates)
function getTrackId(vehicleId: string): number {
  let trackId = vehicleTrackIds.get(vehicleId);
  if (trackId === undefined) {
    trackId = nextTrackId++;
    vehicleTrackIds.set(vehicleId, trackId);
  }
  return trackId;
}

// Update vehicles on the StreamLayer via sendMessageToClient
// Each update requires a unique OBJECTID; TRACKID identifies the vehicle
export function updateVehicles(layer: StreamLayer, vehicles: Vehicle[]): void {
  // Skip if projection not loaded yet
  if (!projectionLoaded) return;

  // Track which vehicle IDs are in this update
  const currentIds = new Set<string>();

  // Build features for streaming
  const features: {
    attributes: Record<string, unknown>;
    geometry: { x: number; y: number; z: number };
  }[] = [];

  for (const vehicle of vehicles) {
    currentIds.add(vehicle.id);

    // Project from Web Mercator (3857) to target spatial reference
    const projectedPoint = projectToTarget(vehicle.x, vehicle.y, 0);

    const lineName = vehicle.lineName || '?';
    const delay = vehicle.delay || 0;
    const type = vehicle.type || '';
    const state = vehicle.state || 'DRIVING';

    // Ensure symbol exists in renderer for this combination
    ensureSymbolInRenderer(type, lineName, delay, state);

    // Create symbol key for renderer lookup
    const delayCategory = getDelayCategory(delay);
    const symbolKey = getRendererKey(type, lineName, delayCategory, state);

    // Get or create track ID for this vehicle
    const trackId = getTrackId(vehicle.id);

    features.push({
      attributes: {
        OBJECTID: getNextObjectId(),
        TRACKID: trackId,
        vehicleId: vehicle.id,
        lineName: lineName,
        destination: vehicle.destination || '',
        delay: delay,
        type: type,
        state: state,
        lineColor: vehicle.lineColor || SBB_RED,
        symbolKey: symbolKey,
      },
      geometry: {
        x: projectedPoint.x,
        y: projectedPoint.y,
        z: projectedPoint.z || 0,
      },
    });
  }

  // Find vehicles to delete (no longer in update)
  const deleteTrackIds: number[] = [];
  for (const [vehicleId, trackId] of vehicleTrackIds) {
    if (!currentIds.has(vehicleId)) {
      deleteTrackIds.push(trackId);
      vehicleTrackIds.delete(vehicleId);
    }
  }

  // Send updates to stream layer
  if (features.length > 0) {
    layer.sendMessageToClient({
      type: 'features',
      features: features,
    });
  }

  // Send deletions if any
  if (deleteTrackIds.length > 0) {
    layer.sendMessageToClient({
      type: 'delete',
      trackIds: deleteTrackIds,
    });
  }
}

// Remove a single vehicle by its TRACKID
export function removeVehicle(layer: StreamLayer, vehicleId: string): void {
  const trackId = vehicleTrackIds.get(vehicleId);
  if (trackId !== undefined) {
    layer.sendMessageToClient({
      type: 'delete',
      trackIds: [trackId],
    });
    vehicleTrackIds.delete(vehicleId);
  }
}
