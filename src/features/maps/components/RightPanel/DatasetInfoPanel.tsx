'use client';

import { useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, FileImage, ChevronRight, Download, Layers } from 'lucide-react';
import { datasetsApi } from '@/lib/api/datasets';
import { qk } from '@/lib/query-keys';
import { useMapLayersStore } from '@/stores/mapLayersStore';
import { MC } from '../../mapColors';
import { BandSelector } from './BandSelector';
import type { DatasetMetadata } from '@/types/api';
import type { BandSelection } from '../../types';

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
  // Find the layer for this dataset. For regular dataset layers the key is the
  // dataset UUID. For AOI child layers the key is "aoi-{ts}-ds-{datasetId}"
  // and sourceDatasetId holds the real dataset UUID.
  const layer = useMapLayersStore((s) =>
    s.layers[datasetId] ??
    Object.values(s.layers).find((l) => l.sourceDatasetId === datasetId) ??
    null
  );
  const setLayerBandSelection = useMapLayersStore((s) => s.setLayerBandSelection);
  const setLayerTileConfig = useMapLayersStore((s) => s.setLayerTileConfig);
  const setLayerRenderingConfig = useMapLayersStore((s) => s.setLayerRenderingConfig);

  const { data: dataset, isLoading } = useQuery({
    queryKey: qk.datasets.detail(datasetId),
    queryFn: () => datasetsApi.get(datasetId),
  });

  // ── Band change helpers ───────────────────────────────────────────────────
  // Helpers that iterate over ALL raster layers that belong to this dataset:
  //   • the direct dataset layer (key === datasetId)
  //   • every AOI child layer (sourceDatasetId === datasetId)
  //   • every item layer (parentDatasetId === datasetId)
  // This ensures dataset band/preset changes propagate to items under it.

  /** Returns all store layer IDs that map to this dataset. */
  const getMatchingLayerIds = useCallback((): string[] => {
    const allLayers = useMapLayersStore.getState().layers;
    return Object.entries(allLayers)
      .filter(([id, l]) =>
        (id === datasetId || l.sourceDatasetId === datasetId || l.parentDatasetId === datasetId)
        && (l.sourceType === 'dataset' || l.sourceType === 'stac_item')
      )
      .map(([id]) => id);
  }, [datasetId]);

  const applyBandToCurrentUrl = useCallback((bands: BandSelection, rc: NonNullable<DatasetMetadata['rendering_config']>) => {
    const allLayers = useMapLayersStore.getState().layers;
    for (const lid of getMatchingLayerIds()) {
      const l = allLayers[lid];
      if (!l?.tileUrl) continue;
      const [basePath, existingQs] = l.tileUrl.split('?');
      const params = new URLSearchParams(existingQs ?? '');
      params.set('asset_bidx', `data|${bands.r},${bands.g},${bands.b}`);
      params.delete('colormap_name');
      params.delete('colormap');
      const rBand = rc.bands.find((b) => b.index === bands.r);
      const gBand = rc.bands.find((b) => b.index === bands.g);
      const bBand = rc.bands.find((b) => b.index === bands.b);
      if (rBand && gBand && bBand) {
        const p2 = Math.min(rBand.stats.p2, gBand.stats.p2, bBand.stats.p2);
        const p98 = Math.max(rBand.stats.p98, gBand.stats.p98, bBand.stats.p98);
        params.set('rescale', `${Math.round(p2)},${Math.round(p98)}`);
      } else {
        params.delete('rescale');
      }
      setLayerTileConfig(lid, { tileUrl: `${basePath}?${params.toString()}` });
    }
  }, [getMatchingLayerIds, setLayerTileConfig]);

  // Sync renderingConfig to store once the API data arrives — only on existing layers.
  useEffect(() => {
    if (!dataset?.metadata?.rendering_config) return;
    const rc = dataset.metadata.rendering_config;
    const allLayers = useMapLayersStore.getState().layers;
    for (const lid of Object.entries(allLayers)
      .filter(([id, l]) =>
        (id === datasetId || l.sourceDatasetId === datasetId || l.parentDatasetId === datasetId)
        && (l.sourceType === 'dataset' || l.sourceType === 'stac_item')
        && !l.renderingConfig
      )
      .map(([id]) => id)) {
      setLayerRenderingConfig(lid, rc);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, dataset?.metadata?.rendering_config, setLayerRenderingConfig]);

  const applyPresetToCurrentUrl = useCallback((presetId: string, rc: NonNullable<DatasetMetadata['rendering_config']>) => {
    const preset = rc.presets[presetId];
    if (!preset) return;
    const allLayers = useMapLayersStore.getState().layers;
    for (const lid of getMatchingLayerIds()) {
      const l = allLayers[lid];
      if (!l?.tileUrl) continue;
      const [basePath, existingQs] = l.tileUrl.split('?');
      const params = new URLSearchParams(existingQs ?? '');
      params.delete('asset_bidx');
      params.delete('rescale');
      params.delete('colormap_name');
      params.delete('colormap');
      if (preset.params.asset_bidx) params.set('asset_bidx', preset.params.asset_bidx);
      if (preset.params.rescale) params.set('rescale', preset.params.rescale);
      if (preset.params.colormap_name) params.set('colormap_name', preset.params.colormap_name);
      if (preset.params.colormap) params.set('colormap', preset.params.colormap);
      const qs = params.toString();
      setLayerTileConfig(lid, { tileUrl: qs ? `${basePath}?${qs}` : basePath });
    }
  }, [getMatchingLayerIds, setLayerTileConfig]);

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

      {/* Band Selection — shown when dataset has multi-band rendering config */}
      {(() => {
        const rc = dataset.metadata?.rendering_config ?? layer?.renderingConfig;
        if (!rc || rc.bands.length < 2) return null;
        return (
          <div style={{ padding: '10px 14px', borderBottom: `1px solid ${MC.border}` }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
              textTransform: 'uppercase', color: MC.sectionLabel, marginBottom: 8,
            }}>
              <Layers size={11} style={{ color: MC.accent }} />
              Band Selection
            </div>
            <BandSelector
              renderingConfig={rc}
              bandSelection={layer?.bandSelection ?? null}
              activePreset={layer?.activePreset ?? null}
              onBandChange={(bands, preset) => {
                getMatchingLayerIds().forEach((lid) =>
                  setLayerBandSelection(lid, bands, preset ?? null)
                );
                applyBandToCurrentUrl(bands, rc);
              }}
              onPresetChange={(presetId) => {
                const preset = rc.presets[presetId];
                const match = preset?.params.asset_bidx?.match(/\|(\d+),(\d+),(\d+)/);
                const bands: BandSelection | null = match
                  ? { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) }
                  : null;
                getMatchingLayerIds().forEach((lid) =>
                  setLayerBandSelection(lid, bands, presetId)
                );
                applyPresetToCurrentUrl(presetId, rc);
              }}
            />
          </div>
        );
      })()}

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
