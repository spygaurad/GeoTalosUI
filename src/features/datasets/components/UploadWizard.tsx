'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  UploadCloud,
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Plus,
  ArrowRight,
  RotateCcw,
  Map,
} from 'lucide-react';
import { MC } from '@/features/maps/mapColors';
import {
  useMultipartUpload,
  formatEta,
  formatSpeed,
} from '@/features/datasets/hooks/useMultipartUpload';
import { useUploadStore } from '@/stores/uploadStore';
import type { UploadPhase } from '@/stores/uploadStore';

const ACCEPTED_TYPES = [
  'image/tiff',
  'image/geotiff',
  'application/geo+json',
  'application/json',
  'application/zip',
  'application/octet-stream',
];

const ACCEPTED_EXTENSIONS = ['.tif', '.tiff', '.geotiff', '.geojson', '.json', '.zip'];


function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function nameFromFile(filename: string): string {
  return filename
    .replace(/\.(tif|tiff|geotiff|geojson|json|zip)$/i, '')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Ingestion sub-steps ───────────────────────────────────────────────────────
// Approximated from the backend Celery task docs.
const INGEST_STEPS = [
  { label: 'COG validation', durationMs: 6_000 },
  { label: 'Metadata extraction', durationMs: 12_000 },
  { label: 'STAC registration', durationMs: 22_000 },
  { label: 'Dataset update', durationMs: 30_000 },
];

function IngestStep({
  label,
  state,
}: {
  label: string;
  state: 'done' | 'running' | 'pending';
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
      <div style={{ width: 18, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
        {state === 'done' && <CheckCircle2 size={14} style={{ color: MC.success }} />}
        {state === 'running' && (
          <Loader2 size={14} style={{ color: MC.navAccent, animation: 'spin 1s linear infinite' }} />
        )}
        {state === 'pending' && (
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            border: `1.5px solid ${MC.borderLight}`,
          }} />
        )}
      </div>
      <span style={{
        fontSize: 13,
        color: state === 'pending' ? MC.textMuted : MC.text,
        transition: 'color 0.2s',
      }}>
        {label}
      </span>
    </div>
  );
}

// ── File drop zone ────────────────────────────────────────────────────────────
function FileDropZone({ onFile }: { onFile: (f: File) => void }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files[0];
      if (f) onFile(f);
    },
    [onFile],
  );

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      style={{
        border: `1.5px dashed ${dragging ? MC.accent : MC.border}`,
        borderRadius: 8,
        padding: '28px 20px',
        textAlign: 'center',
        background: dragging ? MC.accentDim : MC.inputBg,
        cursor: 'pointer',
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      <UploadCloud
        size={28}
        style={{ color: dragging ? MC.accent : MC.textMuted, marginBottom: 10, display: 'block', margin: '0 auto 10px' }}
      />
      <div style={{ fontSize: 13, fontWeight: 600, color: MC.text, marginBottom: 4 }}>
        Drop file here or <span style={{ color: MC.accent }}>browse</span>
      </div>
      <div style={{ fontSize: 11, color: MC.textMuted }}>
        GeoTIFF · COG · GeoJSON · Shapefile (zip)
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_EXTENSIONS.join(',')}
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) { onFile(f); e.target.value = ''; }
        }}
      />
    </div>
  );
}

// ── Tag input ─────────────────────────────────────────────────────────────────
function TagInput({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const t = draft.trim().toLowerCase().replace(/\s+/g, '-');
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setDraft('');
  };

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
        {tags.map((tag) => (
          <span
            key={tag}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              padding: '2px 7px 2px 8px',
              borderRadius: 10,
              background: MC.accentDim,
              border: `1px solid ${MC.accent}`,
              color: MC.accent,
            }}
          >
            {tag}
            <button
              onClick={() => onChange(tags.filter((t) => t !== tag))}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: MC.accent, padding: 0, lineHeight: 1 }}
            >
              <X size={10} />
            </button>
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } }}
          placeholder="e.g. sentinel-2, optical"
          style={{
            flex: 1,
            background: MC.inputBg,
            border: `1px solid ${MC.inputBorder}`,
            borderRadius: 5,
            padding: '5px 9px',
            fontSize: 12,
            color: MC.text,
            outline: 'none',
          }}
        />
        <button
          onClick={add}
          disabled={!draft.trim()}
          style={{
            width: 28, height: 28,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: draft.trim() ? MC.accentDim : 'transparent',
            border: `1px solid ${draft.trim() ? MC.accent : MC.borderLight}`,
            borderRadius: 5,
            color: draft.trim() ? MC.accent : MC.textMuted,
            cursor: draft.trim() ? 'pointer' : 'default',
          }}
        >
          <Plus size={13} />
        </button>
      </div>
    </div>
  );
}

// ── Main UploadWizard ─────────────────────────────────────────────────────────

interface UploadWizardProps {
  mapId?: string;
  /** Called when upload is ready — passes dataset id */
  onAddToMap?: (datasetId: string) => void;
  onViewDataset?: (datasetId: string) => void;
}

export function UploadWizard({ onAddToMap, onViewDataset }: UploadWizardProps) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [tags, setTags] = useState<string[]>([]);

  const { start, abort, retryIngestion, dismiss } = useMultipartUpload();
  const upload = useUploadStore((s) => s.upload);

  const phase: UploadPhase = upload?.phase ?? 'idle';
  const progress = upload?.progress;
  const isActive = phase !== 'idle' && phase !== 'ready' && phase !== 'failed' && phase !== 'aborted';

  // Ingestion step animation — advance through steps based on time elapsed
  const [ingestStep, setIngestStep] = useState(0);
  const ingestStartRef = useRef<number | null>(null);

  useEffect(() => {
    if (phase === 'ingesting') {
      if (!ingestStartRef.current) ingestStartRef.current = Date.now();
      const timer = setInterval(() => {
        const elapsed = Date.now() - (ingestStartRef.current ?? Date.now());
        let step = 0;
        let cumulative = 0;
        for (const s of INGEST_STEPS) {
          cumulative += s.durationMs;
          if (elapsed > cumulative) step++;
        }
        setIngestStep(Math.min(step, INGEST_STEPS.length - 1));
      }, 500);
      return () => clearInterval(timer);
    } else {
      ingestStartRef.current = null;
      if (phase === 'ready') setIngestStep(INGEST_STEPS.length);
    }
  }, [phase]);

  const handleFileSelect = (f: File) => {
    setFile(f);
    if (!name) setName(nameFromFile(f.name));
  };

  const handleStart = () => {
    if (!file || !name.trim()) return;
    start({ file, name: name.trim(), tags });
  };

  const handleDismiss = () => {
    dismiss();
    setFile(null);
    setName('');
    setTags([]);
    setIngestStep(0);
  };

  const pct = progress && progress.bytesTotal > 0
    ? Math.round((progress.bytesUploaded / progress.bytesTotal) * 100)
    : 0;

  const eta = progress
    ? formatEta(
        progress.bytesTotal - progress.bytesUploaded > 0
          ? Math.round((progress.bytesTotal - progress.bytesUploaded) / Math.max(progress.speedBps, 1))
          : null,
      )
    : '';

  // ── Idle / file selection ──────────────────────────────────────────────────
  if (phase === 'idle' || phase === 'aborted') {
    return (
      <div style={{ padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <FileDropZone onFile={handleFileSelect} />

        {file && (
          <>
            <div style={{
              padding: '8px 10px',
              background: MC.hoverBg,
              borderRadius: 6,
              border: `1px solid ${MC.border}`,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}>
              <span style={{ flex: 1, fontSize: 12, color: MC.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {file.name}
              </span>
              <span style={{ fontSize: 11, color: MC.textMuted, flexShrink: 0 }}>
                {formatBytes(file.size)}
              </span>
              <button
                onClick={() => { setFile(null); setName(''); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: MC.textMuted, padding: 0 }}
              >
                <X size={12} />
              </button>
            </div>

            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: MC.sectionLabel, letterSpacing: '0.05em', textTransform: 'uppercase', display: 'block', marginBottom: 5 }}>
                Dataset name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Sentinel-2 Scene"
                style={{
                  width: '100%',
                  background: MC.inputBg,
                  border: `1px solid ${MC.inputBorder}`,
                  borderRadius: 5,
                  padding: '6px 10px',
                  fontSize: 13,
                  color: MC.text,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: MC.sectionLabel, letterSpacing: '0.05em', textTransform: 'uppercase', display: 'block', marginBottom: 5 }}>
                Tags <span style={{ color: MC.textMuted, fontWeight: 400, textTransform: 'none' }}>(optional)</span>
              </label>
              <TagInput tags={tags} onChange={setTags} />
            </div>

            <button
              onClick={handleStart}
              disabled={!name.trim()}
              style={{
                height: 36,
                borderRadius: 6,
                border: 'none',
                background: name.trim() ? MC.accent : MC.borderLight,
                color: name.trim() ? '#1c2119' : MC.textMuted,
                fontSize: 13,
                fontWeight: 700,
                cursor: name.trim() ? 'pointer' : 'default',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                transition: 'background 0.15s',
              }}
            >
              <UploadCloud size={14} />
              Upload
            </button>
          </>
        )}

        {phase === 'aborted' && (
          <div style={{ fontSize: 12, color: MC.textMuted, textAlign: 'center' }}>
            Upload cancelled.
          </div>
        )}
      </div>
    );
  }

  // ── Creating / Initiating ──────────────────────────────────────────────────
  if (phase === 'creating' || phase === 'initiating') {
    return (
      <div style={{ padding: '28px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <Loader2 size={22} style={{ color: MC.navAccent, animation: 'spin 1s linear infinite' }} />
        <div style={{ fontSize: 13, color: MC.textSecondary }}>
          {phase === 'creating' ? 'Registering dataset…' : 'Preparing upload…'}
        </div>
      </div>
    );
  }

  // ── Uploading ──────────────────────────────────────────────────────────────
  if (phase === 'uploading' || phase === 'completing') {
    return (
      <div style={{ padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: MC.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {upload?.datasetName}
        </div>

        {progress && (
          <>
            {/* Progress bar */}
            <div>
              <div style={{
                height: 5,
                borderRadius: 3,
                background: MC.borderLight,
                overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  width: `${pct}%`,
                  background: MC.accent,
                  borderRadius: 3,
                  transition: 'width 0.4s ease',
                }} />
              </div>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: 6,
                fontSize: 11,
                color: MC.textMuted,
              }}>
                <span>
                  {formatBytes(progress.bytesUploaded)} / {formatBytes(progress.bytesTotal)}
                  {progress.speedBps > 0 && ` · ${formatSpeed(progress.speedBps)}`}
                </span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {pct}%{eta ? ` · ~${eta}` : ''}
                </span>
              </div>
            </div>

          </>
        )}

        {phase === 'completing' && (
          <div style={{ fontSize: 12, color: MC.textMuted, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Loader2 size={12} style={{ color: MC.navAccent, animation: 'spin 1s linear infinite' }} />
            Finalizing upload…
          </div>
        )}

        <button
          onClick={abort}
          style={{
            height: 30,
            borderRadius: 5,
            border: `1px solid ${MC.border}`,
            background: 'transparent',
            color: MC.textMuted,
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          Cancel upload
        </button>
      </div>
    );
  }

  // ── Ingesting ──────────────────────────────────────────────────────────────
  if (phase === 'ingesting') {
    return (
      <div style={{ padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: MC.text }}>
          Processing dataset…
        </div>
        <div style={{ fontSize: 11, color: MC.textMuted, marginBottom: 4 }}>
          status: {upload?.jobStatus ?? 'pending'}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {INGEST_STEPS.map((step, i) => (
            <IngestStep
              key={step.label}
              label={step.label}
              state={i < ingestStep ? 'done' : i === ingestStep ? 'running' : 'pending'}
            />
          ))}
        </div>
      </div>
    );
  }

  // ── Ready ──────────────────────────────────────────────────────────────────
  if (phase === 'ready') {
    const datasetId = upload?.datasetId;
    const createdIds = upload?.createdDatasetIds;
    const isMulti = createdIds && createdIds.length > 1;

    return (
      <div style={{ padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <CheckCircle2 size={18} style={{ color: MC.success, flexShrink: 0 }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: MC.text }}>
            {isMulti ? `${createdIds.length} datasets created` : upload?.datasetName}
          </span>
        </div>
        <div style={{ fontSize: 12, color: MC.textMuted }}>
          {isMulti
            ? 'Multi-folder ZIP processed. Each folder was ingested as a separate dataset.'
            : 'Dataset ingested and ready for visualization.'}
        </div>

        {/* Multi-dataset list — show each created dataset with a view link */}
        {isMulti && onViewDataset && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 0,
            border: `1px solid ${MC.border}`,
            borderRadius: 6,
            overflow: 'hidden',
          }}>
            {createdIds.map((id) => (
              <button
                key={id}
                onClick={() => onViewDataset(id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '8px 10px',
                  borderBottom: `1px solid ${MC.border}`,
                  background: 'transparent',
                  border: 'none',
                  borderBlockEnd: `1px solid ${MC.border}`,
                  cursor: 'pointer',
                  width: '100%',
                  textAlign: 'left',
                }}
              >
                <span style={{
                  fontSize: 12,
                  fontFamily: 'monospace',
                  color: MC.textSecondary,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {id.slice(0, 8)}…
                </span>
                <ArrowRight size={11} style={{ color: MC.textMuted, flexShrink: 0 }} />
              </button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 4 }}>
          {/* Single dataset: show "Add to map" and "View dataset" */}
          {!isMulti && onAddToMap && datasetId && (
            <button
              onClick={() => onAddToMap(datasetId)}
              style={{
                height: 34,
                borderRadius: 6,
                border: 'none',
                background: MC.accent,
                color: '#1c2119',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              <Map size={13} />
              Add to this map
            </button>
          )}
          {!isMulti && onViewDataset && datasetId && (
            <button
              onClick={() => onViewDataset(datasetId)}
              style={{
                height: 30,
                borderRadius: 5,
                border: `1px solid ${MC.border}`,
                background: 'transparent',
                color: MC.textSecondary,
                fontSize: 12,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
              }}
            >
              View dataset
              <ArrowRight size={12} />
            </button>
          )}
          <button
            onClick={handleDismiss}
            style={{
              height: 28,
              borderRadius: 5,
              border: 'none',
              background: 'transparent',
              color: MC.textMuted,
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            Upload another
          </button>
        </div>
      </div>
    );
  }

  // ── Failed ────────────────────────────────────────────────────────────────
  if (phase === 'failed') {
    return (
      <div style={{ padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertCircle size={16} style={{ color: MC.danger, flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: MC.text }}>Upload failed</span>
        </div>
        {upload?.error && (
          <div style={{
            fontSize: 11,
            color: MC.danger,
            background: `${MC.danger}18`,
            border: `1px solid ${MC.danger}40`,
            borderRadius: 5,
            padding: '7px 10px',
            lineHeight: 1.5,
          }}>
            {upload.error}
          </div>
        )}
        <div style={{ display: 'flex', gap: 7 }}>
          <button
            onClick={retryIngestion}
            style={{
              flex: 1,
              height: 32,
              borderRadius: 5,
              border: `1px solid ${MC.accent}`,
              background: MC.accentDim,
              color: MC.accent,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
            }}
          >
            <RotateCcw size={12} />
            Retry
          </button>
          <button
            onClick={handleDismiss}
            style={{
              flex: 1,
              height: 32,
              borderRadius: 5,
              border: `1px solid ${MC.border}`,
              background: 'transparent',
              color: MC.textMuted,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  return null;
}
