import { HTTPError } from 'ky';
import { apiClient, API_BASE } from './client';
import { EP } from './endpoints';

/** A vector layer the organization uploaded (GeoJSON or CSV). */
export interface UploadedLayer {
  name: string;
  feature_count: number;
  bounds: [number, number, number, number];
  geometry_types: string[];
  attributes: string[];
  created_at: string;
  /** API-relative path with literal {z}/{x}/{y} placeholders. */
  tile_url: string;
  /** Name of the layer inside the tiles. */
  tile_layer: string;
}

export interface UploadResult {
  layer: string;
  created: number;
  skipped: number;
  /** Why the first few features were skipped. */
  reasons: string[];
}

/** The server's own message for a failed request, so the UI can show why. */
export async function apiErrorMessage(err: unknown, fallback: string): Promise<string> {
  if (err instanceof HTTPError) {
    try {
      const body = await err.response.clone().json();
      if (typeof body?.detail === 'string') return body.detail;
    } catch {
      /* not JSON */
    }
  }
  return fallback;
}

export const featureLayersApi = {
  list: () => apiClient.get(EP.featureLayers.layers).json<{ items: UploadedLayer[] }>(),

  /** The file goes up as the raw request body; the server reads the format from its extension. */
  upload: (file: File, opts: { layerName?: string; crs?: string } = {}) =>
    apiClient
      .post(EP.featureLayers.upload, {
        body: file,
        headers: { 'Content-Type': 'application/octet-stream' },
        searchParams: {
          filename: file.name,
          ...(opts.layerName ? { layer_name: opts.layerName } : {}),
          ...(opts.crs ? { crs: opts.crs } : {}),
        },
        timeout: 5 * 60_000,
      })
      .json<UploadResult>(),

  remove: (name: string) => apiClient.delete(EP.featureLayers.layer(name)),

  /** Only the name is encoded: Leaflet must still see the literal {z}/{x}/{y}. */
  tileUrlTemplate: (layer: UploadedLayer) =>
    `${API_BASE}/feature-layers/layers/${encodeURIComponent(layer.name)}/tiles/{z}/{x}/{y}.pbf`,
};
