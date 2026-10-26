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
}

export const referenceLayersApi = {
  list: () => apiClient.get(EP.referenceLayers.list).json<{ items: ReferenceLayer[] }>(),

  /** Absolute tile URL template for Leaflet. tile_url already starts with /api/v1. */
  tileUrlTemplate: (layer: ReferenceLayer) =>
    `${API_BASE.replace(/\/api\/v1\/?$/, '')}${layer.tile_url}`,
};
