import "./style.css";

// Import Calcite CSS
import "@esri/calcite-components/dist/calcite/calcite.css";

// Parse query string parameters for portal and webscene id
const urlParams = new URLSearchParams(window.location.search);
const queryPortal = urlParams.get("portal");
const queryWebsceneId = urlParams.get("webscene");

// Default values (can be overridden by env vars or query string)
const DEFAULT_PORTAL_URL = "https://www.arcgis.com";
const DEFAULT_WEBSCENE_ID = "7f6ae34b6cf749cd86de9df23421d701";

// Priority: query string > env var > default
const portalUrl =
  queryPortal || import.meta.env.VITE_PORTAL_URL || DEFAULT_PORTAL_URL;
const websceneId =
  queryWebsceneId || import.meta.env.VITE_WEBSCENE_ID || DEFAULT_WEBSCENE_ID;

// Configure ArcGIS assets, portal, and API key
import esriConfig from "@arcgis/core/config";
// Use CDN for ArcGIS assets in production, local node_modules in development
esriConfig.assetsPath = import.meta.env.DEV
  ? "./node_modules/@arcgis/core/assets"
  : "https://js.arcgis.com/4.34/@arcgis/core/assets";
esriConfig.portalUrl = portalUrl;
if (import.meta.env.VITE_ARCGIS_API_KEY) {
  esriConfig.apiKey = import.meta.env.VITE_ARCGIS_API_KEY;
}

// Import and configure Calcite components (v3.x uses CDN for assets by default)
import { setAssetPath } from "@esri/calcite-components/dist/components";
// Use CDN for assets (default in v3)
setAssetPath("https://js.arcgis.com/calcite-components/3.3.3/assets");

// Import Calcite components we'll use (v3 - no .js extension)
import "@esri/calcite-components/dist/components/calcite-shell";
import "@esri/calcite-components/dist/components/calcite-shell-panel";

// Import ArcGIS map components
import "@arcgis/map-components/dist/components/arcgis-scene";
import "@arcgis/map-components/dist/components/arcgis-zoom";
import "@arcgis/map-components/dist/components/arcgis-navigation-toggle";
import "@arcgis/map-components/dist/components/arcgis-compass";

// Import ArcGIS classes for scene configuration
import Camera from "@arcgis/core/Camera";
import Point from "@arcgis/core/geometry/Point";
import * as projectOperator from "@arcgis/core/geometry/operators/projectOperator";
import SpatialReference from "@arcgis/core/geometry/SpatialReference";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";

// Import our services and components
import { GeopsApiService } from "./services/geops-api";
import {
  createVehicleLayer,
  updateVehicles,
  removeVehicle,
  setTargetSpatialReference as setVehicleSpatialReference,
  setIconScaleFactor,
} from "./layers/vehicle-layer";
import {
  createTrajectoryLayer,
  updateTrajectory,
  removeTrajectory,
  refreshTrajectories,
  setTargetSpatialReference as setTrajectorySpatialReference,
} from "./layers/trajectory-layer";
import { StatusPanel } from "./components/status-panel";
import { VehiclePopup } from "./components/vehicle-popup";
// import { SearchPanel } from "./components/search-panel";
// import { AnimatedMarker } from "./components/animated-marker";

// Constants for extent-based filtering
const MAX_AREA_FOR_BUSES = 15000;
const MAX_AREA_FOR_ALL_TRAINS = 50000;
const TRAJECTORY_REFRESH_INTERVAL = 2000;

// Store interval ID for cleanup
let trajectoryRefreshInterval: number | null = null;

// Calculate extent area in km² from Web Mercator coordinates
function calculateExtentAreaKm2(
  xmin: number,
  ymin: number,
  xmax: number,
  ymax: number
): number {
  // Convert Web Mercator to approximate lat/lon for area calculation
  const metersToLat = (y: number) =>
    (Math.atan(Math.exp(y / 6378137)) * 2 - Math.PI / 2) * (180 / Math.PI);
  const lat1 = metersToLat(ymin);
  const lat2 = metersToLat(ymax);
  const avgLat = (lat1 + lat2) / 2;

  // Width in km (adjusted for latitude)
  const widthMeters = (xmax - xmin) * Math.cos((avgLat * Math.PI) / 180);
  const heightMeters = ymax - ymin;

  const widthKm = widthMeters / 1000;
  const heightKm = (heightMeters / 1000) * Math.cos((avgLat * Math.PI) / 180);

  return Math.abs(widthKm * heightKm);
}

// Ensure ground/terrain is present in the scene
async function ensureGroundTerrain(view: __esri.SceneView): Promise<void> {
  if (view.map && (!view.map.ground || view.map.ground.layers.length === 0)) {
    const { default: ElevationLayer } = await import(
      "@arcgis/core/layers/ElevationLayer"
    );
    view.map.ground.layers.add(
      new ElevationLayer({
        url: "https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer",
      })
    );
  }
}

// Set the initial camera position
function setInitialCamera(view: __esri.SceneView): void {
  const initialCamera = new Camera({
    position: new Point({
      x: 926334.160695936,
      y: 5953494.012044153,
      z: 3584.6630774475634,
      spatialReference: { wkid: 102100 },
    }),
    heading: 201.8507645974617,
    tilt: 37.17328109689199,
  });
  view.goTo(initialCamera, { duration: 0 }).catch(() => {
    // Ignore navigation errors on initial load
  });
}

// Initialize map layers
function initializeLayers(view: __esri.SceneView): {
  vehicleLayer: FeatureLayer;
  trajectoryLayer: FeatureLayer;
} {
  const trajectoryLayer = createTrajectoryLayer();
  const vehicleLayer = createVehicleLayer();
  // const searchMarker = new AnimatedMarker();

  if (view.map) {
    view.map.add(trajectoryLayer);
    view.map.add(vehicleLayer);
    // view.map.add(searchMarker.getLayer());
  }

  return { vehicleLayer, trajectoryLayer };
}

// Setup station search functionality (disabled for now)
// function setupSearch(
//   view: __esri.SceneView,
//   searchMarker: AnimatedMarker
// ): void {
//   const searchPanel = new SearchPanel("search-panel-container");
//   searchPanel.onSelect(async (lng, lat) => {
//     try {
//       await view.goTo({
//         center: [lng, lat],
//         zoom: 16,
//         tilt: 60,
//       });
//       await searchMarker.show(lng, lat);
//     } catch {
//       // Ignore navigation errors
//     }
//   });
//   searchPanel.onClear(() => {
//     searchMarker.hide();
//   });
// }

// Create bbox update handler
function createBBoxUpdater(
  view: __esri.SceneView,
  webMercator: SpatialReference,
  apiService: GeopsApiService,
  statusPanel: StatusPanel
): () => void {
  return () => {
    const extent = view.extent;
    if (!extent) return;

    const sr = extent.spatialReference;
    let wmExtent: {
      xmin: number;
      ymin: number;
      xmax: number;
      ymax: number;
    };

    if (sr && (sr.wkid === 102100 || sr.wkid === 3857)) {
      wmExtent = {
        xmin: extent.xmin,
        ymin: extent.ymin,
        xmax: extent.xmax,
        ymax: extent.ymax,
      };
    } else {
      const projectedExtent = projectOperator.execute(
        extent,
        webMercator
      ) as __esri.Extent;
      if (!projectedExtent) return;
      wmExtent = {
        xmin: projectedExtent.xmin,
        ymin: projectedExtent.ymin,
        xmax: projectedExtent.xmax,
        ymax: projectedExtent.ymax,
      };
    }

    const areaKm2 = calculateExtentAreaKm2(
      wmExtent.xmin,
      wmExtent.ymin,
      wmExtent.xmax,
      wmExtent.ymax
    );
    statusPanel.setExtentSize(areaKm2);
    setIconScaleFactor(areaKm2);

    // Filter transport modes based on extent size
    if (areaKm2 > MAX_AREA_FOR_ALL_TRAINS) {
      apiService.setTransportFilter(["rail"]);
      apiService.setLongDistanceOnly(true);
    } else if (areaKm2 > MAX_AREA_FOR_BUSES) {
      apiService.setTransportFilter(["rail"]);
      apiService.setLongDistanceOnly(false);
    } else {
      apiService.setTransportFilter(["rail", "bus", "tram"]);
      apiService.setLongDistanceOnly(false);
    }

    apiService.updateBBox(
      wmExtent.xmin,
      wmExtent.ymin,
      wmExtent.xmax,
      wmExtent.ymax
    );
  };
}

// Setup API service callbacks
function setupApiCallbacks(
  apiService: GeopsApiService,
  vehicleLayer: FeatureLayer,
  statusPanel: StatusPanel
): void {
  apiService.onUpdate((vehicles) => {
    updateVehicles(vehicleLayer, vehicles);
  });

  apiService.onDelete((vehicleId) => {
    removeVehicle(vehicleLayer, vehicleId);
    removeTrajectory(vehicleId);
  });

  apiService.onTrajectory((vehicleId, coords, type) => {
    updateTrajectory(vehicleId, coords, type);
    statusPanel.onDataUpdate();
  });

  apiService.onFps((fps) => {
    statusPanel.setFps(fps);
  });
}

// Setup vehicle hover popup
function setupVehiclePopup(
  view: __esri.SceneView,
  vehicleLayer: FeatureLayer
): void {
  const vehiclePopup = new VehiclePopup();

  view.on("pointer-move", async (event) => {
    const response = await view.hitTest(event);
    const results = response.results.filter(
      (result) => "graphic" in result && result.graphic.layer === vehicleLayer
    );

    if (results.length > 0) {
      const hit = results[0] as __esri.GraphicHit;
      const graphic = hit.graphic;
      const attrs = graphic.attributes;

      if (attrs) {
        vehiclePopup.show(
          {
            id: attrs.vehicleId || attrs.TRACKID || attrs.id,
            lineName: attrs.lineName,
            destination: attrs.destination,
            delay: attrs.delay,
            type: attrs.type,
          },
          event.x,
          event.y
        );
      } else {
        // FeatureLayer may need to query for attributes
        vehiclePopup.hide();
      }
    } else {
      vehiclePopup.hide();
    }
  });
}

// Initialize the application
async function init() {
  const sceneElement = document.querySelector("arcgis-scene");

  if (!sceneElement) {
    return;
  }

  sceneElement.setAttribute("item-id", websceneId);

  sceneElement.addEventListener(
    "arcgisViewReadyChange",
    async (event: Event) => {
      const target = event.target as HTMLElement & { view: __esri.SceneView };
      const view = target.view;

      // Configure spatial references for layers
      setVehicleSpatialReference(view.spatialReference);
      setTrajectorySpatialReference(view.spatialReference);

      // Setup scene
      await ensureGroundTerrain(view);
      setInitialCamera(view);

      // Initialize layers
      const { vehicleLayer } = initializeLayers(view);

      // Setup search (disabled for now)
      // const { searchMarker } = initializeLayers(view);
      // setupSearch(view, searchMarker);

      // Initialize panels and services
      const statusPanel = new StatusPanel("status-panel-container");
      const apiService = new GeopsApiService(["rail", "bus", "tram"]);
      statusPanel.setApiService(apiService);

      // Load projection operator
      try {
        await projectOperator.load();
      } catch {
        // Continue without projection support
      }

      const webMercator = new SpatialReference({ wkid: 3857 });

      // Setup bbox updates
      const updateBBoxFromView = createBBoxUpdater(
        view,
        webMercator,
        apiService,
        statusPanel
      );

      reactiveUtils.watch(
        () => view.stationary,
        (stationary: boolean) => {
          if (stationary) {
            updateBBoxFromView();
          }
        }
      );
      updateBBoxFromView();

      // Setup API callbacks
      setupApiCallbacks(apiService, vehicleLayer, statusPanel);

      // Start trajectory refresh interval
      trajectoryRefreshInterval = window.setInterval(() => {
        refreshTrajectories();
      }, TRAJECTORY_REFRESH_INTERVAL);

      // Setup vehicle popup
      setupVehiclePopup(view, vehicleLayer);

      // Clean up on page unload
      window.addEventListener("beforeunload", () => {
        if (trajectoryRefreshInterval) {
          clearInterval(trajectoryRefreshInterval);
        }
        apiService.disconnect();
      });
    }
  );
}

// Start the app
init();
