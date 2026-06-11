import { apiClient } from '@/lib/api/client';
import { EP } from './endpoints';

export interface MapAOIRead {
  id: string;
  map_id: string;
  organization_id: string;
  name: string;
  bbox_4326: [number, number, number, number];
  geometry: Record<string, any> | null;
  selection_config: Record<string, any> | null;
  render_config: Record<string, any> | null;
  temporal_config: Record<string, any> | null;
  analysis_config: Record<string, any> | null;
  visible: boolean;
  opacity: number;
  z_index: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface MapAOIListResponse {
  items: MapAOIRead[];
  total: number;
  limit: number;
  offset: number;
}

export interface MapAOICreatePayload {
  name: string;
  bbox_4326: [number, number, number, number];
  geometry?: Record<string, any>;
  selection_config?: {
    dataset_ids?: string[];
    dataset_item_ids?: string[];
    time_range?: Record<string, any>;
    filters?: Record<string, any>;
  };
  render_config?: Record<string, any>;
  temporal_config?: Record<string, any>;
  analysis_config?: Record<string, any>;
  visible?: boolean;
  opacity?: number;
  z_index?: number;
}

export interface MapAOIUpdatePayload {
  name?: string;
  bbox_4326?: [number, number, number, number];
  geometry?: Record<string, any>;
  selection_config?: Record<string, any>;
  render_config?: Record<string, any>;
  temporal_config?: Record<string, any>;
  analysis_config?: Record<string, any>;
  visible?: boolean;
  opacity?: number;
  z_index?: number;
}

export interface MapAOISelectionConfig {
  dataset_ids: string[];
  dataset_item_ids: string[];
  time_range?: Record<string, any> | null;
  filters?: Record<string, any> | null;
}

export interface MapAOIRenderConfig {
  assets?: string | null;
  bands?: number[] | null;
  asset_bidx?: string | null;
  rescale?: string | null;
  colormap?: string | null;
  rgb_mode?: string | null;
  extra?: Record<string, any> | null;
}

export interface MapAOITimelineResponse {
  aoi_id: string;
  bbox_4326: [number, number, number, number];
  dataset_items: Array<{
    id: string;
    dataset_id: string;
    stac_item_id: string;
    item_datetime: string | null;
    created_at: string;
  }>;
}

export interface MapAOITimelineManifestResponse {
  aoi_id: string;
  manifest_key: string;
  frame_count: number;
  bbox_4326: [number, number, number, number];
  render_config: Record<string, any> | null;
  frames: Array<Record<string, any>>;
}

export interface MapAOITileJSONResponse {
  tiles: string[];
  minzoom: number;
  maxzoom: number;
  bounds: [number, number, number, number];
  center: [number, number, number];
  [key: string]: any;
}

// ── In-flight-create guard ──────────────────────────────────────────────────
// Two callers (MapEditorShell subscribe + AoiPanel ensureAoiMut) can both
// detect a new AOI in the store and race to POST it. Coalescing on the
// frontend `aoiLayerId` is enough since neither caller knows the backend id
// until the response arrives.
const _aoiCreatePromises = new Map<string, Promise<MapAOIRead>>();

export function getOrStartAoiCreate(
  frontendAoiId: string,
  start: () => Promise<MapAOIRead>,
): Promise<MapAOIRead> {
  const existing = _aoiCreatePromises.get(frontendAoiId);
  if (existing) return existing;
  const p = start().finally(() => _aoiCreatePromises.delete(frontendAoiId));
  _aoiCreatePromises.set(frontendAoiId, p);
  return p;
}

export const mapAoisApi = {
  /**
   * GET /maps/{map_id}/aois
   * Lists all saved AOIs for a map, including visibility, ordering, and configs.
   */
  async listAois(mapId: string, limit = 100, offset = 0): Promise<MapAOIListResponse> {
    return apiClient.get(EP.mapAois.list(mapId), {
      searchParams: { limit, offset }
    }).json();
  },

  /**
   * POST /maps/{map_id}/aois
   * Creates and saves a new AOI on the map with its bbox/geometry and initial state.
   */
  async createAoi(mapId: string, payload: MapAOICreatePayload): Promise<MapAOIRead> {
    return apiClient.post(
      EP.mapAois.list(mapId),
      { json: payload }
    ).json();
  },

  /**
   * GET /maps/{map_id}/aois/{aoi_id}
   * Returns one saved AOI with its full stored state and configuration.
   */
  async getAoi(mapId: string, aoiId: string): Promise<MapAOIRead> {
    return apiClient.get(EP.mapAois.detail(mapId, aoiId)).json();
  },

  /**
   * PATCH /maps/{map_id}/aois/{aoi_id}
   * Updates the AOI's saved state (name, bbox, visibility, opacity, z-index, or config).
   */
  async updateAoi(mapId: string, aoiId: string, payload: MapAOIUpdatePayload): Promise<MapAOIRead> {
    return apiClient.patch(
      EP.mapAois.detail(mapId, aoiId),
      { json: payload }
    ).json();
  },

  /**
   * DELETE /maps/{map_id}/aois/{aoi_id}
   * Soft-deletes a saved AOI from the map.
   */
  async deleteAoi(mapId: string, aoiId: string): Promise<void> {
    await apiClient.delete(EP.mapAois.detail(mapId, aoiId));
  },

  /**
   * GET /maps/{map_id}/aois/{aoi_id}/selection
   * Returns the datasets, dataset items, and filters saved for the AOI.
   */
  async getSelection(mapId: string, aoiId: string): Promise<MapAOISelectionConfig> {
    return apiClient.get(EP.mapAois.selection(mapId, aoiId)).json();
  },

  /**
   * PATCH /maps/{map_id}/aois/{aoi_id}/selection
   * Saves or updates the selected datasets, dataset items, and filters for the AOI.
   */
  async updateSelection(
    mapId: string,
    aoiId: string,
    config: MapAOISelectionConfig
  ): Promise<MapAOIRead> {
    return apiClient.patch(
      EP.mapAois.selection(mapId, aoiId),
      { json: config }
    ).json();
  },

  /**
   * GET /maps/{map_id}/aois/{aoi_id}/rendering
   * Returns AOI's saved rendering settings (bands, RGB mapping, rescale, colormap).
   */
  async getRendering(mapId: string, aoiId: string): Promise<MapAOIRenderConfig> {
    return apiClient.get(EP.mapAois.rendering(mapId, aoiId)).json();
  },

  /**
   * PATCH /maps/{map_id}/aois/{aoi_id}/rendering
   * Persists per-AOI display settings (band/preset selection, rescale, colormap).
   */
  async updateRendering(
    mapId: string,
    aoiId: string,
    config: MapAOIRenderConfig,
  ): Promise<MapAOIRead> {
    return apiClient
      .patch(EP.mapAois.rendering(mapId, aoiId), { json: config })
      .json();
  },

  /**
   * GET /maps/{map_id}/aois/{aoi_id}/timeline
   * Returns dataset items in the AOI ordered by timestamp for temporal playback.
   */
  async getTimeline(mapId: string, aoiId: string): Promise<MapAOITimelineResponse> {
    return apiClient.get(EP.mapAois.timeline(mapId, aoiId)).json();
  },

  /**
   * POST /maps/{map_id}/aois/{aoi_id}/timeline/prepare
   * Builds and caches a frame manifest for the AOI timeline in Redis.
   */
  async prepareTimeline(mapId: string, aoiId: string): Promise<MapAOITimelineManifestResponse> {
    return apiClient.post(
      EP.mapAois.timelinePrepare(mapId, aoiId),
      { json: {} }
    ).json();
  },

  /**
   * POST /maps/{map_id}/aois/{aoi_id}/tilejson
   * Returns a TiTiler mosaic TileJSON for the saved AOI's selected dataset items.
   */
  async getTileJSON(
    mapId: string,
    aoiId: string,
    params?: {
      assets?: string;
      preset?: string;
      rescale?: string;
      asset_bidx?: string;
    }
  ): Promise<MapAOITileJSONResponse> {
    return apiClient.post(
      EP.mapAois.tileJson(mapId, aoiId),
      { json: params || {} }
    ).json();
  },

  /**
   * POST /maps/{map_id}/aois/{aoi_id}/inference
   * Queues an inference job scoped to the AOI's selection. Backend resolves
   * dataset_item_ids from the saved selection_config when payload omits them.
   */
  async createInferenceJob(
    mapId: string,
    aoiId: string,
    payload: {
      model_id: string;
      scope?: 'aoi' | 'dataset';
      dataset_id?: string;
      dataset_item_ids?: string[];
      prompt_payload?: Record<string, unknown>;
      /** When set, every prediction is force-labeled with this annotation_class_id
       *  (bypasses model-label matching). Required for prompted models like SAM3
       *  text where the user picks the class explicitly. */
      output_class_id?: string;
      /** TiTiler params for per-patch PNG rendering, computed from the AOI
       *  source layer's bandSelection + band stats. Typically
       *  { asset_bidx: "data|R,G,B", rescale: "p2,p98" }. Overrides the
       *  dataset's default preset on the backend. */
      render_params?: Record<string, string>;
      mount_on_map?: boolean;
      patch_size_px?: number;
      stride_px?: number;
      max_patches_per_item?: number;
    },
  ): Promise<{ id: string; status: string; [k: string]: any }> {
    return apiClient
      .post(EP.mapAois.inference(mapId, aoiId), { json: payload })
      .json();
  },
};
