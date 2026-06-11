'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  ChevronRight,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Clock,
  Map,
  Download,
  Copy,
  Check,
  X,
  Search,
  MapPin,
  ExternalLink,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { datasetsApi } from '@/lib/api/datasets';
import { datasetItemLabel } from '@/features/datasets/itemLabel';
import { SegmentationClassMapper } from '@/features/datasets/components/SegmentationClassMapper';
import { stacApi } from '@/lib/api/stac';
import { mapsApi } from '@/lib/api/maps';
import { projectsApi } from '@/lib/api/projects';
import { qk } from '@/lib/query-keys';
import type { Dataset, DatasetStatus, ProjectMap } from '@/types/api';

// Mini-map: ssr:false, no controls, just shows the footprint
const FootprintMiniMap = dynamic(() => import('./FootprintMiniMap'), { ssr: false, loading: () => <MiniMapSkeleton /> });

// ── Color palette ─────────────────────────────────────────────────────────────
const C = {
  bg: '#faf8f4',
  border: '#e8d8c4',
  borderAccent: '#dcc9b2',
  text: '#2e3428',
  textSec: '#6a5c4e',
  textMuted: '#9a8878',
  accent: '#7f5539',
  accentLight: '#e8d5b8',
  accentDim: 'rgba(127,85,57,0.08)',
  success: '#4a7a4a',
  warning: '#a68a64',
  danger: '#b35e4c',
};

const STATUS_CONFIG: Record<DatasetStatus, { label: string; color: string; icon: React.ReactNode }> = {
  ready:     { label: 'Ready',     color: C.success,   icon: <CheckCircle2 size={13} /> },
  ingesting: { label: 'Ingesting', color: C.warning,   icon: <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> },
  pending:   { label: 'Pending',   color: C.textMuted, icon: <Clock size={13} /> },
  failed:    { label: 'Failed',    color: C.danger,    icon: <AlertCircle size={13} /> },
};

function MiniMapSkeleton() {
  return (
    <div style={{
      width: '100%',
      aspectRatio: '4/3',
      background: '#2e3428',
      borderRadius: 8,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <Loader2 size={20} style={{ color: 'rgba(196,152,92,0.5)', animation: 'spin 1s linear infinite' }} />
    </div>
  );
}

function MetaRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: 12,
      padding: '8px 0',
      borderBottom: `1px solid ${C.border}`,
    }}>
      <span style={{ fontSize: '0.8125rem', color: C.textMuted, flexShrink: 0, paddingTop: 1 }}>{label}</span>
      <span style={{
        fontSize: mono ? '0.75rem' : '0.8125rem',
        fontFamily: mono ? 'monospace' : 'inherit',
        color: C.text,
        textAlign: 'right',
        wordBreak: 'break-all',
      }}>
        {value}
      </span>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      onClick={copy}
      title="Copy"
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        color: copied ? C.success : C.textMuted,
        padding: '0 2px',
        display: 'inline-flex',
        alignItems: 'center',
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// ── Add to Map modal ──────────────────────────────────────────────────────────
function AddToMapModal({
  dataset,
  workspaceId,
  onClose,
}: {
  dataset: Dataset;
  workspaceId: string;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [addedMaps, setAddedMaps] = useState<Set<string>>(new Set());

  const { data: mapsData, isLoading: mapsLoading } = useQuery({
    queryKey: ['add-to-map-modal', 'maps'],
    queryFn: () => mapsApi.list(),
    staleTime: 30_000,
  });

  const { data: projectsData } = useQuery({
    queryKey: ['add-to-map-modal', 'projects'],
    queryFn: () => projectsApi.list(),
    staleTime: 30_000,
  });

  const maps = mapsData?.items ?? [];
  const projectById = Object.fromEntries((projectsData?.items ?? []).map((p) => [p.id, p.name]));

  const filtered = maps.filter((m) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      m.name.toLowerCase().includes(q) ||
      (projectById[m.project_id] ?? '').toLowerCase().includes(q)
    );
  });

  const addMutation = useMutation({
    mutationFn: async (map: ProjectMap) => {
      await datasetsApi.addMapLayer(map.id, {
        name: dataset.name,
        layer_type: 'raster', // Datasets are always raster (COG imagery)
        source_type: 'dataset',
        dataset_id: dataset.id,
        opacity: 1.0,
        visible: true,
      });
      return map;
    },
    onSuccess: (map) => {
      setAddedMaps((prev) => new Set([...prev, map.id]));
      const mapUrl = `/workspace/${workspaceId}/projects/${map.project_id}/maps/${map.id}`;
      toast.success(`"${dataset.name}" added to "${map.name}"`, {
        action: { label: 'Open map', onClick: () => window.open(mapUrl, '_blank') },
        duration: 6000,
      });
    },
    onError: () => toast.error('Failed to add dataset to map'),
  });

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(28,33,25,0.45)',
          zIndex: 200,
        }}
      />

      {/* Panel */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(480px, calc(100vw - 32px))',
          maxHeight: 'min(600px, calc(100vh - 64px))',
          background: '#faf8f4',
          border: `1px solid ${C.borderAccent}`,
          borderRadius: 12,
          boxShadow: '0 24px 64px rgba(28,33,25,0.22)',
          zIndex: 201,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          height: 52,
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px 0 20px',
          borderBottom: `1px solid ${C.border}`,
          flexShrink: 0,
          gap: 10,
        }}>
          <MapPin size={15} style={{ color: C.accent, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.9375rem', fontWeight: 600, color: C.text }}>Add to map</div>
            <div style={{
              fontSize: '0.75rem',
              color: C.textMuted,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {dataset.name}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, padding: 4, borderRadius: 4 }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Search */}
        <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            height: 34,
            padding: '0 10px',
            borderRadius: 7,
            border: `1px solid ${C.border}`,
            background: '#fff',
          }}>
            <Search size={13} style={{ color: C.textMuted, flexShrink: 0 }} />
            <input
              autoFocus
              type="text"
              placeholder="Search maps or projects…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                flex: 1,
                border: 'none',
                outline: 'none',
                fontSize: '0.875rem',
                color: C.text,
                background: 'transparent',
              }}
            />
            {search && (
              <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, padding: 0 }}>
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Map list */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {mapsLoading ? (
            <div style={{ padding: '32px 20px', display: 'flex', justifyContent: 'center' }}>
              <Loader2 size={18} style={{ color: C.textMuted, animation: 'spin 1s linear infinite' }} />
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center' }}>
              <Map size={24} style={{ color: C.textMuted, opacity: 0.4, margin: '0 auto 10px', display: 'block' }} />
              <p style={{ fontSize: '0.875rem', color: C.textMuted }}>
                {search ? `No maps matching "${search}"` : 'No maps found. Create a map from a project first.'}
              </p>
            </div>
          ) : (
            filtered.map((map) => {
              const projectName = projectById[map.project_id] ?? 'Unknown project';
              const isAdded = addedMaps.has(map.id);
              const isAdding = addMutation.isPending && addMutation.variables?.id === map.id;
              const mapUrl = `/workspace/${workspaceId}/projects/${map.project_id}/maps/${map.id}`;
              return (
                <div
                  key={map.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 14px',
                    borderBottom: `1px solid ${C.border}`,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: '0.875rem',
                      fontWeight: 500,
                      color: C.text,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {map.name}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: C.textMuted, marginTop: 1 }}>
                      {projectName}
                    </div>
                  </div>

                  {isAdded ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      <span style={{ fontSize: '0.75rem', color: C.success, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Check size={12} /> Added
                      </span>
                      <a
                        href={mapUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: '0.75rem',
                          color: C.accent,
                          textDecoration: 'none',
                          fontWeight: 500,
                        }}
                      >
                        Open <ExternalLink size={11} />
                      </a>
                    </div>
                  ) : (
                    <button
                      onClick={() => addMutation.mutate(map)}
                      disabled={isAdding}
                      style={{
                        flexShrink: 0,
                        height: 30,
                        padding: '0 14px',
                        borderRadius: 6,
                        border: `1.5px solid ${C.accent}`,
                        background: C.accentDim,
                        color: C.accent,
                        fontSize: '0.8125rem',
                        fontWeight: 600,
                        cursor: isAdding ? 'default' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        opacity: isAdding ? 0.6 : 1,
                        transition: 'opacity 0.1s',
                      }}
                    >
                      {isAdding ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Map size={12} />}
                      {isAdding ? 'Adding…' : 'Add'}
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer hint */}
        <div style={{
          padding: '8px 14px',
          borderTop: `1px solid ${C.border}`,
          fontSize: '0.75rem',
          color: C.textMuted,
          flexShrink: 0,
        }}>
          {maps.length} map{maps.length !== 1 ? 's' : ''} across {(projectsData?.items ?? []).length} project{(projectsData?.items ?? []).length !== 1 ? 's' : ''}
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}

interface DatasetDetailContentProps {
  workspaceId: string;
  datasetId: string;
}

export function DatasetDetailContent({ workspaceId, datasetId }: DatasetDetailContentProps) {
  const [showAddToMap, setShowAddToMap] = useState(false);
  const [showClassMapper, setShowClassMapper] = useState(false);

  const { data: dataset, isLoading } = useQuery({
    queryKey: qk.datasets.detail(datasetId),
    queryFn: () => datasetsApi.get(datasetId),
    // Refetch while ingesting
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === 'ingesting' || s === 'pending' ? 3000 : false;
    },
  });

  const { data: items, isLoading: itemsLoading } = useQuery({
    queryKey: qk.datasets.items(datasetId),
    queryFn: () => datasetsApi.listItems(datasetId, { page_size: 25 }),
    enabled: dataset?.status === 'ready',
  });

  const { data: stacItems } = useQuery({
    queryKey: ['dataset-detail', 'stac-items', dataset?.stac_collection_id ?? ''],
    queryFn: () => stacApi.listCollectionItems(dataset!.stac_collection_id!, { limit: 200 }),
    enabled: dataset?.status === 'ready' && !!dataset?.stac_collection_id,
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '40px 24px' }}>
        <div style={{ height: 14, width: 200, background: C.accentLight, borderRadius: 4, marginBottom: 20 }} />
        <div style={{ height: 36, width: 340, background: C.accentLight, borderRadius: 6, marginBottom: 8 }} />
        <div style={{ height: 16, width: 240, background: '#f0e4d4', borderRadius: 4 }} />
      </div>
    );
  }

  if (!dataset) {
    return (
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '40px 24px', color: C.textMuted, fontSize: '0.9375rem' }}>
        Dataset not found.
      </div>
    );
  }

  const s = STATUS_CONFIG[dataset.status] ?? STATUS_CONFIG.pending;

  const stacMetaById = new globalThis.Map<string, { datetime?: string; cloud?: number }>();
  for (const f of stacItems?.features ?? []) {
    const props = f.properties ?? {};
    const rawCloud = (props['eo:cloud_cover'] as number | undefined) ?? (props['cloud_cover'] as number | undefined);
    stacMetaById.set(f.id, {
      datetime: props.datetime as string | undefined,
      cloud: typeof rawCloud === 'number' ? rawCloud : undefined,
    });
  }

  const stacDatetimes = Array.from(stacMetaById.values())
    .map((m: { datetime?: string; cloud?: number }) => m.datetime)
    .filter((d): d is string => !!d)
    .sort();

  const temporal = stacDatetimes.length > 0
    ? `${new Date(stacDatetimes[0]).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}${
        stacDatetimes[stacDatetimes.length - 1] !== stacDatetimes[0]
          ? ` – ${new Date(stacDatetimes[stacDatetimes.length - 1]).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`
          : ''
      }`
    : dataset.temporal_extent?.lower
      ? `${new Date(dataset.temporal_extent.lower).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}${
          dataset.temporal_extent.upper && dataset.temporal_extent.upper !== dataset.temporal_extent.lower
            ? ` – ${new Date(dataset.temporal_extent.upper).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`
            : ''
        }`
      : null;

  return (
    <div style={{
      maxWidth: 960,
      margin: '0 auto',
      padding: '32px 24px',
      fontFamily: 'var(--font-sans, system-ui)',
    }}>
      {/* ── Breadcrumb ── */}
      <nav style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        marginBottom: 24,
        fontSize: '0.8125rem',
        color: C.textMuted,
      }}>
        <Link href={`/workspace/${workspaceId}/datasets`} style={{ color: C.textMuted, textDecoration: 'none' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = C.accent)}
          onMouseLeave={(e) => (e.currentTarget.style.color = C.textMuted)}
        >
          Datasets
        </Link>
        <ChevronRight size={13} />
        <span style={{ color: C.text, fontWeight: 500 }}>{dataset.name}</span>
      </nav>

      {/* ── Main layout: left metadata + right mini-map ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 320px',
        gap: 32,
        alignItems: 'start',
      }}>
        {/* Left */}
        <div>
          {/* Title + status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: '0.75rem',
              color: s.color,
              fontWeight: 600,
            }}>
              {s.icon}
              {s.label}
            </div>
            {dataset.metadata?.file_count != null && (
              <span style={{ fontSize: '0.75rem', color: C.textMuted }}>
                · {dataset.metadata.file_count.toLocaleString()} file{dataset.metadata.file_count !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          <h1 style={{
            fontFamily: 'var(--font-display, Georgia, serif)',
            fontSize: 'clamp(1.625rem, 3vw, 2.25rem)',
            fontWeight: 700,
            color: C.text,
            lineHeight: 1.15,
            marginBottom: temporal ? 8 : 24,
          }}>
            {dataset.name}
          </h1>

          {temporal && (
            <p style={{ fontSize: '0.9375rem', color: C.textSec, marginBottom: 28 }}>{temporal}</p>
          )}

          {/* Dataset type badge */}
          <div style={{ marginBottom: 24 }}>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              fontSize: '0.75rem',
              padding: '3px 9px',
              borderRadius: 12,
              border: `1px solid ${C.borderAccent}`,
              color: C.accent,
              background: C.accentLight,
              fontWeight: 500,
              textTransform: 'capitalize',
            }}>
              {dataset.dataset_type}
            </span>
          </div>

          {/* Segmentation mask: define value→class mapping (works for old masks too) */}
          {dataset.dataset_type === 'segmentation_mask' && dataset.status === 'ready' && (
            <div style={{ marginBottom: 24 }}>
              {!showClassMapper ? (
                <button
                  onClick={() => setShowClassMapper(true)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                    padding: '7px 12px',
                    borderRadius: 6,
                    border: `1px solid ${C.borderAccent}`,
                    color: C.accent,
                    background: C.accentLight,
                    cursor: 'pointer',
                  }}
                >
                  {dataset.metadata?.rendering_config?.class_map ? 'Edit class mapping' : 'Map mask classes'}
                </button>
              ) : (
                <SegmentationClassMapper datasetId={datasetId} />
              )}
            </div>
          )}

          {/* Metadata section */}
          <section style={{ marginBottom: 32 }}>
            <h2 style={{
              fontSize: '0.6875rem',
              fontWeight: 700,
              letterSpacing: '0.09em',
              textTransform: 'uppercase',
              color: C.textMuted,
              marginBottom: 4,
            }}>
              Metadata
            </h2>

            {dataset.stac_collection_id && (
              <MetaRow
                label="STAC Collection"
                value={
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ fontFamily: 'monospace', fontSize: '0.6875rem' }} title={dataset.stac_collection_id}>
                      {dataset.stac_collection_id.length > 32
                        ? `…${dataset.stac_collection_id.slice(-28)}`
                        : dataset.stac_collection_id}
                    </span>
                    <CopyButton text={dataset.stac_collection_id} />
                  </span>
                }
              />
            )}

            {dataset.metadata?.native_crs?.[0] && (
              <MetaRow label="CRS" value={dataset.metadata.native_crs[0]} mono />
            )}
            {dataset.metadata?.gsd_min != null && (
              <MetaRow label="GSD" value={`${dataset.metadata.gsd_min.toFixed(4)} m/px`} />
            )}
            {dataset.metadata?.total_size_bytes != null && dataset.metadata.total_size_bytes > 0 && (
              <MetaRow label="Size" value={formatBytes(dataset.metadata.total_size_bytes)} />
            )}

            <MetaRow label="Created" value={new Date(dataset.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} />
            <MetaRow label="Last updated" value={new Date(dataset.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} />
          </section>

          {/* STAC Items */}
          {dataset.status === 'ready' && (
            <section>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <h2 style={{
                  fontSize: '0.6875rem',
                  fontWeight: 700,
                  letterSpacing: '0.09em',
                  textTransform: 'uppercase',
                  color: C.textMuted,
                }}>
                  STAC Items
                </h2>
              </div>

              <div style={{
                border: `1px solid ${C.borderAccent}`,
                borderRadius: 8,
                overflow: 'hidden',
              }}>
                {/* Column headers */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 160px 80px',
                  padding: '0 14px',
                  height: 32,
                  alignItems: 'center',
                  borderBottom: `1px solid ${C.borderAccent}`,
                  background: '#f5ede0',
                }}>
                  {['STAC Item ID', 'Date', 'Cloud %'].map((col) => (
                    <div key={col} style={{
                      fontSize: '0.625rem',
                      fontWeight: 700,
                      letterSpacing: '0.07em',
                      textTransform: 'uppercase',
                      color: C.textMuted,
                    }}>
                      {col}
                    </div>
                  ))}
                </div>

                {itemsLoading ? (
                  <div style={{ padding: '14px', display: 'flex', justifyContent: 'center' }}>
                    <Loader2 size={16} style={{ color: C.textMuted, animation: 'spin 1s linear infinite' }} />
                  </div>
                ) : (items?.items ?? []).length === 0 ? (
                  <div style={{ padding: '24px 14px', fontSize: '0.875rem', color: C.textMuted, textAlign: 'center' }}>
                    No items found.
                  </div>
                ) : (
                  (items?.items ?? []).map((item) => {
                    const stacMeta = stacMetaById.get(item.stac_item_id);
                    const dtValue = stacMeta?.datetime ?? item.datetime;
                    const dt = dtValue
                      ? new Date(dtValue).toLocaleString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })
                      : '—';
                    const cloud = stacMeta?.cloud ?? (item.properties_cache as Record<string, unknown>)?.['eo:cloud_cover'];
                    return (
                      <div
                        key={item.id}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 160px 80px',
                          padding: '0 14px',
                          height: 42,
                          alignItems: 'center',
                          borderBottom: `1px solid ${C.border}`,
                        }}
                      >
                        <span title={item.stac_item_id} style={{ fontSize: '0.8125rem', color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {datasetItemLabel(item)}
                        </span>
                        <span style={{ fontSize: '0.8125rem', color: C.textSec }}>{dt}</span>
                        <span style={{ fontSize: '0.8125rem', color: C.textSec }}>
                          {cloud != null ? `${Number(cloud).toFixed(1)}%` : '—'}
                        </span>
                      </div>
                    );
                  })
                )}

                {items && items.total > items.items.length && (
                  <div style={{
                    padding: '10px 14px',
                    fontSize: '0.8125rem',
                    color: C.textMuted,
                    textAlign: 'center',
                    borderTop: `1px solid ${C.border}`,
                  }}>
                    Showing {items.items.length} of {items.total.toLocaleString()} items
                  </div>
                )}
              </div>
            </section>
          )}
        </div>

        {/* Right — mini-map + actions */}
        <div style={{ position: 'sticky', top: 24 }}>
          {/* Mini-map */}
          <div style={{ marginBottom: 14 }}>
            {dataset.geometry ? (
              <FootprintMiniMap spatialExtent={dataset.geometry} />
            ) : (
              <div style={{
                aspectRatio: '4/3',
                background: '#2e3428',
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.8125rem',
                color: 'rgba(196,152,92,0.45)',
              }}>
                No spatial extent
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              onClick={() => setShowAddToMap(true)}
              disabled={dataset.status !== 'ready'}
              title={dataset.status !== 'ready' ? 'Dataset must be ready before adding to a map' : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 7,
                height: 38,
                borderRadius: 8,
                border: 'none',
                background: dataset.status === 'ready' ? C.accent : C.accentLight,
                color: dataset.status === 'ready' ? '#faf8f4' : C.textMuted,
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: dataset.status === 'ready' ? 'pointer' : 'not-allowed',
              }}
            >
              <Map size={14} />
              Add to map
            </button>

            <button
              onClick={() => datasetsApi.getDownloadUrl(datasetId).then((r) => window.open(r.download_url, '_blank')).catch(() => {})}
              disabled={dataset.status !== 'ready'}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 7,
                height: 34,
                borderRadius: 7,
                border: `1px solid ${C.borderAccent}`,
                background: 'transparent',
                color: dataset.status === 'ready' ? C.textSec : C.textMuted,
                fontSize: '0.8125rem',
                cursor: dataset.status === 'ready' ? 'pointer' : 'default',
              }}
            >
              <Download size={13} />
              Download
            </button>
          </div>

          {showAddToMap && (
            <AddToMapModal
              dataset={dataset}
              workspaceId={workspaceId}
              onClose={() => setShowAddToMap(false)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
