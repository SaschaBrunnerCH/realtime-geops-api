import * as projectOperator from '@arcgis/core/geometry/operators/projectOperator';
import Point from '@arcgis/core/geometry/Point';
import Polyline from '@arcgis/core/geometry/Polyline';
import SpatialReference from '@arcgis/core/geometry/SpatialReference';
import Graphic from '@arcgis/core/Graphic';
import FeatureLayer from '@arcgis/core/layers/FeatureLayer';
import UniqueValueRenderer from '@arcgis/core/renderers/UniqueValueRenderer';
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol';

// Spatial references
const WEB_MERCATOR = new SpatialReference({ wkid: 3857 });
let targetSpatialReference: SpatialReference = new SpatialReference({ wkid: 3857 }); // Default to Web Mercator

// Set the target spatial reference (called from main.ts when scene is ready)
export function setTargetSpatialReference(sr: SpatialReference): void {
  targetSpatialReference = sr;
}

// Store trajectories
interface TrajectoryData {
  coords: [number, number][];
  type?: string;
}

const trajectories = new Map<string, TrajectoryData>();
const trajectoryObjectIds = new Map<string, number>(); // Map vehicleId to objectId
let nextObjectId = 1;
let trajectoryLayer: FeatureLayer | null = null;

// Load projection operator
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

// Project coordinates from Web Mercator to target spatial reference
function projectCoordsToTarget(coords: [number, number][]): number[][] {
  return coords.map(([x, y]) => {
    const sourcePoint = new Point({
      x,
      y,
      spatialReference: WEB_MERCATOR,
    });
    const projected = projectOperator.execute(sourcePoint, targetSpatialReference) as Point;
    return [projected.x, projected.y];
  });
}

// Create the trajectory layer
export function createTrajectoryLayer(): FeatureLayer {
  const layer = new FeatureLayer({
    id: 'trajectories',
    title: 'Vehicle Trajectories',
    source: [], // Empty source, features added via applyEdits
    objectIdField: 'OBJECTID',
    geometryType: 'polyline',
    spatialReference: targetSpatialReference,
    fields: [
      {
        name: 'OBJECTID',
        alias: 'Object ID',
        type: 'oid',
      },
      {
        name: 'vehicleId',
        alias: 'Vehicle ID',
        type: 'string',
      },
      {
        name: 'type',
        alias: 'Vehicle Type',
        type: 'string',
      },
    ],
    renderer: new UniqueValueRenderer({
      field: 'type',
      defaultSymbol: new SimpleLineSymbol({
        color: [128, 128, 128, 0.6],
        width: 2,
        style: 'solid',
      }),
      uniqueValueInfos: [
        {
          value: 'rail',
          symbol: new SimpleLineSymbol({
            color: [59, 130, 246, 0.6], // blue
            width: 3,
            style: 'solid',
          }),
        },
        {
          value: 'bus',
          symbol: new SimpleLineSymbol({
            color: [34, 197, 94, 0.6], // green
            width: 2,
            style: 'solid',
          }),
        },
        {
          value: 'tram',
          symbol: new SimpleLineSymbol({
            color: [168, 85, 247, 0.6], // purple
            width: 2,
            style: 'solid',
          }),
        },
      ],
    }),
  });

  trajectoryLayer = layer;
  return layer;
}

// Update a single trajectory
export function updateTrajectory(vehicleId: string, coords: [number, number][], type?: string): void {
  trajectories.set(vehicleId, { coords, type });
}

// Remove a trajectory
export function removeTrajectory(vehicleId: string): void {
  trajectories.delete(vehicleId);

  // Remove associated feature via applyEdits
  const objectId = trajectoryObjectIds.get(vehicleId);
  if (objectId !== undefined && trajectoryLayer) {
    void trajectoryLayer.applyEdits({
      deleteFeatures: [{ objectId }],
    });
    trajectoryObjectIds.delete(vehicleId);
  }
}

// Refresh all trajectory graphics on the layer
export function refreshTrajectories(): void {
  if (!trajectoryLayer || !projectionLoaded) return;

  // Track which vehicle IDs should have trajectories
  const currentVehicleIds = new Set(trajectories.keys());

  // Collect edits
  const addFeatures: Graphic[] = [];
  const updateFeatures: Graphic[] = [];
  const deleteFeatures: { objectId: number }[] = [];

  // Remove features for vehicles that no longer have trajectories
  for (const [vehicleId, objectId] of trajectoryObjectIds) {
    if (!currentVehicleIds.has(vehicleId)) {
      deleteFeatures.push({ objectId });
      trajectoryObjectIds.delete(vehicleId);
    }
  }

  // Update or create features for current trajectories
  for (const [vehicleId, data] of trajectories) {
    if (data.coords.length < 2) continue;

    // Project coordinates to target spatial reference
    const projectedCoords = projectCoordsToTarget(data.coords);

    const polyline = new Polyline({
      paths: [projectedCoords],
      spatialReference: targetSpatialReference,
    });

    const existingObjectId = trajectoryObjectIds.get(vehicleId);

    if (existingObjectId !== undefined) {
      // Update existing feature
      const graphic = new Graphic({
        geometry: polyline,
        attributes: {
          OBJECTID: existingObjectId,
          vehicleId: vehicleId,
          type: data.type,
        },
      });
      updateFeatures.push(graphic);
    } else {
      // Create new feature
      const objectId = nextObjectId++;
      trajectoryObjectIds.set(vehicleId, objectId);

      const graphic = new Graphic({
        geometry: polyline,
        attributes: {
          OBJECTID: objectId,
          vehicleId: vehicleId,
          type: data.type,
        },
      });
      addFeatures.push(graphic);
    }
  }

  // Apply all edits in a single batch
  if (addFeatures.length > 0 || updateFeatures.length > 0 || deleteFeatures.length > 0) {
    void trajectoryLayer.applyEdits({
      addFeatures,
      updateFeatures,
      deleteFeatures,
    });
  }
}
