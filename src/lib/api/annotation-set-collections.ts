import { apiClient } from './client';
import { EP } from './endpoints';

/** Matches backend AnnotationSetCollectionRead. */
export interface AnnotationSetCollection {
  id: string;
  organization_id: string;
  schema_id: string;
  name: string;
  description: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Subset of backend AnnotationSetRead returned by the collection sets listing.
 *  Note: this response carries `dataset_item_id` (UUID) but NOT `stac_item_id` —
 *  callers join `dataset_item_id` against the timeline frames to resolve the
 *  STAC id used for per-frame overlay matching. */
export interface CollectionAnnotationSet {
  id: string;
  schema_id: string | null;
  dataset_id: string | null;
  dataset_item_id: string | null;
  source_type: string;
  model_id: string | null;
  job_id: string | null;
  name: string;
  description: string | null;
  review_status: string;
  extent_4326: [number, number, number, number] | null;
  created_at: string;
}

export interface CreateCollectionPayload {
  schema_id: string;
  name: string;
  description?: string | null;
}

/** TanStack Query key for the collections list (shared by the inference panel's
 *  post-run invalidation and the temporal-playback selector). */
export const annotationSetCollectionsKey = (schemaId?: string) =>
  ['annotation-set-collections', schemaId ?? 'all'] as const;

export const annotationSetCollectionsApi = {
  /** GET /annotation-set-collections — optionally filtered by schema. */
  list: (schemaId?: string) =>
    apiClient
      .get(EP.annotationSetCollections.list, {
        searchParams: schemaId ? { schema_id: schemaId } : undefined,
      })
      .json<{ items: AnnotationSetCollection[]; total: number }>(),

  /** POST /annotation-set-collections — create a collection (schema-scoped). */
  create: (data: CreateCollectionPayload) =>
    apiClient
      .post(EP.annotationSetCollections.create, { json: data })
      .json<AnnotationSetCollection>(),

  /** GET /annotation-set-collections/{id}/annotation-sets — member sets. */
  listSets: (collectionId: string, params?: { limit?: number; offset?: number }) =>
    apiClient
      .get(EP.annotationSetCollections.sets(collectionId), {
        searchParams: {
          ...(params?.limit != null ? { limit: String(params.limit) } : {}),
          ...(params?.offset != null ? { offset: String(params.offset) } : {}),
        },
      })
      .json<{ items: CollectionAnnotationSet[]; total: number }>(),

  /** POST /annotation-set-collections/{id}/annotation-sets — link a set. */
  addSet: (collectionId: string, annotationSetId: string) =>
    apiClient
      .post(EP.annotationSetCollections.sets(collectionId), {
        json: { annotation_set_id: annotationSetId },
      })
      .json<{ collection_id: string; annotation_set_id: string }>(),

  /** DELETE /annotation-set-collections/{id}/annotation-sets/{setId}. */
  removeSet: (collectionId: string, annotationSetId: string) =>
    apiClient
      .delete(EP.annotationSetCollections.removeSet(collectionId, annotationSetId))
      .json<void>(),

  /** DELETE /annotation-set-collections/{id}. */
  delete: (collectionId: string) =>
    apiClient.delete(EP.annotationSetCollections.detail(collectionId)).json<void>(),
};
