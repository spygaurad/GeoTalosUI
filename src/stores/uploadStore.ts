import { create } from 'zustand';
import type { JobStatus } from '@/types/common';

export type UploadPhase =
  | 'idle'
  | 'creating'    // Step 1: POST /datasets
  | 'initiating'  // Step 2: POST /uploads/initiate
  | 'uploading'   // Step 3+4: PUT parts to proxy endpoint (no auth required)
  | 'completing'  // Step 5: POST /complete
  | 'ingesting'   // Step 6: polling GET /jobs/{id}
  | 'ready'       // ingestion completed — dataset.status = ready
  | 'failed'
  | 'aborted';

export interface UploadProgress {
  partsTotal: number;
  partsCompleted: number;
  bytesTotal: number;
  bytesUploaded: number;
  /** Rolling 3-second average in bytes/s */
  speedBps: number;
}

export interface ActiveUpload {
  phase: UploadPhase;
  datasetId: string | null;
  datasetName: string;
  uploadId: string | null;
  jobId: string | null;
  progress: UploadProgress;
  jobStatus: JobStatus | null;
  error: string | null;
  /** For multi-folder ZIP uploads — list of all created dataset IDs. */
  createdDatasetIds: string[] | null;
}

interface UploadStore {
  upload: ActiveUpload | null;
  /** Replace the entire upload state (called by useMultipartUpload). */
  setUpload: (upload: ActiveUpload | null) => void;
  /** Patch fields on the active upload. No-op if upload is null. */
  patchUpload: (patch: Partial<ActiveUpload>) => void;
  reset: () => void;
}

const INITIAL_PROGRESS: UploadProgress = {
  partsTotal: 0,
  partsCompleted: 0,
  bytesTotal: 0,
  bytesUploaded: 0,
  speedBps: 0,
};

export const useUploadStore = create<UploadStore>((set, get) => ({
  upload: null,

  setUpload: (upload) => set({ upload }),

  patchUpload: (patch) => {
    const { upload } = get();
    if (!upload) return;
    set({ upload: { ...upload, ...patch } });
  },

  reset: () => set({ upload: null }),
}));

export { INITIAL_PROGRESS };
