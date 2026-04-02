import { apiClient } from './client';
import type { GeoJSONGeometry } from '@/types/geo';
import type { JobResponse } from '@/types/common';

/**
 * NOTE: Analysis endpoints are not yet documented in docs/backend-api-endpoints.md.
 * These paths are provisional and must be verified against the backend before use.
 * The backend inference endpoint (POST /inference) handles model-based analysis.
 */

export const analysisApi = {
  runChangeDetection: (data: {
    dataset_id: string;
    reference_date: string;
    target_date: string;
    aoi_geometry?: GeoJSONGeometry;
  }) =>
    apiClient.post('analysis/change-detection', { json: data }).json<JobResponse>(),

  runNdvi: (data: {
    dataset_id: string;
    aoi_geometry?: GeoJSONGeometry;
  }) =>
    apiClient.post('analysis/ndvi', { json: data }).json<JobResponse>(),

  runAreaStats: (data: {
    dataset_id: string;
    aoi_geometry?: GeoJSONGeometry;
  }) =>
    apiClient.post('analysis/area-stats', { json: data }).json<JobResponse>(),

  runComposite: (data: {
    dataset_ids: string[];
    aoi_geometry?: GeoJSONGeometry;
  }) =>
    apiClient.post('analysis/composite', { json: data }).json<JobResponse>(),
};
