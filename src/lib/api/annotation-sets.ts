import { apiClient } from './client';
import { EP } from './endpoints';
import type { AnnotationSet, AnnotationFeature } from '@/types/api';
import type { GeoJSONGeometry } from '@/types/geo';

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

export const annotationSetsApi = {
  /** List all annotation sets for a project. */
  listByProject: (projectId: string) =>
    apiClient
      .get(EP.annotationSets.listByProject(projectId))
      .json<{ items: AnnotationSet[] }>(),

  /** List annotation sets for a map. */
  listByMap: (mapId: string) =>
    apiClient
      .get(EP.annotationSets.listByMap(mapId))
      .json<{ items: AnnotationSet[] }>(),

  /** Get a single annotation set with optional schema embed. */
  get: (id: string) =>
    apiClient
      .get(EP.annotationSets.detail(id))
      .json<AnnotationSet>(),

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
};
