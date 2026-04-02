'use client';

import { useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Calendar, FileImage, Layers, Info, Database } from 'lucide-react';
import { useMapLayersStore } from '@/stores/mapLayersStore';
import { datasetsApi } from '@/lib/api/datasets';
import { qk } from '@/lib/query-keys';
import type { LayerType, BandSelection } from '@/features/maps/types';
import { MC } from '../../mapColors';
import { BandSelector } from './BandSelector';

export interface LayerStylePanelProps {
  layerId: string;
  layerType: LayerType;
}

export function LayerStylePanel({ layerId, layerType }: LayerStylePanelProps) {
  const layer = useMapLayersStore((s) => s.layers[layerId]);
  const setLayerStyle = useMapLayersStore((s) => s.setLayerStyle);
  const setLayerOpacity = useMapLayersStore((s) => s.setLayerOpacity);
  const setLayerBandSelection = useMapLayersStore((s) => s.setLayerBandSelection);
  const setLayerTileConfig = useMapLayersStore((s) => s.setLayerTileConfig);

  // Only stac_item layers are raster (datasets are collection containers, not data)
  const isRasterLayer = layer?.sourceType === 'stac_item';
  const parentDatasetId = layer?.parentDatasetId;
  const stacItemId = layer?.stacItemId;

  // For stac_item layers, we need the parent dataset ID to fetch tile config
  const datasetIdForTiles = parentDatasetId ?? null;

  // Fetch parent dataset metadata for raster info (CRS, GSD, type, etc.)
  const { data: parentDataset } = useQuery({
    queryKey: qk.datasets.detail(parentDatasetId ?? ''),
    queryFn: () => datasetsApi.get(parentDatasetId!),
    enabled: !!parentDatasetId,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch dataset item metadata for stac_item layers
  const { data: items } = useQuery({
    queryKey: qk.datasets.items(parentDatasetId ?? ''),
    queryFn: () => datasetsApi.listItems(parentDatasetId!),
    enabled: !!parentDatasetId && !!stacItemId,
    staleTime: 5 * 60 * 1000,
  });

  const item = items?.items?.find((i) => i.stac_item_id === stacItemId);

  // Backfill renderingConfig from parent dataset metadata if not yet set on this layer
  useEffect(() => {
    if (!parentDataset || layer?.renderingConfig) return;
    const rc = parentDataset.metadata?.rendering_config;
    if (rc) {
      useMapLayersStore.getState().setLayerRenderingConfig(layerId, rc);
    }
  }, [parentDataset, layer?.renderingConfig, layerId]);

  // ── Band selection handlers (fetch new TileJSON from API) ─────────────────
  const handleBandChange = useCallback(async (bands: BandSelection, preset?: string | null) => {
    setLayerBandSelection(layerId, bands, preset);

    if (!datasetIdForTiles) return;
    const state = useMapLayersStore.getState();
    const targetLayer = state.layers[layerId];
    if (!targetLayer?.tileUrl) return;

    const assetBidx = `data|${bands.r},${bands.g},${bands.b}`;
    const rc = targetLayer.renderingConfig;
    let rescale: string | undefined;
    if (rc) {
      const selectedBands = [bands.r, bands.g, bands.b];
      const p2Vals = selectedBands.map((i) => rc.bands[i - 1]?.stats?.p2 ?? 0);
      const p98Vals = selectedBands.map((i) => rc.bands[i - 1]?.stats?.p98 ?? 10000);
      rescale = `${Math.round(Math.min(...p2Vals))},${Math.round(Math.max(...p98Vals))}`;
    }

    try {
      if (stacItemId && parentDatasetId) {
        const tc = await datasetsApi.getItemTileConfigByStacId(parentDatasetId, stacItemId);
        // Build query string manually to avoid URL() encoding {z}/{x}/{y} placeholders
        const params = new URLSearchParams();
        params.set('asset_bidx', assetBidx);
        if (rescale) params.set('rescale', rescale);
        const tileUrl = `${tc.tile_url_template}?${params.toString()}`;

        setLayerTileConfig(layerId, { tileUrl });
      }
    } catch (err) {
      console.error('Failed to update band selection:', err);
    }
  }, [layerId, datasetIdForTiles, stacItemId, parentDatasetId, setLayerBandSelection, setLayerTileConfig]);

  const handlePresetChange = useCallback(async (presetId: string) => {
    const state = useMapLayersStore.getState();
    const targetLayer = state.layers[layerId];
    if (!targetLayer?.tileUrl || !datasetIdForTiles) return;

    const rc = targetLayer.renderingConfig;
    if (!rc?.presets?.[presetId]) return;

    const preset = rc.presets[presetId];
    const match = preset.params.asset_bidx?.match(/\|(\d+),(\d+),(\d+)/);
    const bands: BandSelection | null = match
      ? { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) }
      : null;

    setLayerBandSelection(layerId, bands, presetId);

    try {
      if (stacItemId && parentDatasetId) {
        const tc = await datasetsApi.getItemTileConfigByStacId(parentDatasetId, stacItemId);
        // Build query string manually to avoid URL() encoding {z}/{x}/{y} placeholders
        const params = new URLSearchParams();
        if (preset.params.asset_bidx) params.set('asset_bidx', preset.params.asset_bidx);
        if (preset.params.rescale) params.set('rescale', preset.params.rescale);
        if (preset.params.colormap_name) params.set('colormap_name', preset.params.colormap_name);
        const qs = params.toString();
        const tileUrl = qs ? `${tc.tile_url_template}?${qs}` : tc.tile_url_template;
        setLayerTileConfig(layerId, { tileUrl });
      }
    } catch (err) {
      console.error('Failed to apply preset:', err);
    }
  }, [layerId, datasetIdForTiles, stacItemId, parentDatasetId, setLayerBandSelection, setLayerTileConfig]);

  if (!layer) {
    return (
      <div style={{ padding: 16, fontSize: 12, color: MC.textMuted, fontStyle: 'italic' }}>
        Layer not found.
      </div>
    );
  }

  const style = layer.style;
  const rc = layer.renderingConfig;
  const hasMultiBands = rc && rc.bands.length > 1;

  const formatDate = (dateStr?: string | null) => {
    if (!dateStr) return null;
    try {
      return new Date(dateStr).toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric'
      });
    } catch {
      return dateStr;
    }
  };

  // Derive dataset metadata from parent or from the dataset itself
  const dsMeta = parentDataset?.metadata;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '10px 12px', borderBottom: `1px solid ${MC.border}`, flexShrink: 0, background: MC.inputBg }}>
        <div style={{ fontSize: 11, color: MC.sectionLabel, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {isRasterLayer ? 'Raster Layer' : 'Layer Style'}
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: MC.text, marginTop: 2 }}>
          {layer.name || layerId}
        </div>
        {parentDataset && (
          <div style={{ fontSize: 10, color: MC.textMuted, marginTop: 2 }}>
            <Database size={9} style={{ verticalAlign: 'middle', marginRight: 3 }} />
            {parentDataset.name}
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>

        {/* ── Raster Layer ── */}
        {isRasterLayer && (
          <>
            {/* Item attributes */}
            {stacItemId && item && (
              <div style={{ marginBottom: 12 }}>
                <SectionHeader label="Item Info" icon={<Info size={11} />} />
                {item.datetime && (
                  <MetaRow icon={<Calendar size={11} />} label="Date" value={formatDate(item.datetime) ?? ''} />
                )}
                {item.filename && (
                  <MetaRow icon={<FileImage size={11} />} label="File" value={item.filename} />
                )}
                <MetaRow label="STAC ID" value={
                  <span style={{ fontFamily: 'monospace', fontSize: 9 }}>{stacItemId}</span>
                } />
              </div>
            )}

            {/* Raster metadata from parent dataset */}
            {dsMeta && (
              <div style={{ marginBottom: 12 }}>
                <SectionHeader label="Raster Info" />
                {dsMeta.native_crs && dsMeta.native_crs.length > 0 && (
                  <MetaRow label="CRS" value={dsMeta.native_crs.join(', ')} />
                )}
                {dsMeta.gsd_min != null && (
                  <MetaRow label="GSD" value={
                    dsMeta.gsd_max && dsMeta.gsd_max !== dsMeta.gsd_min
                      ? `${dsMeta.gsd_min.toFixed(2)}–${dsMeta.gsd_max.toFixed(2)} m`
                      : `${dsMeta.gsd_min.toFixed(2)} m`
                  } />
                )}
                {rc && (
                  <>
                    <MetaRow label="Bands" value={`${rc.band_count} (${rc.dtype})`} />
                    <MetaRow label="Category" value={rc.data_category} />
                    {rc.nodata_value != null && (
                      <MetaRow label="NoData" value={String(rc.nodata_value)} />
                    )}
                  </>
                )}
              </div>
            )}

            {/* Band Selection */}
            {hasMultiBands && (
              <div style={{ marginBottom: 12 }}>
                <SectionHeader label="Band Selection" icon={<Layers size={11} />} />
                <BandSelector
                  renderingConfig={rc!}
                  bandSelection={layer.bandSelection ?? null}
                  activePreset={layer.activePreset ?? null}
                  onBandChange={handleBandChange}
                  onPresetChange={handlePresetChange}
                />
              </div>
            )}

            {/* Single-band info */}
            {rc && rc.bands.length === 1 && (
              <div style={{ marginBottom: 12 }}>
                <SectionHeader label="Band Info" icon={<Layers size={11} />} />
                <div style={{ fontSize: 11, color: MC.textSecondary, padding: '4px 0' }}>
                  Single band: {rc.bands[0].spectral_name || rc.bands[0].description || `Band ${rc.bands[0].index}`}
                </div>
                {Object.keys(rc.presets).length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <div style={{ fontSize: 9, color: MC.textMuted, textTransform: 'uppercase', marginBottom: 4 }}>
                      Active preset: {layer.activePreset ?? rc.default_preset}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {Object.entries(rc.presets).map(([pid, preset]) => (
                        <button
                          key={pid}
                          onClick={() => handlePresetChange(pid)}
                          style={{
                            padding: '3px 8px', borderRadius: 4,
                            fontSize: 10, fontWeight: 600,
                            background: (layer.activePreset ?? rc.default_preset) === pid ? MC.accentDim : 'transparent',
                            border: `1px solid ${(layer.activePreset ?? rc.default_preset) === pid ? MC.accent : MC.border}`,
                            color: (layer.activePreset ?? rc.default_preset) === pid ? MC.accent : MC.textSecondary,
                            cursor: 'pointer',
                          }}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Opacity */}
            <div style={{ marginBottom: 12 }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                color: MC.sectionLabel, marginBottom: 6,
              }}>
                <span>Opacity</span>
                <span style={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                  {Math.round(layer.opacity * 100)}%
                </span>
              </div>
              <input
                type="range" min={0} max={100}
                value={Math.round(layer.opacity * 100)}
                aria-label="Layer opacity"
                onChange={(e) => setLayerOpacity(layerId, Number(e.target.value) / 100)}
                style={{ width: '100%', accentColor: MC.accent, cursor: 'pointer' }}
              />
            </div>
          </>
        )}

        {/* ── Vector Layer: Full Style Controls ── */}
        {!isRasterLayer && (
          <>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: MC.sectionLabel, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Preview
              </div>
              <div
                style={{
                  height: 32, borderRadius: 4,
                  background: style.fillColor, opacity: style.fillOpacity,
                  border: `${style.weight}px solid ${style.color}`,
                }}
              />
            </div>

            <StyleRow label="Stroke Color">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="color" value={style.color} aria-label="Stroke color"
                  onChange={(e) => setLayerStyle(layerId, { color: e.target.value })}
                  style={{ width: 32, height: 24, borderRadius: 3, border: `1px solid ${MC.border}`, background: 'transparent', cursor: 'pointer', padding: 0 }}
                />
                <span style={{ fontSize: 11, color: MC.textMuted, fontFamily: 'monospace' }}>{style.color}</span>
              </div>
            </StyleRow>

            <StyleRow label="Fill Color">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="color" value={style.fillColor} aria-label="Fill color"
                  onChange={(e) => setLayerStyle(layerId, { fillColor: e.target.value })}
                  style={{ width: 32, height: 24, borderRadius: 3, border: `1px solid ${MC.border}`, background: 'transparent', cursor: 'pointer', padding: 0 }}
                />
                <span style={{ fontSize: 11, color: MC.textMuted, fontFamily: 'monospace' }}>{style.fillColor}</span>
              </div>
            </StyleRow>

            <StyleRow label={`Fill Opacity: ${Math.round(style.fillOpacity * 100)}%`}>
              <input type="range" min={0} max={100}
                value={Math.round(style.fillOpacity * 100)} aria-label="Fill opacity"
                onChange={(e) => setLayerStyle(layerId, { fillOpacity: Number(e.target.value) / 100 })}
                style={{ width: '100%', accentColor: MC.accent, cursor: 'pointer' }}
              />
            </StyleRow>

            <StyleRow label={`Stroke Weight: ${style.weight}px`}>
              <input type="range" min={1} max={5} step={0.5}
                value={style.weight} aria-label="Stroke weight"
                onChange={(e) => setLayerStyle(layerId, { weight: Number(e.target.value) })}
                style={{ width: '100%', accentColor: MC.accent, cursor: 'pointer' }}
              />
            </StyleRow>

            {(layerType === 'annotation' || layerType === 'tracking' || layerType === 'alert') && (
              <StyleRow label={`Point Radius: ${style.radius}px`}>
                <input type="range" min={4} max={20} step={1}
                  value={style.radius} aria-label="Point radius"
                  onChange={(e) => setLayerStyle(layerId, { radius: Number(e.target.value) })}
                  style={{ width: '100%', accentColor: MC.accent, cursor: 'pointer' }}
                />
              </StyleRow>
            )}

            <StyleRow label={`Layer Opacity: ${Math.round(layer.opacity * 100)}%`}>
              <input type="range" min={0} max={100}
                value={Math.round(layer.opacity * 100)} aria-label="Layer opacity"
                onChange={(e) => setLayerOpacity(layerId, Number(e.target.value) / 100)}
                style={{ width: '100%', accentColor: MC.accent, cursor: 'pointer' }}
              />
            </StyleRow>
          </>
        )}
      </div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function SectionHeader({ label, icon }: { label: string; icon?: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
      textTransform: 'uppercase', color: MC.sectionLabel, marginBottom: 6,
      display: 'flex', alignItems: 'center', gap: 5,
    }}>
      {icon}
      {label}
    </div>
  );
}

function MetaRow({ label, value, icon }: { label: string; value: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '3px 0', borderBottom: `1px solid ${MC.border}`,
    }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: MC.textMuted, flexShrink: 0 }}>
        {icon}
        {label}
      </span>
      <span style={{ fontSize: 10, color: MC.text, textAlign: 'right', wordBreak: 'break-all', maxWidth: '60%' }}>
        {value}
      </span>
    </div>
  );
}

function StyleRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: MC.sectionLabel, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      {children}
    </div>
  );
}
