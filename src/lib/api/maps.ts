import { apiClient } from './client';
import { EP } from './endpoints';
import type { ProjectMap, MapViewState, MapApiLayer, Dataset, DatasetItem } from '@/types/api';
import type { PaginatedResponse } from '@/types/common';

/** Payload for the 8-second auto-save PATCH /maps/{id} */
export interface MapAutoSavePayload {
  view_state?: MapViewState;
  /** Batch layer display changes (opacity, style_override — NOT visibility or z_index) */
  layers?: { id: string; opacity?: number; style_override?: Record<string, unknown> | null }[];
}

/** Lightweight reference to an annotation set returned by /maps/{id}/aoi/resources */
export interface MapAoiAnnotationSetRef {
  id: string;
  name: string;
  schema_id?: string | null;
  raster_config?: Record<string, unknown> | null;
  [key: string]: unknown;
}

/** GET /maps/{map_id}/aoi/resources response — everything overlapping a bbox. */
export interface MapAoiResources {
  bbox: [number, number, number, number];
  datasets: Dataset[];
  dataset_items: DatasetItem[];
  vector_annotation_sets: MapAoiAnnotationSetRef[];
  raster_mask_annotation_sets: MapAoiAnnotationSetRef[];
}

function bboxToParam(bbox: [number, number, number, number]): string {
  return bbox.join(',');
}

export const mapsApi = {
  list: (projectId?: string) =>
    apiClient
      .get(EP.maps.list, {
        searchParams: projectId ? { project_id: projectId } : {},
      })
      .json<PaginatedResponse<ProjectMap>>(),

  get: (id: string) =>
    apiClient.get(EP.maps.detail(id)).json<ProjectMap>(),

  create: (projectId: string, data: { name: string; description?: string }) =>
    apiClient
      .post(EP.maps.create, {
        json: {
          project_id: projectId,
          view_state: { center: [0, 20], zoom: 3 },
          ...data,
        },
      })
      .json<ProjectMap>(),

  update: (
    id: string,
    data: Partial<Pick<ProjectMap, 'name' | 'description'>>,
  ) =>
    apiClient.patch(EP.maps.update(id), { json: data }).json<ProjectMap>(),

  delete: (id: string) => apiClient.delete(EP.maps.delete(id)).json<void>(),

  /**
   * Auto-save: PATCH /maps/{id} with view_state + batch layer changes.
   * Called by the 8-second debounce timer after camera moves or slider adjustments.
   */
  autoSave: (id: string, data: MapAutoSavePayload) =>
    apiClient.patch(EP.maps.update(id), { json: data }).json<ProjectMap>(),

  /**
   * Reorder layers: PUT /maps/{id}/layers/reorder
   * Sends layer_ids ordered bottom-to-top (z_index 0 first).
   * Returns layers with updated z_index values.
   */
  reorderLayers: (mapId: string, layerIds: string[]) =>
    apiClient
      .put(EP.maps.layersReorder(mapId), { json: { layer_ids: layerIds } })
      .json<MapApiLayer[]>(),

  // ── Map AOI helpers (read-side; AOI CRUD lives in map-aois.ts) ──────────────

  /** GET /maps/{map_id}/datasets — datasets attached to the map. */
  listDatasets: (mapId: string, opts?: { limit?: number; offset?: number }) =>
    apiClient
      .get(EP.maps.datasets(mapId), {
        searchParams: {
          limit: opts?.limit ?? 100,
          offset: opts?.offset ?? 0,
        },
      })
      .json<PaginatedResponse<Dataset>>(),

  /**
   * GET /maps/{map_id}/aoi/resources?bbox=… — list every resource (datasets, items,
   * vector annotation sets, raster masks) that overlaps an arbitrary AOI bbox.
   * Works for unsaved/draft AOIs — `bbox` is supplied directly, no AOI id required.
   */
  listAoiResources: (mapId: string, bbox: [number, number, number, number]) =>
    apiClient
      .get(EP.maps.aoiResources(mapId), {
        searchParams: { bbox: bboxToParam(bbox) },
      })
      .json<MapAoiResources>(),

  /**
   * GET /maps/{map_id}/datasets/{dataset_id}/items/in-aoi?bbox=…
   * Paginated list of dataset items whose geometry intersects the AOI bbox.
   */
  listDatasetItemsInAoi: (
    mapId: string,
    datasetId: string,
    bbox: [number, number, number, number],
    opts?: { limit?: number; offset?: number },
  ) =>
    apiClient
      .get(EP.maps.datasetItemsInAoi(mapId, datasetId), {
        searchParams: {
          bbox: bboxToParam(bbox),
          limit: opts?.limit ?? 100,
          offset: opts?.offset ?? 0,
        },
      })
      .json<PaginatedResponse<DatasetItem>>(),

  /**
   * Build a TiTiler preview URL for a dataset clipped to an AOI bbox. Returns
   * an absolute URL string so `<img src>` consumers can use it directly. Goes
   * through the API (which proxies to TiTiler and applies auth + map scoping).
   */
  getDatasetPreviewUrl: (
    mapId: string,
    datasetId: string,
    bbox: [number, number, number, number],
    params?: { width?: number; height?: number; format?: 'png' | 'jpeg' | 'webp'; assets?: string; rescale?: string },
  ): string => {
    const base = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');
    const qs = new URLSearchParams();
    qs.set('bbox', bboxToParam(bbox));
    if (params?.width) qs.set('width', String(params.width));
    if (params?.height) qs.set('height', String(params.height));
    if (params?.format) qs.set('format', params.format);
    if (params?.assets) qs.set('assets', params.assets);
    if (params?.rescale) qs.set('rescale', params.rescale);
    return `${base}/${EP.maps.datasetPreview(mapId, datasetId)}?${qs.toString()}`;
  },

  /** Same as getDatasetPreviewUrl but for a specific dataset item. */
  getDatasetItemPreviewUrl: (
    mapId: string,
    datasetId: string,
    itemId: string,
    bbox: [number, number, number, number],
    params?: { width?: number; height?: number; format?: 'png' | 'jpeg' | 'webp'; assets?: string; rescale?: string },
  ): string => {
    const base = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');
    const qs = new URLSearchParams();
    qs.set('bbox', bboxToParam(bbox));
    if (params?.width) qs.set('width', String(params.width));
    if (params?.height) qs.set('height', String(params.height));
    if (params?.format) qs.set('format', params.format);
    if (params?.assets) qs.set('assets', params.assets);
    if (params?.rescale) qs.set('rescale', params.rescale);
    return `${base}/${EP.maps.datasetItemPreview(mapId, datasetId, itemId)}?${qs.toString()}`;
  },
};
