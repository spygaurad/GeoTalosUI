import { apiClient, API_BASE } from './client';
import { EP } from './endpoints';

/** Global, read-only static tileset (same for every organization). */
export interface ReferenceLayer {
  name: string;
  title: string;
  description: string | null;
  /** HTML credit line from the tileset metadata (licence requirement). */
  attribution: string | null;
  minzoom: number;
  maxzoom: number;
  bounds: [number, number, number, number] | null;
  /** API-relative path with literal {z}/{x}/{y} placeholders. */
  tile_url: string;
  geometry: 'polygon' | 'line' | 'point' | null;
  /** What the tiles carry. A `weight` attribute can drive a heatmap. */
  attributes: ReferenceLayerAttribute[];
  /** Heatmap weight until the user picks one (null: count the features). */
  default_weight?: string | null;
  /** Features per heatmap cluster drawn at full strength when counting. Null: the default. */
  count_max?: number | null;
  /** One point per polygon, for the heatmap. Null when the layer has none (yet). */
  density_tile_url: string | null;
}

export interface ReferenceLayerAttribute {
  name: string;
  label: string;
  kind: 'text' | 'category' | 'number';
  unit: string | null;
  weight: boolean;
  /** Weight drawn at full strength in the heatmap (log scale). Null: the default. */
  max?: number | null;
}

/** A user's overrides for one layer. Fields left out use the default look. */
export interface ReferenceLayerStyle {
  colour?: string;
  opacity?: number;
  mode?: 'boxes' | 'heatmap';
  heatmap?: { radius?: number; weight?: string | null };
}

const absoluteTileUrl = (path: string) => `${API_BASE.replace(/\/api\/v1\/?$/, '')}${path}`;

export const referenceLayersApi = {
  list: () => apiClient.get(EP.referenceLayers.list).json<{ items: ReferenceLayer[] }>(),

  /** This organization's style overrides, by layer name. */
  styles: () =>
    apiClient.get(EP.referenceLayers.styles).json<{ items: Record<string, ReferenceLayerStyle> }>(),
  setStyle: (name: string, style: ReferenceLayerStyle) =>
    apiClient.put(EP.referenceLayers.style(name), { json: style }).json<{ layer: string; style: ReferenceLayerStyle }>(),
  resetStyle: (name: string) => apiClient.delete(EP.referenceLayers.style(name)),

  /** Absolute tile URL template for Leaflet. tile_url already starts with /api/v1. */
  tileUrlTemplate: (layer: ReferenceLayer) => absoluteTileUrl(layer.tile_url),
  densityTileUrlTemplate: (layer: ReferenceLayer) =>
    layer.density_tile_url ? absoluteTileUrl(layer.density_tile_url) : null,
};
