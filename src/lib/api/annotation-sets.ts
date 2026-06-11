import { apiClient, API_BASE } from './client';
import { EP } from './endpoints';
import type { AnnotationSet, AnnotationSetMount, AnnotationFeature, RasterValuesResponse, RasterConfigResponse, AnnotationReviewStatus } from '@/types/api';
import type { GeoJSONGeometry } from '@/types/geo';

export interface RasterConfigPayload {
  dataset_item_id: string;
  map_layer_id: string | null;
  band_index: number;
  nodata_value: number | null;
  /** Pixel value (as string key) → schema class UUID */
  value_class_map: Record<string, string>;
}

/**
 * Return the authenticated tile URL template for a raster mask.
 * The backend proxy endpoint (/tiles/raster-masks/{id}/{z}/{x}/{y}.png)
 * injects the colormap server-side, so no query params are needed here.
 */
export function buildRasterTileUrl(config: RasterConfigResponse): string {
  return config.tile_url_template;
}

export interface AnnotationSetCreatePayload {
  name: string;
  description?: string | null;
  schema_id?: string | null;
  dataset_id?: string | null;
}

export interface AnnotationFeatureCreatePayload {
  class_id: string;
  geometry: GeoJSONGeometry;
  confidence?: number | null;
  properties?: Record<string, unknown> | null;
}

/** Payload for POST /maps/{mapId}/annotations — auto-resolves annotation set. */
export interface AnnotationOnMapCreatePayload {
  class_id: string;
  geometry: GeoJSONGeometry;
  confidence?: number | null;
  properties?: Record<string, unknown> | null;
  schema_id?: string | null;
  dataset_id?: string | null;
  set_name?: string | null;
}

export interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    id?: string;
    geometry: GeoJSONGeometry;
    properties: Record<string, unknown>;
  }>;
}

export interface AnnotationSetListFilters {
  datasetId?: string;
  stacItemId?: string;
  unattached?: boolean;
}

function toSearchParams(f?: AnnotationSetListFilters): Record<string, string> | undefined {
  if (!f) return undefined;
  const out: Record<string, string> = {};
  if (f.datasetId) out.dataset_id = f.datasetId;
  if (f.stacItemId) out.stac_item_id = f.stacItemId;
  if (f.unattached) out.unattached = 'true';
  return Object.keys(out).length ? out : undefined;
}

export const annotationSetsApi = {
  /** List annotation sets for a project (optionally filtered by dataset/item/unattached). */
  listByProject: (projectId: string, filters?: AnnotationSetListFilters) =>
    apiClient
      .get(EP.annotationSets.listByProject(projectId), { searchParams: toSearchParams(filters) })
      .json<{ items: AnnotationSet[] }>(),

  /** List annotation sets org-wide (standalone picker). */
  listByOrg: (filters?: AnnotationSetListFilters) =>
    apiClient
      .get(EP.annotationSets.listByOrg(), { searchParams: toSearchParams(filters) })
      .json<{ items: AnnotationSet[] }>(),

  /** Build MVT tile URL template (literal {z}/{x}/{y} placeholders for Leaflet). */
  getTileUrlTemplate: (setId: string) =>
    `${API_BASE.replace(/\/$/, '')}/${EP.annotationSets.tiles(setId)}`,

  /** Get the WGS-84 bounding box of all annotations in a set, or null if empty. */
  getBounds: (setId: string) =>
    apiClient
      .get(EP.annotationSets.bounds(setId))
      .json<{ bounds: { west: number; south: number; east: number; north: number } | null }>(),

  /** List annotation-set mounts for a map, enriched with the joined
   *  AnnotationSet's identifying fields so the caller can filter mounts
   *  (e.g. by job_id) and seed map layers without a second round-trip. */
  listByMap: (mapId: string) =>
    apiClient
      .get(EP.annotationSets.listByMap(mapId))
      .json<{ items: AnnotationSetMount[]; total: number }>(),

  /** Get a single annotation set with optional schema embed. */
  get: (id: string) =>
    apiClient
      .get(EP.annotationSets.detail(id))
      .json<AnnotationSet>(),

  /** Create a standalone annotation set (no parent map). Requires schema_id. */
  createStandalone: (data: AnnotationSetCreatePayload & {
    schema_id: string;
    stac_item_id?: string | null;
  }) =>
    apiClient
      .post(EP.annotationSets.createStandalone(), { json: data })
      .json<AnnotationSet>(),

  /** Import a GeoJSON FeatureCollection into a set. Returns 202 { job_id }. */
  importGeoJSON: (
    setId: string,
    data: {
      geojson: GeoJSONFeatureCollection;
      filename?: string;
      default_class_id?: string | null;
      class_property?: string;
      confidence_property?: string | null;
    }
  ) =>
    apiClient
      .post(EP.annotationSets.import(setId), { json: data })
      .json<{ job_id: string; status: string }>(),

  /** Create an annotation set on a map. */
  create: (mapId: string, data: AnnotationSetCreatePayload) =>
    apiClient
      .post(EP.annotationSets.listByMap(mapId), { json: data })
      .json<AnnotationSet>(),

  /** Rename an annotation set. */
  rename: (id: string, name: string) =>
    apiClient
      .patch(EP.annotationSets.detail(id), { json: { name } })
      .json<AnnotationSet>(),

  /** Set the review workflow status (raw | corrected | verified). */
  setReviewStatus: (id: string, reviewStatus: AnnotationReviewStatus) =>
    apiClient
      .patch(EP.annotationSets.reviewStatus(id), { json: { review_status: reviewStatus } })
      .json<AnnotationSet>(),

  /** Verify one annotation: moves it into the map's human-verified (map, schema)
   *  set, find-or-creating that set. Returns the verified set id and whether it
   *  was newly created (so the caller can mount it as a fresh map layer). */
  verifyFeature: (setId: string, annId: string, mapId: string) =>
    apiClient
      .post(EP.annotationSets.verifyAnnotation(setId, annId), { json: { map_id: mapId } })
      .json<{
        verified_set_id: string;
        source_set_id: string;
        verified_set_created: boolean;
      }>(),

  /** Attach a set to a map — creates the mount so the layer persists on reload.
   *  Symmetric with unmount; both go through map_annotation_sets. */
  mount: (
    mapId: string,
    payload: {
      annotation_set_id: string;
      visible?: boolean;
      opacity?: number;
      z_index?: number;
      style_id?: string | null;
      style_override?: Record<string, unknown> | null;
    },
  ) =>
    apiClient
      .post(EP.annotationSets.mount(mapId), { json: payload })
      .json<AnnotationSetMount>(),

  /** Detach a set from a map — removes the mount only, keeps the set's data. */
  unmount: (mapId: string, setId: string) =>
    apiClient.delete(EP.annotationSets.unmount(mapId, setId)),

  /** Delete an annotation set. */
  delete: (id: string) =>
    apiClient.delete(EP.annotationSets.detail(id)),

  /** Get all features in an annotation set as GeoJSON FeatureCollection. */
  getFeatures: (id: string) =>
    apiClient
      .get(EP.annotationSets.features(id))
      .json<GeoJSONFeatureCollection>(),

  /** Add a single annotation feature to a set. */
  addFeature: (setId: string, data: AnnotationFeatureCreatePayload) =>
    apiClient
      .post(EP.annotationSets.addAnnotation(setId), { json: data })
      .json<AnnotationFeature>(),

  /** Update an annotation feature. */
  updateFeature: (setId: string, annId: string, data: Partial<AnnotationFeatureCreatePayload>) =>
    apiClient
      .patch(EP.annotationSets.annotationDetail(setId, annId), { json: data })
      .json<AnnotationFeature>(),

  /** Delete an annotation feature. */
  deleteFeature: (setId: string, annId: string) =>
    apiClient.delete(EP.annotationSets.annotationDetail(setId, annId)),

  /** Create annotation with auto-resolved set (finds or creates set on the fly). */
  addFeatureOnMap: (mapId: string, data: AnnotationOnMapCreatePayload) =>
    apiClient
      .post(EP.annotationSets.addAnnotationOnMap(mapId), { json: data })
      .json<AnnotationFeature>(),

  /**
   * Preview unique pixel values in a raster band.
   * Used to populate the value→class mapping UI before saving raster config.
   */
  getRasterValues: (setId: string, datasetItemId: string, bandIndex = 1) =>
    apiClient
      .get(EP.annotationSets.rasterValues(setId), {
        searchParams: { dataset_item_id: datasetItemId, band_index: String(bandIndex) },
      })
      .json<RasterValuesResponse>(),

  /**
   * Save the raster value→class mapping for a segmentation mask annotation set.
   * Returns tile_url_template + colormap for map rendering.
   */
  saveRasterConfig: (setId: string, payload: RasterConfigPayload) =>
    apiClient
      .patch(EP.annotationSets.rasterConfig(setId), { json: payload })
      .json<RasterConfigResponse>(),

  /**
   * Fetch an existing raster config for an annotation set.
   * Returns null (404 → null) when the set has no raster config (i.e. it is a vector set).
   */
  getRasterConfig: async (setId: string): Promise<RasterConfigResponse | null> => {
    try {
      return await apiClient
        .get(EP.annotationSets.rasterConfig(setId))
        .json<RasterConfigResponse>();
    } catch {
      return null;
    }
  },
};
