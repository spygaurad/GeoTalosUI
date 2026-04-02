'use client';

import { useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { datasetsApi } from '@/lib/api/datasets';
import { API_BASE, refreshAuthToken } from '@/lib/api/client';
import { EP } from '@/lib/api/endpoints';
import { qk } from '@/lib/query-keys';
import { useUploadStore, INITIAL_PROGRESS } from '@/stores/uploadStore';
import type { UploadPhase } from '@/stores/uploadStore';
import type { JobStatus } from '@/types/common';

const PART_CONCURRENCY = 6;           // 6 concurrent — saturate typical upload bandwidth
const POLL_INTERVAL_MS = 2500;
const SPEED_WINDOW_MS = 3000;
const PART_TIMEOUT_MS = 300_000;       // 5 min timeout per part (50 MiB @ ~1 MB/s = 50 s, generous margin)
const MAX_PART_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2_000;     // exponential backoff: 2 s, 4 s, 8 s

interface SpeedSample {
  bytes: number;
  ts: number;
}

export interface StartUploadOptions {
  file: File;
  name: string;
  tags?: string[];
}

/** Returns estimated seconds remaining, or null if unknown. */
function calcEta(bytesRemaining: number, speedBps: number): number | null {
  if (speedBps <= 0 || bytesRemaining <= 0) return null;
  return Math.round(bytesRemaining / speedBps);
}

/** Format seconds to "X min Y s" or "Xs" */
export function formatEta(seconds: number | null): string {
  if (seconds === null) return '';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m} min ${s}s` : `${m} min`;
}

/** Format bytes/s to human-readable speed */
export function formatSpeed(bps: number): string {
  if (bps === 0) return '';
  if (bps < 1024) return `${bps} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
}

export function useMultipartUpload() {
  const queryClient = useQueryClient();
  const { setUpload, patchUpload, upload, reset } = useUploadStore();

  const abortControllerRef = useRef<AbortController | null>(null);
  const speedSamplesRef = useRef<SpeedSample[]>([]);
  const phaseRef = useRef<UploadPhase>('idle');

  // Job polling — only active when phase is 'ingesting'
  const jobId = upload?.jobId ?? null;
  const isIngesting = upload?.phase === 'ingesting';

  useQuery({
    queryKey: qk.jobs.detail(jobId ?? ''),
    queryFn: () => datasetsApi.getTileJson(jobId!), // placeholder — use jobsApi below
    enabled: false, // handled manually via refetchInterval pattern
  });

  // We poll the job manually in the uploading logic using a setTimeout loop
  // rather than react-query to keep the state machine self-contained.

  const setPhase = useCallback(
    (phase: UploadPhase) => {
      phaseRef.current = phase;
      patchUpload({ phase });
    },
    [patchUpload],
  );

  // Per-part byte tracking — allows concurrent parts without double-counting
  // on retries.  Key = partNumber, value = bytes uploaded so far for that part.
  const partBytesRef = useRef<Map<number, number>>(new Map());

  const updateProgress = useCallback(
    (partNumber: number, loadedForPart: number) => {
      const prev = partBytesRef.current.get(partNumber) ?? 0;
      const delta = loadedForPart - prev;
      if (delta <= 0) return;              // no new bytes — skip
      partBytesRef.current.set(partNumber, loadedForPart);

      const now = Date.now();
      speedSamplesRef.current.push({ bytes: delta, ts: now });
      const cutoff = now - SPEED_WINDOW_MS;
      speedSamplesRef.current = speedSamplesRef.current.filter((s) => s.ts > cutoff);
      const totalBytes = speedSamplesRef.current.reduce((sum, s) => sum + s.bytes, 0);
      const windowMs = now - (speedSamplesRef.current[0]?.ts ?? now);
      const speedBps = windowMs > 0 ? Math.round((totalBytes / windowMs) * 1000) : 0;

      // Sum all per-part loaded values for the global bytesUploaded
      let bytesUploaded = 0;
      for (const v of partBytesRef.current.values()) bytesUploaded += v;

      patchUpload({
        progress: {
          ...useUploadStore.getState().upload!.progress,
          speedBps,
          bytesUploaded,
        },
      });
    },
    [patchUpload],
  );

  const pollJob = useCallback(
    async (jobId: string, datasetId: string) => {
      const { apiClient } = await import('@/lib/api/client');
      const { EP } = await import('@/lib/api/endpoints');

      const poll = async (): Promise<void> => {
        if (phaseRef.current !== 'ingesting') return;

        try {
          const job = await apiClient.get(EP.jobs.detail(jobId)).json<{
            id: string;
            status: JobStatus;
            error: string | null;
            input_params: Record<string, unknown>;
          }>();

          patchUpload({ jobStatus: job.status });

          if (job.status === 'completed') {
            // Multi-folder ZIP uploads store all created dataset IDs in input_params
            const createdIds = Array.isArray(job.input_params?.created_dataset_ids)
              ? (job.input_params.created_dataset_ids as string[])
              : null;
            patchUpload({ createdDatasetIds: createdIds });
            setPhase('ready');
            queryClient.invalidateQueries({ queryKey: qk.datasets.list() });
            queryClient.invalidateQueries({ queryKey: qk.datasets.detail(datasetId) });
            if (createdIds && createdIds.length > 1) {
              for (const id of createdIds) {
                queryClient.invalidateQueries({ queryKey: qk.datasets.detail(id) });
              }
            }
            toast.success(
              createdIds && createdIds.length > 1
                ? `${createdIds.length} datasets ready`
                : 'Dataset ready',
            );
            return;
          }

          if (job.status === 'failed') {
            setPhase('failed');
            patchUpload({ error: job.error ?? 'Ingestion failed' });
            toast.error('Ingestion failed — check dataset for details');
            return;
          }

          // Still running — keep polling
          setTimeout(poll, POLL_INTERVAL_MS);
        } catch {
          setTimeout(poll, POLL_INTERVAL_MS);
        }
      };

      setTimeout(poll, POLL_INTERVAL_MS);
    },
    [patchUpload, queryClient, setPhase],
  );

  const start = useCallback(
    async ({ file, name, tags = [] }: StartUploadOptions) => {
      abortControllerRef.current = new AbortController();
      speedSamplesRef.current = [];
      partBytesRef.current = new Map();
      phaseRef.current = 'creating';

      setUpload({
        phase: 'creating',
        datasetId: null,
        datasetName: name,
        uploadId: null,
        jobId: null,
        progress: { ...INITIAL_PROGRESS, bytesTotal: file.size },
        jobStatus: null,
        error: null,
        createdDatasetIds: null,
      });

      try {
        // ── Step 1: Create dataset metadata ─────────────────────────────────
        const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
        // zip may contain COG rasters or shapefiles; caller passes datasetType to disambiguate.
        // Default: tif/tiff/geotiff/zip → raster, geojson/json → vector.
        const datasetType = (ext === 'geojson' || ext === 'json') ? 'vector' : 'raster';
        const dataset = await datasetsApi.create({
          name,
          dataset_type: datasetType,
        });

        // tags not supported in current API — skip

        patchUpload({ datasetId: dataset.id, phase: 'initiating' });
        phaseRef.current = 'initiating';

        // ── Step 2: Initiate multipart upload ────────────────────────────────
        const contentTypeMap: Record<string, string> = {
          tif: 'image/tiff', tiff: 'image/tiff', geotiff: 'image/tiff',
          geojson: 'application/geo+json', json: 'application/geo+json',
          zip: 'application/zip',
        };
        const contentType = contentTypeMap[ext] ?? (file.type || 'application/octet-stream');
        const initResp = await datasetsApi.uploadInitiate(dataset.id, {
          filename: file.name,
          file_size_bytes: file.size,
          content_type: contentType,
        });

        const { upload_id, job_id, part_size_bytes, total_parts: totalParts } = initResp;

        patchUpload({
          uploadId: upload_id,
          jobId: job_id,
          phase: 'uploading',
          progress: {
            ...useUploadStore.getState().upload!.progress,
            partsTotal: totalParts,
          },
        });
        phaseRef.current = 'uploading';

        // ── Steps 3+4: Upload parts via API proxy ────────────────────────────
        // Instead of presigned MinIO URLs (which fail with port-forwarding and
        // MinIO Community CORS limitations), we PUT parts through the API proxy:
        //   PUT /datasets/{id}/uploads/{uploadId}/parts/{partNumber}
        // The proxy forwards bytes to MinIO internally. The upload_id acts as a
        // capability token — no JWT required on the proxy endpoint itself.
        let partsCompleted = 0;

        // Master signal for user-initiated abort
        const masterSignal = abortControllerRef.current.signal;

        /** Build proxy URL for a part upload. No presigned URL needed. */
        const proxyPartUrl = (partNumber: number): string =>
          `${API_BASE}/${EP.datasets.uploadPartProxy(dataset.id, upload_id, partNumber)}`;

        const uploadPartWithRetry = async (partNumber: number): Promise<void> => {
          const partStart = (partNumber - 1) * part_size_bytes;
          const partEnd = Math.min(partStart + part_size_bytes, file.size);
          const partBytes = partEnd - partStart;
          const url = proxyPartUrl(partNumber);

          for (let attempt = 0; attempt <= MAX_PART_RETRIES; attempt++) {
            if (masterSignal.aborted) throw new DOMException('Aborted', 'AbortError');

            // Per-part timeout that also respects master abort
            const partAbort = new AbortController();
            const timeoutId = setTimeout(() => partAbort.abort(), PART_TIMEOUT_MS);
            const onMasterAbort = () => partAbort.abort();
            masterSignal.addEventListener('abort', onMasterAbort, { once: true });

            // Hoisted so finally{} can always clear it
            let interpolateTimer: ReturnType<typeof setInterval> | null = null;

            try {
              const blob = file.slice(partStart, partEnd);

              // Reset per-part byte counter on each attempt
              partBytesRef.current.set(partNumber, 0);

              // Interpolate progress while the PUT is in flight so the bar
              // moves smoothly instead of jumping on part completion.
              const estBytesPerSec = (() => {
                const s = useUploadStore.getState().upload?.progress.speedBps;
                return s && s > 0 ? s : 5 * 1024 * 1024; // default 5 MB/s
              })();
              const estDurationMs = (partBytes / estBytesPerSec) * 1000;
              const putStartTime = Date.now();
              interpolateTimer = setInterval(() => {
                const elapsed = Date.now() - putStartTime;
                const fraction = Math.min(elapsed / estDurationMs, 0.8);
                const simulated = Math.round(partBytes * fraction);
                updateProgress(partNumber, simulated);
              }, 250);

              // PUT to API proxy — no auth needed on this endpoint (upload_id
              // is the capability token), but we don't send Bearer either to
              // avoid unnecessary overhead.
              const response = await fetch(url, {
                method: 'PUT',
                body: blob,
                signal: partAbort.signal,
              });

              clearInterval(interpolateTimer);
              interpolateTimer = null;

              if (!response.ok) {
                throw new Error(`Part ${partNumber} HTTP ${response.status}`);
              }

              // Snap to exact final byte count
              updateProgress(partNumber, partBytes);
              partsCompleted += 1;
              patchUpload({
                progress: {
                  ...useUploadStore.getState().upload!.progress,
                  partsCompleted,
                },
              });
              return;
            } catch (err) {
              if (masterSignal.aborted) {
                throw new DOMException('Aborted', 'AbortError');
              }

              const isLastAttempt = attempt === MAX_PART_RETRIES;
              if (isLastAttempt) {
                throw new Error(
                  `Part ${partNumber} failed after ${MAX_PART_RETRIES + 1} attempts: ${
                    err instanceof Error ? err.message : 'unknown error'
                  }`,
                );
              }

              const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
              console.warn(
                `Part ${partNumber} attempt ${attempt + 1} failed, retrying in ${delay}ms…`,
                err instanceof Error ? err.message : err,
              );
              await new Promise((r) => setTimeout(r, delay));
            } finally {
              if (interpolateTimer) clearInterval(interpolateTimer);
              clearTimeout(timeoutId);
              masterSignal.removeEventListener('abort', onMasterAbort);
            }
          }
        };

        // Concurrency pool — 6 concurrent × 50 MiB = 300 MiB in-flight max
        const allPartNumbers = Array.from({ length: totalParts }, (_, i) => i + 1);
        const queue = [...allPartNumbers];
        const active = new Set<Promise<void>>();

        while (queue.length > 0 || active.size > 0) {
          while (active.size < PART_CONCURRENCY && queue.length > 0) {
            const partNum = queue.shift()!;
            const p = uploadPartWithRetry(partNum).finally(() => active.delete(p));
            active.add(p);
          }
          if (active.size > 0) await Promise.race(active);
        }

        // ── Step 5: Complete upload + enqueue ingestion ────────────────────
        patchUpload({ phase: 'completing' });
        phaseRef.current = 'completing';

        // Force a fresh Clerk JWT before the authenticated complete call.
        // Upload may have taken minutes, far exceeding the 30 s token cache
        // and possibly the 60 s JWT lifetime itself.
        await refreshAuthToken();

        // Parts were uploaded via API proxy — ETags are collected server-side
        // via list_parts, so we pass null here.
        const completeResp = await datasetsApi.uploadComplete(dataset.id, upload_id, null);

        patchUpload({
          jobId: completeResp.job_id,
          phase: 'ingesting',
          jobStatus: 'pending',
        });
        phaseRef.current = 'ingesting';

        // ── Step 6: Poll job until completed / failed ─────────────────────
        await pollJob(completeResp.job_id, dataset.id);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          phaseRef.current = 'aborted';
          patchUpload({ phase: 'aborted' });
          return;
        }
        const msg = err instanceof Error ? err.message : 'Upload failed';
        phaseRef.current = 'failed';
        patchUpload({ phase: 'failed', error: msg });
        toast.error(msg);
      }
    },
    [setUpload, patchUpload, pollJob, updateProgress],
  );

  const abort = useCallback(async () => {
    abortControllerRef.current?.abort();
    const { upload: current } = useUploadStore.getState();
    if (current?.datasetId && current?.uploadId) {
      try {
        await datasetsApi.uploadAbort(current.datasetId, current.uploadId);
      } catch {
        // best effort
      }
    }
    phaseRef.current = 'aborted';
    patchUpload({ phase: 'aborted' });
  }, [patchUpload]);

  const retryIngestion = useCallback(async () => {
    const { upload: current } = useUploadStore.getState();
    if (!current?.jobId || current.phase !== 'failed') return;
    try {
      const { apiClient } = await import('@/lib/api/client');
      const { EP } = await import('@/lib/api/endpoints');
      await apiClient.post(EP.jobs.retry(current.jobId));
      patchUpload({ phase: 'ingesting', jobStatus: 'pending', error: null });
      phaseRef.current = 'ingesting';
      await pollJob(current.jobId, current.datasetId!);
    } catch {
      toast.error('Retry failed');
    }
  }, [patchUpload, pollJob]);

  const dismiss = useCallback(() => {
    reset();
    phaseRef.current = 'idle';
    speedSamplesRef.current = [];
    partBytesRef.current = new Map();
  }, [reset]);

  return { start, abort, retryIngestion, dismiss, upload, calcEta, formatEta, formatSpeed };
}
