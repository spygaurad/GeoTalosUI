'use client';

import { useQuery } from '@tanstack/react-query';
import { ExternalLink, FileImage, ChevronRight, Download } from 'lucide-react';
import { datasetsApi } from '@/lib/api/datasets';
import { qk } from '@/lib/query-keys';
import { useMapLayersStore } from '@/stores/mapLayersStore';
import { MC } from '../../mapColors';
import type { DatasetMetadata } from '@/types/api';

interface DatasetInfoPanelProps {
  datasetId: string;
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: `1px solid ${MC.border}` }}>
      <span style={{ fontSize: 11, color: MC.textMuted, flexShrink: 0, marginRight: 8 }}>{label}</span>
      <span style={{ fontSize: 11, color: MC.text, textAlign: 'right', wordBreak: 'break-all' }}>{value}</span>
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  ready:     MC.success,
  ingesting: MC.warning,
  pending:   MC.textMuted,
  failed:    MC.danger,
};

export function DatasetInfoPanel({ datasetId }: DatasetInfoPanelProps) {
  const openItemsPanel = useMapLayersStore((s) => s.openItemsPanel);

  const { data: dataset, isLoading } = useQuery({
    queryKey: qk.datasets.detail(datasetId),
    queryFn: () => datasetsApi.get(datasetId),
  });

  if (isLoading) {
    return (
      <div style={{ padding: 14 }}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} style={{
            height: 20,
            borderRadius: 4,
            background: MC.hoverBg,
            marginBottom: 8,
            width: `${60 + i * 8}%`,
          }} />
        ))}
      </div>
    );
  }

  if (!dataset) return null;

  const statusColor = STATUS_COLORS[dataset.status] ?? MC.textMuted;
  const hasItems = (dataset.metadata?.file_count ?? 0) > 1;

  const temporal = dataset.temporal_extent?.lower
    ? `${new Date(dataset.temporal_extent.lower).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}${dataset.temporal_extent.upper ? ` – ${new Date(dataset.temporal_extent.upper).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}` : ''}`
    : null;

  return (
    <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
      <div style={{ padding: '12px 14px', borderBottom: `1px solid ${MC.border}` }}>
        {/* Status badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 10,
            color: statusColor,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>
            <span style={{
              width: 5, height: 5,
              borderRadius: '50%',
              background: statusColor,
              flexShrink: 0,
            }} />
            {dataset.status === 'ready' ? 'Ready' : dataset.status}
          </span>
          {(dataset.metadata?.file_count ?? 0) > 0 && (
            <span style={{ fontSize: 10, color: MC.textMuted }}>
              · {dataset.metadata!.file_count!.toLocaleString()} files
            </span>
          )}
        </div>

        {/* Name */}
        <div style={{ fontSize: 14, fontWeight: 700, color: MC.text, lineHeight: 1.3, marginBottom: 4 }}>
          {dataset.name}
        </div>

        {temporal && (
          <div style={{ fontSize: 11, color: MC.textMuted }}>{temporal}</div>
        )}
      </div>

      {/* Browse individual items — shown for multi-file datasets */}
      {hasItems && dataset.status === 'ready' && (
        <button
          onClick={() => openItemsPanel(datasetId)}
          style={{
            width: '100%',
            padding: '10px 14px',
            borderBottom: `1px solid ${MC.border}`,
            background: MC.accentDim,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            cursor: 'pointer',
            border: 'none',
            textAlign: 'left',
            transition: 'background 0.1s',
          }}
        >
          <FileImage size={14} style={{ color: MC.accent, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: MC.accent }}>
              Browse individual items
            </div>
            <div style={{ fontSize: 10, color: MC.textMuted }}>
              View and add single files by date
            </div>
          </div>
          <ChevronRight size={14} style={{ color: MC.textMuted, flexShrink: 0 }} />
        </button>
      )}

      {/* Metadata */}
      <div style={{ padding: '8px 14px' }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: MC.sectionLabel, marginBottom: 6 }}>
          Metadata
        </div>
        {dataset.stac_collection_id && (
          <MetaRow label="Collection" value={
            <span style={{ fontFamily: 'monospace', fontSize: 10 }} title={dataset.stac_collection_id}>
              {dataset.stac_collection_id.length > 28
                ? `…${dataset.stac_collection_id.slice(-24)}`
                : dataset.stac_collection_id}
            </span>
          } />
        )}
        <MetaRow label="Type" value={dataset.dataset_type} />
        {inferSource(dataset.metadata) && (
          <MetaRow label="Source" value={inferSource(dataset.metadata)!} />
        )}
        {dataset.metadata?.gsd_min != null && (
          <MetaRow
            label="GSD"
            value={
              dataset.metadata.gsd_max && dataset.metadata.gsd_max !== dataset.metadata.gsd_min
                ? `${dataset.metadata.gsd_min.toFixed(2)}–${dataset.metadata.gsd_max.toFixed(2)} m`
                : `${dataset.metadata.gsd_min.toFixed(2)} m`
            }
          />
        )}
        {dataset.metadata?.band_count && dataset.metadata.band_count.length > 0 && (
          <MetaRow label="Bands" value={dataset.metadata.band_count.join(', ')} />
        )}
        {dataset.metadata?.native_crs && dataset.metadata.native_crs.length > 0 && (
          <MetaRow label="CRS" value={dataset.metadata.native_crs.join(', ')} />
        )}
        {dataset.metadata?.total_size_bytes != null && (
          <MetaRow label="Size" value={formatBytes(dataset.metadata.total_size_bytes)} />
        )}
        <MetaRow label="Created" value={new Date(dataset.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} />
        <MetaRow label="Updated" value={new Date(dataset.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} />
      </div>

      {/* Actions */}
      <div style={{ padding: '10px 14px', borderTop: `1px solid ${MC.border}`, display: 'flex', flexDirection: 'column', gap: 7 }}>
        {dataset.status === 'ready' && (
          <button
            onClick={async () => {
              try {
                const { download_url } = await datasetsApi.getDownloadUrl(datasetId);
                window.open(download_url, '_blank');
              } catch {
                // download not available
              }
            }}
            style={{
              height: 28,
              borderRadius: 5,
              border: `1px solid ${MC.border}`,
              background: 'transparent',
              color: MC.textSecondary,
              fontSize: 11,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
              width: '100%',
            }}
          >
            <Download size={11} />
            Download
          </button>
        )}

        <a
          href={`../datasets/${datasetId}`}
          target="_blank"
          rel="noreferrer"
          style={{
            height: 28,
            borderRadius: 5,
            border: `1px solid ${MC.border}`,
            background: 'transparent',
            color: MC.textSecondary,
            fontSize: 11,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 5,
            textDecoration: 'none',
          }}
        >
          View full details
          <ExternalLink size={11} />
        </a>
      </div>
    </div>
  );
}

/** Infer source type label from metadata (explicit or GSD-based). */
function inferSource(metadata: DatasetMetadata | null | undefined): string | null {
  if (!metadata) return null;
  const explicit = (metadata as Record<string, unknown>).source_type as string | undefined;
  if (explicit) {
    const labels: Record<string, string> = { drone: 'Drone', lidar: 'LiDAR', satellite: 'Satellite', aerial: 'Aerial' };
    return labels[explicit] ?? explicit;
  }
  const gsd = metadata.gsd_min;
  if (gsd != null) {
    if (gsd < 0.1) return 'Drone';
    if (gsd < 5) return 'Satellite (HR)';
    return 'Satellite';
  }
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
