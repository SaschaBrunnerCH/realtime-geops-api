import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import SpatialReference from "@arcgis/core/geometry/SpatialReference";
import * as projectOperator from "@arcgis/core/geometry/operators/projectOperator";
import UniqueValueRenderer from "@arcgis/core/renderers/UniqueValueRenderer";
import PointSymbol3D from "@arcgis/core/symbols/PointSymbol3D";
import IconSymbol3DLayer from "@arcgis/core/symbols/IconSymbol3DLayer";
import { Vehicle, VehicleState } from "../types/geops";

// Visualization mode type
type VisualizationMode = "elevated" | "3d";

// Current visualization mode
let currentMode: VisualizationMode = "elevated";

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

// Initialize projection at module load
ensureProjectionLoaded();

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
const SBB_RED = "#e2231a";

// Store object IDs by vehicle ID for efficient updates
const vehicleObjectIds = new Map<string, number>();
let nextObjectId = 1;

// Track which symbol combinations have been added to renderer
const addedSymbolKeys = new Set<string>();

// Reference to the renderer for dynamic symbol updates
let vehicleRenderer: UniqueValueRenderer | null = null;

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

// Area thresholds for icon display
const AREA_THRESHOLDS = {
  HIDE_LINE_NUMBERS: 50000,  // km² - hide line numbers when very zoomed out
  FULL_SIZE: 2000,           // km² - full icon size at or below
  MIN_SIZE: 100000,          // km² - minimum icon size at or above
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
  bgColor: string = "#22c55e",
  size: number = ICON_CONFIG.DEFAULT_SIZE,
  vehicleType: string = "",
  showText: boolean = true,
  shape: IconShape = 'circle'
): string {
  // Rail and tram get the outer gray ring/border
  const hasOuterBorder = vehicleType === "rail" || vehicleType === "tram";
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
  if (delay < 60000) return "#22c55e"; // green (< 1 min)
  if (delay < 300000) return "#f59e0b"; // orange (1-5 min)
  return "#ef4444"; // red (>= 5 min)
}

// Get delay category for renderer (reduces unique combinations)
function getDelayCategory(delay: number): string {
  if (delay < 60000) return "on-time";      // green (< 1 min)
  if (delay < 300000) return "delayed";     // orange (1-5 min)
  return "very-delayed";                     // red (>= 5 min)
}

// Get current scale key for renderer (changes when zoom level changes significantly)
function getScaleKey(): string {
  const showText = shouldShowLineNumber();
  // Round scale factor to avoid too many variations
  const roundedScale = Math.round(currentScaleFactor * 10) / 10;
  return `${roundedScale}-${showText}`;
}

// Create renderer key from vehicle properties
function getRendererKey(type: string, lineName: string, delayCategory: string, state: string): string {
  return `${type}|${lineName}|${delayCategory}|${state}|${getScaleKey()}`;
}

// Ensure symbol exists in renderer, add if not
function ensureSymbolInRenderer(
  type: string,
  lineName: string,
  delay: number,
  state: VehicleState
): void {
  if (!vehicleRenderer) return;

  const delayCategory = getDelayCategory(delay);
  const stateStr = state || "DRIVING";
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

// Create a FeatureLayer for vehicles
export function createVehicleLayer(): FeatureLayer {
  // Create renderer with dynamic unique values
  const defaultSymbol = new PointSymbol3D({
    symbolLayers: [
      new IconSymbol3DLayer({
        resource: { primitive: "circle" },
        material: { color: [128, 128, 128] },
        size: 12,
      }),
    ],
  });

  vehicleRenderer = new UniqueValueRenderer({
    field: "symbolKey",
    defaultSymbol: defaultSymbol,
    uniqueValueInfos: [],
  });

  const layer = new FeatureLayer({
    id: "vehicles",
    title: "Vehicles",
    source: [],
    objectIdField: "OBJECTID",
    geometryType: "point",
    hasZ: true,
    spatialReference: targetSpatialReference,
    elevationInfo: {
      mode: "relative-to-ground",
    },
    fields: [
      { name: "OBJECTID", alias: "Object ID", type: "oid" },
      { name: "vehicleId", alias: "Vehicle ID", type: "string" },
      { name: "lineName", alias: "Line Name", type: "string" },
      { name: "destination", alias: "Destination", type: "string" },
      { name: "delay", alias: "Delay", type: "integer" },
      { name: "type", alias: "Vehicle Type", type: "string" },
      { name: "state", alias: "State", type: "string" },
      { name: "lineColor", alias: "Line Color", type: "string" },
      { name: "symbolKey", alias: "Symbol Key", type: "string" },
    ],
    outFields: ["*"], // Include all fields in queries/hitTest
    renderer: vehicleRenderer,
  });

  return layer;
}

// Create symbol for a vehicle based on current mode and state
function createVehicleSymbol(lineName: string, delay: number, rotation: number, type?: string, state?: VehicleState): __esri.Symbol {
  const delayColor = getDelayColor(delay);
  const iconSize = getIconSize(type);
  const showText = shouldShowLineNumber();
  // Use square shape for BOARDING, circle for DRIVING (default)
  const shape: IconShape = state === "BOARDING" ? "square" : "circle";
  const iconUrl = createLineNameSvg(lineName, delayColor, iconSize * 4, type || "", showText, shape); // Quadruple size for better resolution

  if (currentMode === "3d") {
    return {
      type: "point-3d",
      symbolLayers: [
        {
          type: "object",
          resource: { primitive: state === "BOARDING" ? "cube" : "cone" },
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
    type: "point-3d",
    symbolLayers: [
      {
        type: "icon",
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
      type: "line",
      color: [150, 150, 150],
      size: 1,
      border: { color: [255, 255, 255, 0.7] },
    },
  } as unknown as __esri.Symbol;
}

// Get icon size based on vehicle type and current scale factor
function getIconSize(type?: string): number {
  const { BASE_SIZES, MIN_SIZE } = ICON_CONFIG;
  const baseSize = type === "rail" ? BASE_SIZES.rail : BASE_SIZES.bus;
  return Math.max(MIN_SIZE, Math.round(baseSize * currentScaleFactor));
}

// Store reference to the layer for refresh
let currentVehicleLayer: FeatureLayer | null = null;

// Store last known vehicle data for refresh
let lastVehicleData: Vehicle[] = [];

// Debounce timer for symbol refresh
let refreshDebounceTimer: number | null = null;
const REFRESH_DEBOUNCE_MS = 300;

// Set the scale factor for icons based on extent size
// areaKm2: the visible area in km²
export function setIconScaleFactor(areaKm2: number): void {
  const previousScaleKey = getScaleKey();

  currentAreaKm2 = areaKm2;

  // Scale down icons as area increases (linear interpolation)
  const { FULL_SIZE, MIN_SIZE } = AREA_THRESHOLDS;
  if (areaKm2 <= FULL_SIZE) {
    currentScaleFactor = 1.0;
  } else if (areaKm2 >= MIN_SIZE) {
    currentScaleFactor = 0.25;
  } else {
    const t = (areaKm2 - FULL_SIZE) / (MIN_SIZE - FULL_SIZE);
    currentScaleFactor = 1.0 - (t * 0.75); // 1.0 to 0.25
  }

  // If scale key changed, debounce refresh to avoid blocking during zoom
  const newScaleKey = getScaleKey();
  if (previousScaleKey !== newScaleKey && currentVehicleLayer && lastVehicleData.length > 0) {
    if (refreshDebounceTimer !== null) {
      clearTimeout(refreshDebounceTimer);
    }
    refreshDebounceTimer = window.setTimeout(() => {
      refreshDebounceTimer = null;
      refreshVehicleSymbols();
    }, REFRESH_DEBOUNCE_MS);
  }
}

// Refresh all vehicle symbols with current scale
function refreshVehicleSymbols(): void {
  if (!currentVehicleLayer || !projectionLoaded || lastVehicleData.length === 0) return;

  const updateFeatures: Graphic[] = [];

  for (const vehicle of lastVehicleData) {
    const objectId = vehicleObjectIds.get(vehicle.id);
    if (objectId === undefined) continue;

    const lineName = vehicle.lineName || "?";
    const delay = vehicle.delay || 0;
    const type = vehicle.type || "";
    const state = vehicle.state || "DRIVING";

    // Ensure symbol exists in renderer for this combination with new scale
    ensureSymbolInRenderer(type, lineName, delay, state as VehicleState);

    // Create new symbol key with current scale
    const delayCategory = getDelayCategory(delay);
    const symbolKey = getRendererKey(type, lineName, delayCategory, state);

    // Project from Web Mercator (3857) to target spatial reference
    const projectedPoint = projectToTarget(vehicle.x, vehicle.y, 0);

    const graphic = new Graphic({
      geometry: new Point({
        x: projectedPoint.x,
        y: projectedPoint.y,
        z: projectedPoint.z,
        spatialReference: targetSpatialReference,
      }),
      attributes: {
        OBJECTID: objectId,
        vehicleId: vehicle.id,
        lineName: lineName,
        destination: vehicle.destination || "",
        delay: delay,
        type: type,
        state: state,
        lineColor: vehicle.lineColor || SBB_RED,
        symbolKey: symbolKey,
      },
    });
    updateFeatures.push(graphic);
  }

  if (updateFeatures.length > 0) {
    currentVehicleLayer.applyEdits({
      updateFeatures,
    });
  }
}

// Check if line numbers should be shown (hidden when very zoomed out)
function shouldShowLineNumber(): boolean {
  return currentAreaKm2 < AREA_THRESHOLDS.HIDE_LINE_NUMBERS;
}

// Update vehicles on the layer
export function updateVehicles(
  layer: FeatureLayer,
  vehicles: Vehicle[]
): void {
  // Skip if projection not loaded yet
  if (!projectionLoaded) return;

  // Store references for refresh
  currentVehicleLayer = layer;
  lastVehicleData = vehicles;

  // Track which vehicle IDs are in this update
  const currentIds = new Set<string>();

  // Collect edits
  const addFeatures: Graphic[] = [];
  const updateFeatures: Graphic[] = [];
  const deleteFeatures: { objectId: number }[] = [];

  for (const vehicle of vehicles) {
    currentIds.add(vehicle.id);

    // Project from Web Mercator (3857) to target spatial reference
    const projectedPoint = projectToTarget(vehicle.x, vehicle.y, 0);

    const lineName = vehicle.lineName || "?";
    const delay = vehicle.delay || 0;
    const type = vehicle.type || "";
    const state = vehicle.state || "DRIVING";

    // Ensure symbol exists in renderer for this combination
    ensureSymbolInRenderer(type, lineName, delay, state as VehicleState);

    // Create symbol key for renderer lookup
    const delayCategory = getDelayCategory(delay);
    const symbolKey = getRendererKey(type, lineName, delayCategory, state);

    const geometry = new Point({
      x: projectedPoint.x,
      y: projectedPoint.y,
      z: projectedPoint.z,
      spatialReference: targetSpatialReference,
    });

    const attributes = {
      vehicleId: vehicle.id,
      lineName: lineName,
      destination: vehicle.destination || "",
      delay: delay,
      type: type,
      state: state,
      lineColor: vehicle.lineColor || SBB_RED,
      symbolKey: symbolKey,
    };

    const existingObjectId = vehicleObjectIds.get(vehicle.id);

    if (existingObjectId !== undefined) {
      // Update existing feature
      const graphic = new Graphic({
        geometry,
        attributes: { ...attributes, OBJECTID: existingObjectId },
      });
      updateFeatures.push(graphic);
    } else {
      // Create new feature
      const objectId = nextObjectId++;
      vehicleObjectIds.set(vehicle.id, objectId);

      const graphic = new Graphic({
        geometry,
        attributes: { ...attributes, OBJECTID: objectId },
      });
      addFeatures.push(graphic);
    }
  }

  // Find vehicles to delete
  for (const [vehicleId, objectId] of vehicleObjectIds) {
    if (!currentIds.has(vehicleId)) {
      deleteFeatures.push({ objectId });
      vehicleObjectIds.delete(vehicleId);
    }
  }

  // Apply all edits in a single batch
  if (addFeatures.length > 0 || updateFeatures.length > 0 || deleteFeatures.length > 0) {
    layer.applyEdits({
      addFeatures,
      updateFeatures,
      deleteFeatures,
    });
  }
}

// Remove a single vehicle by ID
export function removeVehicle(layer: FeatureLayer, vehicleId: string): void {
  const objectId = vehicleObjectIds.get(vehicleId);
  if (objectId !== undefined) {
    layer.applyEdits({
      deleteFeatures: [{ objectId }],
    });
    vehicleObjectIds.delete(vehicleId);
  }
}
