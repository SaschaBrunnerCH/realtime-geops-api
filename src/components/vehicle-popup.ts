// Import Calcite components
import '@esri/calcite-components/dist/components/calcite-card';
import '@esri/calcite-components/dist/components/calcite-chip';

// Import SBB icons
import { SBB_BUS_ICON, SBB_TRAM_ICON, SBB_TRAIN_ICON } from '../icons/sbb-icons';

export interface VehicleInfo {
  id: string;
  lineName?: string;
  destination?: string;
  delay?: number;
  type?: string;
}

// Vehicle type configuration - maps type to icon and display name
const VEHICLE_TYPES: Record<string, { icon: string; name: string }> = {
  rail: { icon: SBB_TRAIN_ICON, name: 'Train' },
  tram: { icon: SBB_TRAM_ICON, name: 'Tram' },
  bus: { icon: SBB_BUS_ICON, name: 'Bus' },
  ferry: { icon: SBB_BUS_ICON, name: 'Ferry' },
  gondola: { icon: SBB_BUS_ICON, name: 'Gondola' },
  funicular: { icon: SBB_BUS_ICON, name: 'Funicular' },
  subway: { icon: SBB_TRAIN_ICON, name: 'Subway' },
};

const DEFAULT_VEHICLE = { icon: SBB_BUS_ICON, name: 'Vehicle' };

// Delay thresholds in milliseconds
const DELAY_THRESHOLDS = {
  WARNING: 300000,  // 5 minutes
  DANGER: 600000,   // 10 minutes
};


// Escape HTML special characters to prevent XSS
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export class VehiclePopup {
  private container: HTMLElement;

  constructor() {
    // Create popup container
    this.container = document.createElement('div');
    this.container.id = 'vehicle-popup';
    this.container.style.cssText = `
      position: fixed;
      z-index: 100;
      display: none;
      max-width: 300px;
      pointer-events: none;
    `;
    document.body.appendChild(this.container);
  }

  show(vehicle: VehicleInfo, screenX: number, screenY: number) {
    const delayText = this.formatDelay(vehicle.delay);
    const delayColor = this.getDelayColor(vehicle.delay);
    const typeIconSvg = this.getSbbIcon(vehicle.type);
    const typeName = this.getTypeName(vehicle.type);
    const escapedLineName = escapeHtml(vehicle.lineName || 'Unknown Line');

    this.container.innerHTML = `
      <calcite-card>
        <span slot="heading" style="display: flex; align-items: center; gap: 6px;">
          <span style="display: inline-flex; width: 20px; height: 20px;">${typeIconSvg}</span>
          ${escapedLineName}
        </span>
        <span slot="subtitle">${typeName}</span>
        <div slot="footer-start">
          ${delayText ? `<calcite-chip scale="s" appearance="outline-fill" kind="${delayColor}">${delayText}</calcite-chip>` : '<calcite-chip scale="s" appearance="outline-fill" kind="brand">On time</calcite-chip>'}
        </div>
      </calcite-card>
    `;

    // Show popup first to measure its actual size
    this.container.style.display = 'block';
    this.container.style.left = '0px';
    this.container.style.top = '0px';

    // Get actual rendered dimensions
    const rect = this.container.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    const CURSOR_OFFSET = 15;
    const PADDING = 10;

    let x = screenX + CURSOR_OFFSET;
    let y = screenY + CURSOR_OFFSET;

    // Flip left if would overflow right edge
    if (x + width > window.innerWidth - PADDING) {
      x = screenX - width - CURSOR_OFFSET;
    }

    // Flip up if would overflow bottom edge
    if (y + height > window.innerHeight - PADDING) {
      y = screenY - height - CURSOR_OFFSET;
    }

    // Clamp to viewport
    x = Math.max(PADDING, Math.min(x, window.innerWidth - width - PADDING));
    y = Math.max(PADDING, Math.min(y, window.innerHeight - height - PADDING));

    this.container.style.left = `${x}px`;
    this.container.style.top = `${y}px`;
  }

  hide() {
    this.container.style.display = 'none';
  }

  private formatDelay(delay?: number): string {
    if (delay === undefined || delay === null) return '';
    if (delay === 0) return '';
    // geOps API returns delay in milliseconds, round to minutes
    const minutes = Math.round(delay / 60000);
    if (minutes === 0) return '';
    if (minutes > 0) {
      return `+${minutes} min`;
    }
    return `${minutes} min`;
  }

  private getDelayColor(delay?: number): string {
    if (delay === undefined || delay === null || delay <= 0) return 'brand';
    if (delay < DELAY_THRESHOLDS.WARNING) return 'brand';
    if (delay < DELAY_THRESHOLDS.DANGER) return 'warning';
    return 'danger';
  }

  private getVehicleInfo(type?: string): { icon: string; name: string } {
    return (type && VEHICLE_TYPES[type]) || DEFAULT_VEHICLE;
  }

  private getSbbIcon(type?: string): string {
    return this.getVehicleInfo(type).icon;
  }

  private getTypeName(type?: string): string {
    return this.getVehicleInfo(type).name;
  }
}
