import { apiClient } from './client';
import { EP } from './endpoints';

export type InferenceJobStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Matches backend JobRead schema for inference jobs. */
export interface InferenceJobRead {
  id: string;
  organization_id: string;
  type: string;
  status: InferenceJobStatus;
  progress: number | null;
  processed_items: number;
  total_items: number;
  failed_items: number;
  logs: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InferenceJobCreatePayload {
  model_id: string;
  dataset_item_ids: string[];
  project_id?: string | null;
  map_id?: string | null;
  mount_on_map?: boolean;
  patch_size_px?: number | null;
  stride_px?: number | null;
  max_patches_per_item?: number | null;
}

export const inferenceApi = {
  /** POST /jobs/inference — enqueue a batch inference job (returns 202). */
  run: (data: InferenceJobCreatePayload) =>
    apiClient.post(EP.jobs.inference, { json: data }).json<InferenceJobRead>(),

  /** GET /jobs/{id} — poll job status. */
  getJob: (jobId: string) =>
    apiClient.get(EP.jobs.detail(jobId)).json<InferenceJobRead>(),
};
