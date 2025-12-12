import { GeopsApiService } from '../services/geops-api';
import { SBB_BUS_ICON, SBB_TRAM_ICON, SBB_TRAIN_ICON } from '../icons/sbb-icons';
import geopsLogoUrl from '/geops-logo.svg?url';
import arcgisLogoUrl from '/logo.svg?url';

// Chrome-specific memory API type (non-standard)
interface PerformanceMemory {
  usedJSHeapSize: number;
  jsHeapSizeLimit: number;
  totalJSHeapSize: number;
}

interface PerformanceWithMemory extends Performance {
  memory?: PerformanceMemory;
}

// Type guard for checking if performance.memory is available
function hasMemoryApi(perf: Performance): perf is PerformanceWithMemory {
  return 'memory' in perf && (perf as PerformanceWithMemory).memory !== undefined;
}

export class StatusPanel {
  private container: HTMLElement;
  private intervalId: number | null = null;
  private apiService: GeopsApiService | null = null;
  private updateCount: number = 0;
  private blinkTimeout: number | null = null;

  constructor(containerId: string) {
    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error(`Container element #${containerId} not found`);
    }
    this.container = container;

    this.render();
    this.startClock();
  }

  setApiService(apiService: GeopsApiService) {
    this.apiService = apiService;
  }

  // Update extent size and detail level (called from main.ts when view extent changes)
  setExtentSize(km2: number, detailLevel: string) {
    const extentEl = document.getElementById('stats-extent');
    const scaleEl = document.getElementById('stats-scale');
    if (extentEl) {
      // Format with apostrophe as thousands separator (Swiss style)
      extentEl.textContent = Math.round(km2).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'");
    }
    if (scaleEl) {
      scaleEl.textContent = detailLevel;
    }
  }

  // Called when new data arrives - triggers blink and increments counter
  onDataUpdate() {
    this.updateCount++;

    // Update counter display
    const countEl = document.getElementById('live-update-count');
    if (countEl) {
      countEl.textContent = this.updateCount.toLocaleString();
    }

    // Trigger blink
    const blinkEl = document.getElementById('live-blink');
    if (blinkEl) {
      blinkEl.classList.add('active');

      // Clear previous timeout
      if (this.blinkTimeout) {
        clearTimeout(this.blinkTimeout);
      }

      // Remove active class after 150ms
      this.blinkTimeout = window.setTimeout(() => {
        blinkEl.classList.remove('active');
      }, 150);
    }
  }

  // Update FPS display
  setFps(fps: number) {
    const fpsEl = document.getElementById('fps-value');
    if (fpsEl) {
      fpsEl.textContent = fps.toFixed(1);
    }
  }

  private render() {
    this.container.innerHTML = `
      <div class="status-panel">
        <div class="panel-row panel-clock">
          <span class="panel-time" id="panel-clock-time"></span>
          <span class="panel-date" id="panel-clock-date"></span>
        </div>
        <div class="panel-row panel-stats">
          <span class="panel-stat">${SBB_TRAIN_ICON}<span id="stats-rail">0</span></span>
          <span class="panel-stat">${SBB_TRAM_ICON}<span id="stats-tram">0</span></span>
          <span class="panel-stat">${SBB_BUS_ICON}<span id="stats-bus">0</span></span>
        </div>
        <div class="panel-row panel-status">
          <span class="live-blink" id="live-blink"></span>
          <span class="live-label">LIVE</span>
          <span class="panel-details">(<span id="live-update-count">0</span> / <span id="fps-value">0</span> FPS / <span id="stats-memory">-</span> MB)</span>
        </div>
        <div class="panel-row panel-area">
          <span>Area: <span id="stats-extent">0</span> km² (<span id="stats-scale">detailed</span>)</span>
        </div>
        <div class="panel-row panel-logo">
          <a href="https://developer.geops.io/apis/realtime" target="_blank" rel="noopener noreferrer">
            <img src="${geopsLogoUrl}" alt="geOps" class="logo-geops" />
          </a>
        </div>
        <div class="panel-row panel-logo">
          <a href="https://developers.arcgis.com/javascript/latest/" target="_blank" rel="noopener noreferrer" class="logo-arcgis">
            <img src="${arcgisLogoUrl}" alt="ArcGIS" />
            <span>ArcGIS Maps SDK<br/>for JavaScript</span>
          </a>
        </div>
      </div>
    `;
  }

  private startClock() {
    this.updateClock();
    this.intervalId = window.setInterval(() => this.updateClock(), 1000);
  }

  private updateClock() {
    const now = new Date();

    // Format date using Intl API: "Wednesday, 11.12.2024"
    const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(now);
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const dateStr = `${weekday}, ${day}.${month}.${year}`;

    // Format time: HH:MM:SS
    const timeStr = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(now);

    const dateEl = document.getElementById('panel-clock-date');
    const timeEl = document.getElementById('panel-clock-time');

    if (dateEl) dateEl.textContent = dateStr;
    if (timeEl) timeEl.textContent = timeStr;

    // Update vehicle counts and memory
    this.updateStats();
    this.updateMemory();
  }

  private updateStats() {
    if (!this.apiService) return;

    const counts = this.apiService.getVehicleCounts();

    const railEl = document.getElementById('stats-rail');
    const tramEl = document.getElementById('stats-tram');
    const busEl = document.getElementById('stats-bus');

    if (railEl) railEl.textContent = counts.rail.toLocaleString();
    if (tramEl) tramEl.textContent = counts.tram.toLocaleString();
    if (busEl) busEl.textContent = counts.bus.toLocaleString();
  }

  private updateMemory() {
    const memoryEl = document.getElementById('stats-memory');
    if (!memoryEl) return;

    if (hasMemoryApi(performance) && performance.memory) {
      const usedMB = performance.memory.usedJSHeapSize / 1024 / 1024;
      memoryEl.textContent = usedMB.toFixed(0);
    } else {
      memoryEl.textContent = 'N/A';
    }
  }

  destroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.blinkTimeout) {
      clearTimeout(this.blinkTimeout);
      this.blinkTimeout = null;
    }
  }
}
