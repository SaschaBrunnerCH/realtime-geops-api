// Import Calcite components
import '@esri/calcite-components/dist/components/calcite-input';
import '@esri/calcite-components/dist/components/calcite-list';
import '@esri/calcite-components/dist/components/calcite-list-item';
import '@esri/calcite-components/dist/components/calcite-icon';

import { GEOPS_CONFIG } from '../types/geops';

interface StopFeature {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number]; // [lng, lat] in EPSG:4326
  };
  properties: {
    name: string;
    id?: string;
    country_code?: string;
    mots?: string[];
  };
}

interface StopsResponse {
  type: 'FeatureCollection';
  features: StopFeature[];
}

type StationSelectCallback = (lng: number, lat: number, name: string) => void;
type ClearCallback = () => void;

// Escape HTML special characters to prevent XSS
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export class SearchPanel {
  private container: HTMLElement;
  private onSelectCallback: StationSelectCallback | null = null;
  private onClearCallback: ClearCallback | null = null;
  private searchTimeout: number | null = null;
  private inputElement: HTMLInputElement | null = null;
  private listElement: HTMLElement | null = null;

  constructor(containerId: string) {
    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error(`Container element #${containerId} not found`);
    }
    this.container = container;

    this.render();
    this.setupEventListeners();
  }

  private render() {
    this.container.innerHTML = `
      <div class="search-panel">
        <calcite-input
          id="station-search-input"
          placeholder="Search station..."
          type="search"
          clearable
          scale="m"
        >
          <calcite-icon icon="search" slot="prefix"></calcite-icon>
        </calcite-input>
        <calcite-list id="search-results" style="max-height: 250px; overflow-y: auto; display: none;">
        </calcite-list>
      </div>
    `;

    this.inputElement = this.container.querySelector('#station-search-input');
    this.listElement = this.container.querySelector('#search-results');
  }

  private setupEventListeners() {
    if (!this.inputElement) return;

    // Debounced search on input
    this.inputElement.addEventListener('calciteInputInput', (e) => {
      const target = e.target as HTMLInputElement;
      const query = target.value;

      if (this.searchTimeout) {
        clearTimeout(this.searchTimeout);
      }

      if (query.length < 2) {
        this.hideResults();
        return;
      }

      this.searchTimeout = window.setTimeout(() => {
        this.searchStations(query);
      }, 300);
    });

    // Clear results when input is cleared
    this.inputElement.addEventListener('calciteInputChange', (e) => {
      const target = e.target as HTMLInputElement;
      if (!target.value) {
        this.hideResults();
        // Notify clear callback
        if (this.onClearCallback) {
          this.onClearCallback();
        }
      }
    });
  }

  private setLoading(loading: boolean) {
    if (this.inputElement) {
      if (loading) {
        this.inputElement.setAttribute('loading', '');
      } else {
        this.inputElement.removeAttribute('loading');
      }
    }
  }

  private async searchStations(query: string) {
    this.setLoading(true);
    try {
      const url = `https://api.geops.io/stops/v1/?key=${GEOPS_CONFIG.API_KEY}&q=${encodeURIComponent(query)}&limit=10`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Search failed: ${response.status}`);
      }

      const data: StopsResponse = await response.json();
      this.displayResults(data.features);
    } catch (error) {
      console.error('Station search error:', error);
      this.hideResults();
    } finally {
      this.setLoading(false);
    }
  }

  private displayResults(features: StopFeature[]) {
    if (!this.listElement) return;

    if (features.length === 0) {
      this.listElement.innerHTML = `
        <calcite-list-item label="No stations found" non-interactive></calcite-list-item>
      `;
      this.listElement.style.display = 'block';
      return;
    }

    this.listElement.innerHTML = features.map(feature => {
      const { name, country_code } = feature.properties;
      const [lng, lat] = feature.geometry.coordinates;
      const escapedName = escapeHtml(name);
      const escapedCountry = country_code ? escapeHtml(country_code) : '';
      const countryLabel = escapedCountry ? ` (${escapedCountry})` : '';

      return `
        <calcite-list-item
          label="${escapedName}${countryLabel}"
          data-lng="${lng}"
          data-lat="${lat}"
          data-name="${escapedName}"
        >
          <calcite-icon icon="pin" slot="content-start"></calcite-icon>
        </calcite-list-item>
      `;
    }).join('');

    // Add click handlers to list items
    this.listElement.querySelectorAll('calcite-list-item').forEach(item => {
      item.addEventListener('click', () => {
        const lng = parseFloat(item.getAttribute('data-lng') || '0');
        const lat = parseFloat(item.getAttribute('data-lat') || '0');
        const name = item.getAttribute('data-name') || '';

        if (this.onSelectCallback) {
          this.onSelectCallback(lng, lat, name);
        }

        // Update input with selected station name
        if (this.inputElement) {
          this.inputElement.value = name;
        }

        this.hideResults();
      });
    });

    this.listElement.style.display = 'block';
  }

  private hideResults() {
    if (this.listElement) {
      this.listElement.style.display = 'none';
      this.listElement.innerHTML = '';
    }
  }

  onSelect(callback: StationSelectCallback) {
    this.onSelectCallback = callback;
  }

  onClear(callback: ClearCallback) {
    this.onClearCallback = callback;
  }
}
