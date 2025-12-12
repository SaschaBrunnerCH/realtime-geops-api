/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GEOPS_API_KEY: string;
  readonly VITE_ARCGIS_API_KEY?: string;
  readonly VITE_WEBSCENE_ID?: string;
  readonly VITE_PORTAL_URL?: string;
  readonly VITE_BBOX?: string; // Format: "left,bottom,right,top" in EPSG:3857
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Extend JSX IntrinsicElements for web components
declare namespace JSX {
  interface IntrinsicElements {
    'calcite-shell': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    'arcgis-scene': React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        basemap?: string;
        ground?: string;
      },
      HTMLElement
    >;
  }
}
