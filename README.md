# Realtime geOps API

A real-time public transport visualization application that displays live vehicle positions (trains, trams, and buses) on a 3D map using the [geOps Realtime API](https://developer.geops.io/apis/realtime) and [ArcGIS Maps SDK for JavaScript](https://developers.arcgis.com/javascript/latest/).

## <a href="https://saschabrunnerch.github.io/realtime-geops-api/" target="_blank" rel="noopener noreferrer">Live Demo</a>


## Features

- **Real-time vehicle tracking** - Live positions of trains, trams, and buses updated via WebSocket
- **3D visualization** - Interactive 3D globe view using ArcGIS SceneView
- **Smooth animations** - Vehicle positions interpolated between updates for fluid movement
- **Vehicle trajectories** - Colored path lines showing vehicle routes (FeatureLayer with UniqueValueRenderer)
- **Hover popups** - Display line name, vehicle type, and delay information
- **Adaptive display** - Icons scale and filter based on zoom level for optimal performance
- **Live statistics** - Real-time display of vehicle counts, FPS, and memory usage

## Architecture

```
src/
├── main.ts                    # Application entry point and initialization
├── services/
│   └── geops-api.ts           # WebSocket connection to geOps Realtime API
├── layers/
│   ├── vehicle-layer.ts       # Vehicle FeatureLayer with dynamic UniqueValueRenderer
│   └── trajectory-layer.ts    # Trajectory FeatureLayer with type-based styling
├── components/
│   ├── search-panel.ts        # Station search functionality (currently disabled)
│   ├── status-panel.ts        # Clock, stats, and status display
│   ├── vehicle-popup.ts       # Hover popup for vehicle details
│   └── animated-marker.ts     # 3D animated marker for search results (currently disabled)
├── types/
│   └── geops.ts               # TypeScript types and API configuration
└── icons/
    └── sbb-icons.ts           # SBB transport icons (train, tram, bus)
```

## Prerequisites

- Node.js v24 or higher
- npm

## Installation

```bash
npm install
```

## Configuration

### Environment Variables

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

Edit `.env` with your API keys:

```env
VITE_GEOPS_API_KEY=your_geops_api_key
VITE_ARCGIS_API_KEY=your_arcgis_api_key
```

### API Keys

| Key            | Source                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| geOps API Key  | [developer.geops.io](https://developer.geops.io/apis/realtime)                                                           |
| ArcGIS API Key | [developers.arcgis.com](https://developers.arcgis.com/documentation/security-and-authentication/api-key-authentication/) |

### Optional Configuration

You can customize the initial bounding box via environment variables or URL parameters:

```env
# Custom bounding box (EPSG:3857 coordinates)
VITE_BBOX=657000,5751000,1168000,6076000

# Custom ArcGIS Portal and WebScene
VITE_PORTAL_URL=https://www.arcgis.com
VITE_WEBSCENE_ID=7f6ae34b6cf749cd86de9df23421d701
```

URL parameters take precedence over environment variables:

- `?bbox=left,bottom,right,top` - Custom bounding box
- `?portal=url` - Custom ArcGIS portal URL
- `?webscene=webscene_id` - Custom WebScene ID

## Development

Start the development server:

```bash
npm run dev
```

The application will be available at `http://localhost:5173`

## Build

Build for production:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Tech Stack

- **[Vite](https://vitejs.dev/)** - Build tool and dev server
- **[TypeScript](https://www.typescriptlang.org/)** - Type-safe JavaScript
- **[ArcGIS Maps SDK](https://developers.arcgis.com/javascript/latest/)** - 3D mapping and visualization
- **[Calcite Components](https://developers.arcgis.com/calcite-design-system/)** - UI components
- **[geOps Realtime API](https://developer.geops.io/apis/realtime)** - Real-time public transport data

## How It Works

1. **WebSocket Connection** - The app connects to the geOps Realtime API via WebSocket
2. **Bounding Box Subscription** - Subscribes to vehicle updates within the visible map extent
3. **Trajectory Processing** - Receives trajectory data with time intervals for position interpolation
4. **Animation Loop** - Uses `requestAnimationFrame` to smoothly animate vehicles between known positions
5. **Adaptive Display** - Icons and vehicle types adapt based on zoom level (see below)

### Implementation Details

- **FPS reporting**: Calculated over rolling ~1s windows from the animation loop and updated periodically.
- **Memory display**: Uses the non-standard `performance.memory` API which is available in Chromium-based browsers; other browsers will show `N/A`.
- **BBox update threshold**: The subscription only refreshes when the extent changes beyond ~5% in size or center shift to avoid excessive WebSocket re-subscriptions.

## Adaptive Display System

The application uses an intelligent adaptive display system that optimizes performance and readability based on the visible map area (measured in km²).

### Vehicle Type Filtering

As you zoom out, the application progressively filters vehicle types to reduce clutter and improve performance:

| Visible Area      | Vehicles Shown                                 |
| ----------------- | ---------------------------------------------- |
| < 15,000 km²      | All vehicles (trains, trams, buses)            |
| 15,000–50,000 km² | Trains only (all types)                        |
| > 50,000 km²      | Long-distance trains only (IC, ICE, TGV, etc.) |

Long-distance train prefixes used by the filter: `IC`, `ICE`, `EC`, `TGV`, `RJX`, `NJ`, `EN`, `IR`.

### Icon Scaling

Icons dynamically scale based on the visible area to maintain visual clarity:

| Visible Area      | Scale Factor | Effect               |
| ----------------- | ------------ | -------------------- |
| ≤ 2,000 km²       | 100%         | Full size icons      |
| 2,000–100,000 km² | 100%–25%     | Linear interpolation |
| ≥ 100,000 km²     | 25%          | Minimum size icons   |

Base icon sizes:

- **Rail vehicles**: 38px (at 100% scale)
- **Bus/Tram**: 19px (at 100% scale)
- **Minimum size**: 8px (never smaller)

### Line Number Display

Line numbers (e.g., "S3", "IC5", "Bus 31") inside vehicle icons are hidden when the visible area exceeds **50,000 km²** to reduce visual noise at large scales.

### How It Works Technically

1. On each view extent change, the application calculates the visible area in km²
2. The `setIconScaleFactor()` function in `vehicle-layer.ts` computes the appropriate scale
3. The `setTransportFilter()` and `setLongDistanceOnly()` methods in `geops-api.ts` filter the WebSocket subscription
4. The vehicle FeatureLayer uses a `UniqueValueRenderer` with dynamically added symbols based on vehicle type, line name, delay category, state, and scale
5. When scale changes, symbols are regenerated with new sizes (debounced to avoid UI blocking)

## 3D Animated Marker (Currently Disabled)

When searching for a station, a 3D animated pinpoint marker is displayed at the location. The marker features a smooth up-and-down bouncing animation to draw attention to the search result.

> **Note**: Station search and the animated marker are currently disabled.

The animation is implemented using the ArcGIS Maps SDK mesh animation capabilities, based on the technique described in [Mesh Animations in the ArcGIS Maps SDK for JavaScript](https://www.esri.com/arcgis-blog/products/js-api-arcgis/3d-gis/mesh-animations-javascript/).

The marker:

- Uses a GLB 3D model (`pinpoint.glb`) loaded via `Mesh.createFromGLTF()`
- Features a continuous bounce animation using `requestAnimationFrame`
- Scales and positions automatically at the search location

## License

This project is licensed under the MIT License.

This project uses icons from [SBB Icons](https://github.com/sbb-design-systems/sbb-icons) (Apache-2.0 License).

## AI Assistance Declaration

This project was primarily developed using AI coding assistants. The maintainer directed the development through prompts and reviewed all generated code.
