import { GEOPS_CONFIG, isLongDistanceTrain } from '../types/geops';

import type { Vehicle, TrajectoryFeature, TimeInterval, VehicleState } from '../types/geops';

interface WebSocketMessage {
  source: string;
  timestamp: number;
  content: unknown;
  client_reference: string | null;
}

interface BufferedMessage {
  source: string;
  timestamp: number;
  content: TrajectoryFeature | string; // trajectory content or deleted vehicle ID
  client_reference: string | null;
}

// Use shared VehicleState type from types/geops

// Store trajectory data for animation
interface VehicleTrajectory {
  id: string;
  coords: [number, number][];
  timeIntervals: TimeInterval[];
  lineName?: string;
  lineColor?: string;
  destination?: string;
  delay?: number;
  type?: string;
  state?: VehicleState;
}

type VehicleCallback = (_vehicles: Vehicle[]) => void;
type DeleteCallback = (_trainId: string) => void;
type TrajectoryCallback = (_vehicleId: string, _coords: [number, number][], _type?: string) => void;

// Animation configuration based on vehicle count
const ANIMATION_CONFIG = {
  VEHICLE_THRESHOLDS: [100, 200, 300, 400],
  INTERVALS_MS: [100, 150, 200, 300, 2000],
  FPS_UPDATE_INTERVAL: 1000,
};

// WebSocket configuration
const WEBSOCKET_CONFIG = {
  PING_INTERVAL: 30000,
  RECONNECT_DELAY: 5000,
  // Request initial buffered messages from server after BBOX subscribe
  // 100 items balances startup completeness with payload size
  BUFFER_SIZE: 100,
  ZOOM_LEVEL: 9,
  BBOX_CHANGE_THRESHOLD: 0.05,
};

// Long-distance check is imported from types/geops

export class GeopsApiService {
  private ws: WebSocket | null = null;
  private trajectories: Map<string, VehicleTrajectory> = new Map();
  private onVehicleUpdate: VehicleCallback | null = null;
  private onVehicleDelete: DeleteCallback | null = null;
  private onTrajectoryUpdate: TrajectoryCallback | null = null;
  private onFpsUpdate: ((_fps: number) => void) | null = null;
  private reconnectTimeout: number | null = null;
  private isConnected = false;
  private pingInterval: number | null = null;
  private currentMots: string[] = ['rail']; // Default to trains only
  private currentBBox: {
    left: number;
    bottom: number;
    right: number;
    top: number;
  } | null = null;
  private longDistanceOnly: boolean = false; // Filter to show only long-distance trains

  constructor(mots: string[] = ['rail']) {
    this.currentMots = mots;
    this.connect();
    this.startAnimation();
  }

  private connect() {
    const url = `${GEOPS_CONFIG.WEBSOCKET_URL}?key=${GEOPS_CONFIG.API_KEY}`;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.isConnected = true;
      // Subscribe to current bbox if one was set before connection
      if (this.currentBBox) {
        this.subscribeToBBox();
      }
      this.startPing();
    };

    this.ws.onmessage = (event) => {
      this.handleMessage(event.data);
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    this.ws.onclose = () => {
      this.isConnected = false;
      this.stopPing();
      this.reconnectTimeout = window.setTimeout(() => this.connect(), WEBSOCKET_CONFIG.RECONNECT_DELAY);
    };
  }

  private startPing() {
    this.pingInterval = window.setInterval(() => {
      if (this.ws && this.isConnected) {
        this.ws.send('PING');
      }
    }, WEBSOCKET_CONFIG.PING_INTERVAL);
  }

  private stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private animationFrame: number | null = null;
  private lastUpdateTime = 0;
  private isAnimating = false; // Lock to prevent concurrent animation updates
  private lastFpsUpdateTime = 0;
  private frameCount = 0;
  private fpsCalculationStart = 0;

  // Get animation interval based on number of vehicles
  // More vehicles = slower animation to reduce CPU load
  // FPS is computed over ~1s windows and reported via onFpsUpdate
  private getAnimationInterval(): number {
    const count = this.trajectories.size;
    const { VEHICLE_THRESHOLDS, INTERVALS_MS } = ANIMATION_CONFIG;
    for (let i = 0; i < VEHICLE_THRESHOLDS.length; i++) {
      if (count < VEHICLE_THRESHOLDS[i]) return INTERVALS_MS[i];
    }
    return INTERVALS_MS[INTERVALS_MS.length - 1];
  }

  private startAnimation() {
    // Use requestAnimationFrame with dynamic interval based on vehicle count
    const animate = (timestamp: number) => {
      const interval = this.getAnimationInterval();
      if (timestamp - this.lastUpdateTime >= interval) {
        // Skip if already animating (lock)
        if (this.isAnimating) {
          this.animationFrame = requestAnimationFrame(animate);
          return;
        }

        this.isAnimating = true;
        this.updateVehiclePositions();
        this.frameCount++;

        // Initialize FPS calculation start time
        if (this.fpsCalculationStart === 0) {
          this.fpsCalculationStart = timestamp;
        }

        // Update FPS display periodically
        if (timestamp - this.lastFpsUpdateTime >= ANIMATION_CONFIG.FPS_UPDATE_INTERVAL) {
          const elapsedSeconds = (timestamp - this.fpsCalculationStart) / 1000;
          const fps = elapsedSeconds > 0 ? this.frameCount / elapsedSeconds : 0;

          if (this.onFpsUpdate) {
            this.onFpsUpdate(fps);
          }

          this.lastFpsUpdateTime = timestamp;
          // Reset FPS calculation for next period
          this.frameCount = 0;
          this.fpsCalculationStart = timestamp;
        }

        this.lastUpdateTime = timestamp;
        this.isAnimating = false;
      }
      this.animationFrame = requestAnimationFrame(animate);
    };
    this.animationFrame = requestAnimationFrame(animate);
  }

  private stopAnimation() {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  // Build vehicle list from current trajectories
  private buildVehicleList(): Vehicle[] {
    const now = Date.now();
    const vehicles: Vehicle[] = [];

    for (const trajectory of this.trajectories.values()) {
      const position = this.interpolatePosition(trajectory.coords, trajectory.timeIntervals, now);

      if (position) {
        vehicles.push({
          id: trajectory.id,
          x: position.x,
          y: position.y,
          rotation: position.rotation,
          lineName: trajectory.lineName,
          lineColor: trajectory.lineColor,
          destination: trajectory.destination,
          delay: trajectory.delay,
          type: trajectory.type,
          state: trajectory.state,
        });
      }
    }

    return vehicles;
  }

  private updateVehiclePositions() {
    if (!this.onVehicleUpdate || this.trajectories.size === 0) return;
    this.onVehicleUpdate(this.buildVehicleList());
  }

  private subscribeToBBox() {
    if (!this.ws || !this.isConnected || !this.currentBBox) return;

    const { left, bottom, right, top } = this.currentBBox;

    // Subscribe to trajectories in visible area bounding box
    // Format: BBOX left bottom right top zoom [mots=rail,tram,bus,etc]
    let bboxCommand = `BBOX ${left} ${bottom} ${right} ${top} ${WEBSOCKET_CONFIG.ZOOM_LEVEL}`;

    if (this.currentMots.length > 0) {
      bboxCommand += ` mots=${this.currentMots.join(',')}`;
    }

    this.ws.send(bboxCommand);
    this.ws.send(`BUFFER ${WEBSOCKET_CONFIG.BUFFER_SIZE}`);
  }

  // Update the bounding box based on visible view extent (in Web Mercator / EPSG:3857)
  updateBBox(left: number, bottom: number, right: number, top: number) {
    const newBBox = { left, bottom, right, top };

    // Check if bbox has changed significantly
    // Threshold ~5% for size and center shift to avoid excessive re-subscriptions
    if (this.currentBBox && !this.hasBBoxChangedEnough(this.currentBBox, newBBox)) {
      return;
    }

    // Remove trajectories outside the new bbox
    // This is necessary because the server only sends updates for vehicles in the bbox,
    // it doesn't send deletion messages for vehicles that left the visible area
    for (const [id, trajectory] of this.trajectories) {
      // Get the last known position from the trajectory
      if (trajectory.coords.length > 0) {
        const lastCoord = trajectory.coords[trajectory.coords.length - 1];
        const x = lastCoord[0];
        const y = lastCoord[1];

        // Check if position is outside new bbox
        if (x < newBBox.left || x > newBBox.right || y < newBBox.bottom || y > newBBox.top) {
          this.trajectories.delete(id);
          if (this.onVehicleDelete) {
            this.onVehicleDelete(id);
          }
        }
      }
    }

    this.currentBBox = newBBox;

    // Re-subscribe with new bbox
    this.subscribeToBBox();
  }

  // Helper: determine if bbox change warrants resubscription
  private hasBBoxChangedEnough(
    oldBBox: { left: number; bottom: number; right: number; top: number },
    newBBox: { left: number; bottom: number; right: number; top: number },
  ): boolean {
    const threshold = WEBSOCKET_CONFIG.BBOX_CHANGE_THRESHOLD;

    const oldWidth = oldBBox.right - oldBBox.left;
    const oldHeight = oldBBox.top - oldBBox.bottom;
    const newWidth = newBBox.right - newBBox.left;
    const newHeight = newBBox.top - newBBox.bottom;

    const centerXOld = (oldBBox.left + oldBBox.right) / 2;
    const centerYOld = (oldBBox.bottom + oldBBox.top) / 2;
    const centerXNew = (newBBox.left + newBBox.right) / 2;
    const centerYNew = (newBBox.bottom + newBBox.top) / 2;

    const widthChange = Math.abs(newWidth - oldWidth) / Math.max(oldWidth, 1);
    const heightChange = Math.abs(newHeight - oldHeight) / Math.max(oldHeight, 1);
    const centerXChange = Math.abs(centerXNew - centerXOld) / Math.max(oldWidth, 1);
    const centerYChange = Math.abs(centerYNew - centerYOld) / Math.max(oldHeight, 1);

    return !(
      widthChange < threshold &&
      heightChange < threshold &&
      centerXChange < threshold &&
      centerYChange < threshold
    );
  }

  // Set transport filter without re-subscribing (use updateBBox after to apply)
  setTransportFilter(mots: string[]) {
    const previousMots = this.currentMots;
    this.currentMots = mots;

    // Remove trajectories that no longer match the filter
    if (previousMots.length !== mots.length || !previousMots.every((m) => mots.includes(m))) {
      for (const [id, trajectory] of this.trajectories) {
        if (!trajectory.type || !mots.includes(trajectory.type)) {
          this.trajectories.delete(id);
          if (this.onVehicleDelete) {
            this.onVehicleDelete(id);
          }
        }
      }
    }
  }

  // Set whether to show only long-distance trains (IC, ICE, EC, IR, TGV, etc.)
  setLongDistanceOnly(enabled: boolean) {
    if (this.longDistanceOnly !== enabled) {
      this.longDistanceOnly = enabled;
      // Remove non-long-distance trains if filter is enabled
      if (enabled) {
        for (const [id, trajectory] of this.trajectories) {
          if (trajectory.type === 'rail' && !isLongDistanceTrain(trajectory.lineName)) {
            this.trajectories.delete(id);
            if (this.onVehicleDelete) {
              this.onVehicleDelete(id);
            }
          }
        }
      }
    }
  }

  private handleMessage(data: string) {
    try {
      const message: WebSocketMessage = JSON.parse(data);
      const { source, content } = message;

      if (source === 'buffer' && Array.isArray(content)) {
        // Handle buffered messages - each item is a full message object
        for (const item of content as BufferedMessage[]) {
          this.processBufferedItem(item);
        }
      } else if (source === 'trajectory') {
        // Handle single trajectory update
        this.processTrajectory(content as TrajectoryFeature);
      } else if (source === 'deleted_vehicles') {
        // Handle vehicle deletion - content is the train_id string
        const trainId = content as string;
        this.trajectories.delete(trainId);
        if (this.onVehicleDelete) {
          this.onVehicleDelete(trainId);
        }
      }
    } catch {
      // PONG responses and other non-JSON messages
    }
  }

  private processBufferedItem(item: BufferedMessage) {
    if (item.source === 'trajectory') {
      this.processTrajectory(item.content as TrajectoryFeature);
    } else if (item.source === 'deleted_vehicles') {
      const trainId = item.content as string;
      this.trajectories.delete(trainId);
      if (this.onVehicleDelete) {
        this.onVehicleDelete(trainId);
      }
    }
  }

  private processTrajectory(feature: TrajectoryFeature) {
    if (!feature || !feature.properties || !feature.geometry) {
      return;
    }

    const { train_id, time_intervals, line, destination, delay, type, state } = feature.properties;
    const coords = feature.geometry.coordinates;

    if (!train_id || !time_intervals || !coords || coords.length === 0) return;

    // Filter out non-long-distance trains when filter is enabled
    if (this.longDistanceOnly && type === 'rail' && !isLongDistanceTrain(line?.name)) {
      return;
    }

    // Store trajectory data for continuous animation
    const trajectory: VehicleTrajectory = {
      id: train_id,
      coords,
      timeIntervals: time_intervals,
      lineName: line?.name,
      lineColor: line?.color,
      destination,
      delay,
      type,
      state: state as VehicleState,
    };

    this.trajectories.set(train_id, trajectory);

    // Notify trajectory listeners
    if (this.onTrajectoryUpdate) {
      this.onTrajectoryUpdate(train_id, coords, type);
    }
  }

  // Find the surrounding time intervals for a given timestamp
  private findTimeIntervals(
    timeIntervals: TimeInterval[],
    now: number,
  ): { prev: TimeInterval | null; next: TimeInterval | null } {
    let prev: TimeInterval | null = null;
    let next: TimeInterval | null = null;

    for (const interval of timeIntervals) {
      if (interval[0] <= now) {
        prev = interval;
      } else if (!next) {
        next = interval;
        break;
      }
    }

    return { prev, next };
  }

  // Get position at a specific fraction along the coordinate path
  private getPositionAtFraction(
    coords: [number, number][],
    fraction: number,
    rotation: number,
  ): { x: number; y: number; rotation: number } {
    const idx = Math.min(Math.floor(fraction * (coords.length - 1)), coords.length - 1);
    return {
      x: coords[idx][0],
      y: coords[idx][1],
      rotation,
    };
  }

  // Interpolate position between two time intervals
  private interpolateBetweenIntervals(
    coords: [number, number][],
    prev: TimeInterval,
    next: TimeInterval,
    now: number,
  ): { x: number; y: number; rotation: number } {
    const timeDiff = next[0] - prev[0];
    const timeProgress = timeDiff > 0 ? (now - prev[0]) / timeDiff : 0;
    const fraction = prev[1] + (next[1] - prev[1]) * timeProgress;

    const totalLength = coords.length - 1;
    const floatIdx = fraction * totalLength;
    const idx = Math.floor(floatIdx);
    const subFraction = floatIdx - idx;

    if (idx >= coords.length - 1) {
      return {
        x: coords[coords.length - 1][0],
        y: coords[coords.length - 1][1],
        rotation: next[2],
      };
    }

    // Linear interpolation between two coordinates
    const x = coords[idx][0] + (coords[idx + 1][0] - coords[idx][0]) * subFraction;
    const y = coords[idx][1] + (coords[idx + 1][1] - coords[idx][1]) * subFraction;
    const rotation = prev[2] + (next[2] - prev[2]) * timeProgress;

    return { x, y, rotation };
  }

  private interpolatePosition(
    coords: [number, number][],
    timeIntervals: TimeInterval[],
    now: number,
  ): { x: number; y: number; rotation: number } | null {
    if (timeIntervals.length === 0) return null;

    const { prev, next } = this.findTimeIntervals(timeIntervals, now);

    // Past all intervals - use last position
    if (!next && prev) {
      return this.getPositionAtFraction(coords, prev[1], prev[2]);
    }

    // Before all intervals - use first position
    if (!prev && next) {
      return this.getPositionAtFraction(coords, next[1], next[2]);
    }

    // Interpolate between intervals
    if (prev && next) {
      return this.interpolateBetweenIntervals(coords, prev, next, now);
    }

    return null;
  }

  onUpdate(callback: VehicleCallback) {
    this.onVehicleUpdate = callback;
  }

  onDelete(callback: DeleteCallback) {
    this.onVehicleDelete = callback;
  }

  onTrajectory(callback: TrajectoryCallback) {
    this.onTrajectoryUpdate = callback;
  }

  onFps(callback: (_fps: number) => void) {
    this.onFpsUpdate = callback;
  }

  getVehicles(): Vehicle[] {
    return this.buildVehicleList();
  }

  getVehicleCounts(): {
    rail: number;
    tram: number;
    bus: number;
    total: number;
  } {
    let rail = 0;
    let tram = 0;
    let bus = 0;

    for (const trajectory of this.trajectories.values()) {
      if (trajectory.type === 'rail') {
        rail++;
      } else if (trajectory.type === 'tram') {
        tram++;
      } else if (trajectory.type === 'bus') {
        bus++;
      }
    }

    return { rail, tram, bus, total: rail + tram + bus };
  }

  disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    this.stopPing();
    this.stopAnimation();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
