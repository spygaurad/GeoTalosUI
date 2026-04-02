export type LayerType = 'dataset' | 'annotation' | 'tracking' | 'alert';

/** Source types matching the backend API (ui-leaflet-integration-guide §11) */
export type LayerSourceType = 'dataset' | 'stac_item' | 'tile_service' | 'annotation_set';

export interface LayerStyle {
  color: string;
  fillColor: string;
  fillOpacity: number;
  weight: number;
  radius: number;
  dashArray?: string;
}

export const DEFAULT_ANNOTATION_STYLE: LayerStyle = {
  color: '#c4985c',
  fillColor: '#c4985c',
  fillOpacity: 0.3,
  weight: 2,
  radius: 6,
};

export const DEFAULT_TRACKING_STYLE: LayerStyle = {
  color: '#6bcc6b',
  fillColor: '#6bcc6b',
  fillOpacity: 0.7,
  weight: 2,
  radius: 8,
};

export const DEFAULT_ALERT_STYLE: LayerStyle = {
  color: '#e05c5c',
  fillColor: '#e05c5c',
  fillOpacity: 0.6,
  weight: 2,
  radius: 10,
};

export const DEFAULT_DATASET_STYLE: LayerStyle = {
  color: '#5c8ce0',
  fillColor: '#5c8ce0',
  fillOpacity: 0.1,
  weight: 1.5,
  radius: 6,
};

export const DEFAULT_TILE_SERVICE_STYLE: LayerStyle = {
  color: '#8a7eb8',
  fillColor: '#8a7eb8',
  fillOpacity: 0.1,
  weight: 1,
  radius: 6,
};

/** Band selection for RGB rendering — indices are 1-based band numbers */
export interface BandSelection {
  r: number;
  g: number;
  b: number;
}

export interface LayerConfig {
  id: string;
  /** Human-readable name (used in tooltips, legend). Falls back to id if not set. */
  name?: string;
  type: LayerType;
  sourceType?: LayerSourceType;
  visible: boolean;
  opacity: number;
  style: LayerStyle;
  /** z_index for layer ordering (0 = bottom). Synced with backend. */
  zIndex: number;
  /** Populated after TileJSON fetch — enables COG tile rendering via L.tileLayer */
  tileUrl?: string;
  tileBounds?: [number, number, number, number]; // [west, south, east, north]
  tileMinZoom?: number;
  tileMaxZoom?: number;
  /** For tile_service layers — the raw URL template */
  tileServiceUrl?: string;
  /** For stac_item layers — which dataset this item belongs to */
  parentDatasetId?: string;
  /** For stac_item layers — the STAC item ID */
  stacItemId?: string;
  /** For annotation_set layers — the backend annotation set ID */
  annotationSetId?: string;
  /** Per-class styles for annotation_set layers. Keyed by class_id. */
  classStyles?: Record<string, { fillColor: string; strokeColor: string; strokeWidth: number; fillOpacity: number }>;
  /** Spatial bounds [west, south, east, north] — enables zoom-to-layer */
  bounds?: [number, number, number, number] | null;
  /** Scale-dependent visibility — layer hidden outside this zoom range */
  minZoom?: number;
  maxZoom?: number;
  /** MVT vector tile format — when set, MapManager uses VectorGrid.protobuf */
  tileFormat?: 'raster' | 'mvt';
  /** For MVT layers — the layer name inside the protobuf tiles */
  mvtLayerName?: string;
  /** Loading state — true while data is being fetched for this layer */
  loading?: boolean;
  /** Error state — true when the layer has encountered persistent errors */
  error?: boolean;
  /** Rendering config from titiler — band metadata, presets, etc. */
  renderingConfig?: import('@/types/api').RenderingConfig | null;
  /** Current band selection for RGB rendering (1-based indices) */
  bandSelection?: BandSelection | null;
  /** Current active rendering preset name */
  activePreset?: string | null;
}

export interface SelectedFeature {
  layerType: LayerType;
  /** Registry key — e.g. 'annotation-polygon', 'tracking', 'alert' */
  featureType: string;
  featureId: string;
  properties: Record<string, unknown>;
  latlng: [number, number];
  /** Reference to the actual Leaflet layer for live-style updates via registry applyUpdate */
  layerRef?: unknown;
  /** ID of the parent layer in mapLayersStore (for left panel selection) */
  layerId?: string;
}

// 'new-annotation' = user just drew a shape via Geoman, right panel shows attribute form
// 'measurement'    = measurement tool is active, right panel shows live segment data
// 'dataset'        = dataset layer row clicked, shows metadata + tile controls
// 'items'          = browsing individual STAC items within a dataset
export type RightPanelMode = 'none' | 'feature' | 'style' | 'new-annotation' | 'measurement' | 'dataset' | 'items' | 'annotation-set';

export interface PendingAnnotation {
  label: string;
  description: string;
  style: LayerStyle;
  attributes: { key: string; value: string }[];
  /** If set, the annotation will be saved to this annotation set */
  annotationSetId?: string;
  /** The class within the annotation set's schema */
  classId?: string;
}
