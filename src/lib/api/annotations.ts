import { apiClient } from './client';
import { EP } from './endpoints';
import type { Annotation, AnnotationVersion, AnnotationStatus } from '@/types/api';
import type { GeoJSONGeometry } from '@/types/geo';
import type { PaginatedResponse, JobResponse } from '@/types/common';

interface AnnotationListParams {
  dataset_item_id?: string;
  label?: string;
  status?: AnnotationStatus;
  is_current?: boolean;
  bbox?: string;
  page?: number;
  page_size?: number;
}

export const annotationsApi = {
  // Org is scoped automatically via JWT — no org_id query param needed
  list: (params?: AnnotationListParams) =>
    apiClient
      .get(EP.annotations.list, {
        searchParams: (params ?? {}) as unknown as Record<string, string | number>,
      })
      .json<PaginatedResponse<Annotation>>(),

  get: (id: string) =>
    apiClient.get(EP.annotations.detail(id)).json<Annotation>(),

  create: (data: {
    dataset_item_id: string;
    geometry: GeoJSONGeometry;
    label: string;
    confidence?: number;
    status?: AnnotationStatus;
  }) =>
    apiClient.post(EP.annotations.create, { json: data }).json<Annotation>(),

  update: (
    id: string,
    data: Partial<Pick<Annotation, 'geometry' | 'label' | 'confidence' | 'properties'>>,
  ) =>
    apiClient.patch(EP.annotations.update(id), { json: data }).json<Annotation>(),

  updateStatus: (id: string, status: AnnotationStatus) =>
    apiClient
      .patch(EP.annotations.updateStatus(id), { json: { status } })
      .json<Annotation>(),

  delete: (id: string) =>
    apiClient.delete(EP.annotations.delete(id)).json<void>(),

  // Versions
  listVersions: (id: string) =>
    apiClient.get(EP.annotations.versions(id)).json<AnnotationVersion[]>(),

  // Bulk operations — all return 202 job_id
  bulkImport: (data: {
    dataset_id: string;
    format: 'geojson' | 'csv' | 'shapefile';
    source_uri: string;
    field_mapping?: Record<string, string>;
  }) =>
    apiClient.post(EP.annotations.bulkImport, { json: data }).json<JobResponse>(),

  bulkUpdate: (data: {
    annotation_ids: string[];
    updates: Partial<Pick<Annotation, 'label' | 'status' | 'confidence'>>;
  }) =>
    apiClient.post(EP.annotations.bulkUpdate, { json: data }).json<JobResponse>(),

  bulkDelete: (annotationIds: string[]) =>
    apiClient
      .post(EP.annotations.bulkDelete, { json: { annotation_ids: annotationIds } })
      .json<JobResponse>(),

  bulkExport: (data: {
    format: 'geojson' | 'csv' | 'coco';
    filters?: AnnotationListParams;
  }) =>
    apiClient.post(EP.annotations.bulkExport, { json: data }).json<JobResponse>(),
};
