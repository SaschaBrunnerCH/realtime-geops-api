import Mesh from '@arcgis/core/geometry/Mesh';
import Point from '@arcgis/core/geometry/Point';
import Graphic from '@arcgis/core/Graphic';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import FillSymbol3DLayer from '@arcgis/core/symbols/FillSymbol3DLayer';
import MeshSymbol3D from '@arcgis/core/symbols/MeshSymbol3D';
import pinpointUrl from '/pinpoint.glb?url';

// Animated marker for search results using a 3D pinpoint model
export class AnimatedMarker {
  private layer: GraphicsLayer;
  private graphic: Graphic | null = null;
  private animating = false;
  private animationFrame: number | null = null;

  constructor() {
    this.layer = new GraphicsLayer({
      id: 'search-marker',
      title: 'Search Marker',
      elevationInfo: {
        mode: 'relative-to-ground',
      },
    });
  }

  getLayer(): GraphicsLayer {
    return this.layer;
  }

  // Show animated marker at location
  async show(longitude: number, latitude: number): Promise<void> {
    // Remove existing marker
    this.hide();

    // Create location for the pin
    const location = new Point({
      longitude,
      latitude,
      z: 0,
    });

    // Load the pinpoint GLB model
    const mesh = await Mesh.createFromGLTF(location, pinpointUrl, {
      vertexSpace: 'georeferenced',
    });

    // Scale the model to appropriate size
    mesh.scale(4);

    // Create symbol for the mesh
    const symbol = new MeshSymbol3D({
      symbolLayers: [new FillSymbol3DLayer()],
    });

    this.graphic = new Graphic({
      geometry: mesh,
      symbol: symbol,
    });

    this.layer.add(this.graphic);

    // Start bobbing animation
    this.startAnimation();
  }

  // Hide and stop animation
  hide(): void {
    this.stopAnimation();
    if (this.graphic) {
      this.layer.remove(this.graphic);
      this.graphic = null;
    }
  }

  private startAnimation(): void {
    if (!this.graphic) return;

    this.animating = true;
    let startTime: number | null = null;

    const animate = (elapsedTime: number) => {
      if (!this.animating || !this.graphic) return;

      if (!startTime) {
        startTime = elapsedTime;
      }

      const timeDiff = (elapsedTime - startTime) / 1000;

      // Gentle bobbing animation (up and down)
      const bounce = Math.sin(timeDiff * 3) * 10;

      const geometry = this.graphic.geometry as Mesh;
      if (geometry?.transform) {
        geometry.transform.translation = [0, 0, bounce];
      }

      this.animationFrame = requestAnimationFrame(animate);
    };

    this.animationFrame = requestAnimationFrame(animate);
  }

  private stopAnimation(): void {
    this.animating = false;
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  destroy(): void {
    this.hide();
  }
}
