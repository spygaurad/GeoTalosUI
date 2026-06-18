'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  BoxSelect, Check, Database, FileImage,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useMapLayersStore } from '@/stores/mapLayersStore';
import { mapAoisApi, getOrStartAoiCreate } from '@/lib/api/map-aois';
import { mapsApi } from '@/lib/api/maps';
import { qk } from '@/lib/query-keys';
import { MC } from '../../mapColors';
import type { Dataset, DatasetItem } from '@/types/api';
import { datasetItemLabel } from '@/features/datasets/itemLabel';
import type { BandSelection } from '../../types';
import { BandSelector } from './BandSelector';
import { switchAoiChildLayerToItem } from '@/features/maps/utils/aoiChildItem';
import { AoiInferencePanel } from './AoiInferencePanel';
import { AoiVisualizationPanel } from './AoiVisualizationPanel';
import { AoiAnalysisHub, type AoiAnalysisKey } from './AoiAnalysisHub';
import {
  AoiTemporalPanel,
  AoiNdviPanel,
  AoiAreaStatsPanel,
  AoiCompositePanel,
  AoiChangeDetectionPanel,
} from './AoiSimpleAnalysisPanels';

interface AoiPanelProps {
  aoiLayerId: string;
  mapId?: string;
}

export function AoiPanel({ aoiLayerId, mapId }: AoiPanelProps) {
  const layer = useMapLayersStore((s) => s.layers[aoiLayerId]);
  const layers = useMapLayersStore((s) => s.layers);
  const backendAoiId = useMapLayersStore((s) => s.backendLayerIds[aoiLayerId]);
  const aoiSelectedDatasetIds = useMapLayersStore((s) => s.aoiSelectedDatasetIds);
  const toggleAoiDataset = useMapLayersStore((s) => s.toggleAoiDataset);
  const setAoiSelectedDatasets = useMapLayersStore((s) => s.setAoiSelectedDatasets);
  const addAoiBoundedDataset = useMapLayersStore((s) => s.addAoiBoundedDataset);
  const removeAoiBoundedDataset = useMapLayersStore((s) => s.removeAoiBoundedDataset);
  const setBackendLayerId = useMapLayersStore((s) => s.setBackendLayerId);
  const queryClient = useQueryClient();

  const bbox = layer?.aoiBbox;
  const geometry = layer?.aoiGeometry;
  const bboxStr = bbox ? bbox.join(',') : '';

  // ── Backend-driven intersecting resources (datasets, items, vectors, masks) ──
  // Source of truth: GET /maps/{id}/aoi/resources?bbox=… — replaces client-side
  // bbox intersect against `datasets` prop.
  const { data: aoiResources, isLoading: aoiResourcesLoading } = useQuery({
    queryKey: qk.maps.aoiResources(mapId ?? '', bboxStr),
    queryFn: () => mapsApi.listAoiResources(mapId!, bbox!),
    enabled: !!mapId && !!bbox,
    staleTime: 30_000,
  });

  // Use backend resources when present; gracefully fall back to the `datasets` prop
  // for newly-drawn AOIs whose resources query hasn't resolved yet.
  const intersecting: Dataset[] = useMemo(() => {
    if (aoiResources?.datasets?.length) {
      return aoiResources.datasets.filter((d) => d.status === 'ready');
    }
    return [];
  }, [aoiResources?.datasets]);

  // ── Restore selection from backend on AOI open ──────────────────────────────
  const { data: backendSelection } = useQuery({
    queryKey: qk.mapAois.selection(mapId ?? '', backendAoiId ?? ''),
    queryFn: () => mapAoisApi.getSelection(mapId!, backendAoiId!),
    enabled: !!mapId && !!backendAoiId,
    staleTime: 30_000,
  });

  // Deterministically mirror the backend selection for the *currently open* AOI
  // into the (single, shared) store array. Keyed on AOI + the resolved id set so
  // it re-syncs whenever the saved selection changes — including the empty case,
  // which clears any stale carryover from a previously-open AOI. Replaces the old
  // one-shot guard that skipped empty selections and leaked state between AOIs.
  const restoredKeyRef = useRef<string | null>(null);
  useEffect(() => {
    // Wait until the selection query for THIS AOI has actually resolved.
    if (!backendAoiId || backendSelection === undefined) return;
    const ids = backendSelection.dataset_ids ?? [];
    const key = `${aoiLayerId}:${[...ids].sort().join(',')}`;
    if (restoredKeyRef.current === key) return;
    restoredKeyRef.current = key;
    setAoiSelectedDatasets(ids);
  }, [aoiLayerId, backendAoiId, backendSelection, setAoiSelectedDatasets]);

  // Ensure a bounded dataset overlay exists on the map for every selected dataset
  // that intersects this AOI. Idempotent (skips datasets whose child layer is
  // already present), so it restores imagery for a restored selection even when
  // the intersecting-resources query resolves after the selection query.
  useEffect(() => {
    if (!bbox) return;
    const state = useMapLayersStore.getState();
    for (const ds of intersecting) {
      if (!aoiSelectedDatasetIds.includes(ds.id)) continue;
      const childLayerId = `${aoiLayerId}-ds-${ds.id}`;
      if (state.layers[childLayerId]) continue;
      addAoiBoundedDataset(
        aoiLayerId,
        { id: ds.id, name: ds.name, stac_collection_id: ds.stac_collection_id ?? undefined },
        bbox,
      );
    }
  }, [aoiLayerId, bbox, intersecting, aoiSelectedDatasetIds, addAoiBoundedDataset]);

  // ── Ensure AOI exists on the backend ────────────────────────────────────────
  // Centralises the POST /maps/{id}/aois call. The MapEditorShell subscribe
  // path also creates AOIs, but races and silent failures can leave the panel
  // without a backend id — this mutation lets the panel both proactively save
  // when it opens and lazily save right before temporal playback.
  const ensureAoiMut = useMutation({
    mutationFn: async () => {
      if (!mapId) throw new Error('Map not available');
      if (!layer) throw new Error('AOI layer missing');
      const existing = useMapLayersStore.getState().backendLayerIds[aoiLayerId];
      if (existing) return existing;
      if (!layer.aoiBbox) throw new Error('AOI has no bbox');
      // Coalesce with the MapEditorShell subscribe-based create so we never
      // POST the same AOI twice in parallel.
      const aoi = await getOrStartAoiCreate(aoiLayerId, () =>
        mapAoisApi.createAoi(mapId, {
          name: layer.name ?? 'AOI',
          bbox_4326: layer.aoiBbox!,
          geometry: layer.aoiGeometry,
          visible: layer.visible,
          opacity: layer.opacity,
          z_index: layer.zIndex,
        }),
      );
      setBackendLayerId(aoiLayerId, aoi.id);
      queryClient.invalidateQueries({ queryKey: qk.mapAois.list(mapId) });
      return aoi.id;
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to save AOI: ${msg.slice(0, 120)}`);
    },
  });

  // Auto-save on open if it hasn't been persisted yet (covers any race or silent
  // failure in the MapEditorShell subscribe path).
  const autoSaveAttemptedRef = useRef(false);
  useEffect(() => {
    if (autoSaveAttemptedRef.current) return;
    if (!mapId || !layer || backendAoiId || !layer.aoiBbox) return;
    if (ensureAoiMut.isPending) return;
    autoSaveAttemptedRef.current = true;
    ensureAoiMut.mutate();
  }, [mapId, layer, backendAoiId, ensureAoiMut]);

  // Reset the auto-save guard when the panel switches to a different AOI.
  useEffect(() => {
    autoSaveAttemptedRef.current = false;
  }, [aoiLayerId]);

  const hasSelected = aoiSelectedDatasetIds.length > 0;

  // ── View state — hub vs. selected analysis detail ──────────────────────────
  const [view, setView] = useState<'hub' | AoiAnalysisKey>('hub');
  // Reset view when switching to a different AOI.
  useEffect(() => { setView('hub'); }, [aoiLayerId]);
  const backToHub = useCallback(() => setView('hub'), []);

  // Datasets currently selected on this AOI, filtered to the intersecting set.
  const selectedDatasetObjs = useMemo(
    () => intersecting.filter((d) => aoiSelectedDatasetIds.includes(d.id)),
    [intersecting, aoiSelectedDatasetIds],
  );
  const ensureAoi = useCallback(() => ensureAoiMut.mutateAsync(), [ensureAoiMut]);

  /**
   * Toggle dataset selection + create/remove bounded child layer overlay.
   * Also syncs selection to backend AOI.
   */
  const handleToggleDataset = useCallback(
    (ds: Dataset) => {
      const isSelected = aoiSelectedDatasetIds.includes(ds.id);
      const childLayerId = `${aoiLayerId}-ds-${ds.id}`;

      toggleAoiDataset(ds.id);

      if (!bbox) return;

      if (isSelected) {
        if (layers[childLayerId]) {
          removeAoiBoundedDataset(childLayerId);
        }
      } else {
        addAoiBoundedDataset(
          aoiLayerId,
          { id: ds.id, name: ds.name, stac_collection_id: ds.stac_collection_id ?? undefined },
          bbox
        );
      }

      // Sync updated selection to backend. If the AOI hasn't reached the
      // backend yet, save it first via ensureAoiMut — this avoids losing
      // selections made immediately after drawing an AOI.
      if (!mapId) return;
      const newSelectedIds = isSelected
        ? aoiSelectedDatasetIds.filter((id) => id !== ds.id)
        : [...aoiSelectedDatasetIds, ds.id];

      const persistSelection = async () => {
        const aoiId = backendAoiId ?? (await ensureAoiMut.mutateAsync());
        if (!aoiId) return;
        try {
          await mapAoisApi.updateSelection(mapId, aoiId, {
            dataset_ids: newSelectedIds,
            dataset_item_ids: [],
          });
          queryClient.invalidateQueries({
            queryKey: qk.mapAois.selection(mapId, aoiId),
          });
          queryClient.invalidateQueries({
            queryKey: qk.mapAois.timeline(mapId, aoiId),
          });
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          console.error('[AoiPanel] Failed to update AOI selection:', errorMsg, err);
          toast.error(`Failed to save dataset selection: ${errorMsg.substring(0, 60)}`);
        }
      };
      void persistSelection();
    },
    [aoiLayerId, aoiSelectedDatasetIds, bbox, layers, toggleAoiDataset, addAoiBoundedDataset, removeAoiBoundedDataset, mapId, backendAoiId, queryClient, ensureAoiMut]
  );

  if (!layer) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── AOI Info ─────────────────────────────────────────── */}
        <section>
          <SectionHeader icon={<BoxSelect size={11} />} label="Bounding Box" />
          {bbox && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', padding: '6px 0' }}>
              {(['W', 'S', 'E', 'N'] as const).map((dir, i) => (
                <div key={dir} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: MC.textMuted, width: 12 }}>{dir}</span>
                  <span style={{ fontSize: 11, color: MC.text, fontVariantNumeric: 'tabular-nums' }}>
                    {bbox[i].toFixed(5)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Intersecting Datasets ────────────────────────────── */}
        <section>
          <SectionHeader icon={<Database size={11} />} label={`Datasets (${intersecting.length})`} />
          {aoiResourcesLoading && intersecting.length === 0 ? (
            <p style={{ fontSize: 11, color: MC.textMuted, fontStyle: 'italic', padding: '6px 0' }}>
              Loading intersecting resources…
            </p>
          ) : intersecting.length === 0 ? (
            <p style={{ fontSize: 11, color: MC.textMuted, fontStyle: 'italic', padding: '6px 0' }}>
              No ready datasets intersect this AOI
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 0' }}>
              {intersecting.map((ds) => {
                const checked = aoiSelectedDatasetIds.includes(ds.id);
                const fileCount = ds.metadata?.file_count ?? 0;
                const temporal = ds.temporal_extent;
                return (
                  <button
                    key={ds.id}
                    onClick={() => handleToggleDataset(ds)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 8px', borderRadius: 5,
                      background: checked ? MC.accentDim : 'transparent',
                      border: `1px solid ${checked ? MC.accent : MC.border}`,
                      cursor: 'pointer', textAlign: 'left',
                      transition: 'all 0.12s',
                    }}
                  >
                    <div style={{
                      width: 16, height: 16, borderRadius: 3,
                      border: `1.5px solid ${checked ? MC.accent : MC.borderLight}`,
                      background: checked ? MC.accent : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0, transition: 'all 0.12s',
                    }}>
                      {checked && <Check size={10} color="#fff" strokeWidth={3} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 11, fontWeight: 600, color: MC.text,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {ds.name}
                      </div>
                      <div style={{ fontSize: 9, color: MC.textMuted, display: 'flex', gap: 8, marginTop: 1 }}>
                        {fileCount > 0 && <span>{fileCount} item{fileCount !== 1 ? 's' : ''}</span>}
                        {temporal && (
                          <span>
                            {fmtShortDate(temporal.lower)} — {fmtShortDate(temporal.upper)}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Selected Dataset Items + Per-item Band Selection ───────────── */}
        {bbox && hasSelected && (
          <section>
            <SectionHeader icon={<FileImage size={11} />} label="Selected Dataset Items" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 4 }}>
              {intersecting
                .filter((ds) => aoiSelectedDatasetIds.includes(ds.id))
                .map((ds) => (
                  <AoiDatasetItemControl
                    key={ds.id}
                    aoiLayerId={aoiLayerId}
                    dataset={ds}
                    bbox={bbox}
                    mapId={mapId}
                  />
                ))}
            </div>
          </section>
        )}

        {/* ── Analyses: hub or selected detail ────────────────── */}
        {view === 'hub' && (
          <AoiAnalysisHub
            hasSelectedDataset={hasSelected}
            hasAoiBbox={!!bbox}
            onSelect={setView}
          />
        )}

        {view === 'inference' && (
          <AoiInferencePanel
            aoiLayerId={aoiLayerId}
            mapId={mapId}
            backendAoiId={backendAoiId}
            aoiBbox={bbox}
            selectedDatasets={selectedDatasetObjs}
            onEnsureAoi={ensureAoi}
            onBack={backToHub}
          />
        )}

        {view === 'visualization' && (
          <AoiVisualizationPanel
            aoiLayerId={aoiLayerId}
            mapId={mapId}
            aoiBbox={bbox}
            onBack={backToHub}
          />
        )}

        {view === 'temporal' && (
          <AoiTemporalPanel
            aoiLayerId={aoiLayerId}
            mapId={mapId}
            backendAoiId={backendAoiId}
            aoiBbox={bbox}
            geometry={geometry}
            selectedDatasets={selectedDatasetObjs}
            onEnsureAoi={ensureAoi}
            onBack={backToHub}
          />
        )}

        {view === 'ndvi' && (
          <AoiNdviPanel
            aoiLayerId={aoiLayerId}
            mapId={mapId}
            backendAoiId={backendAoiId}
            geometry={geometry}
            selectedDatasets={selectedDatasetObjs}
            onEnsureAoi={ensureAoi}
            onBack={backToHub}
          />
        )}

        {view === 'area_stats' && (
          <AoiAreaStatsPanel
            aoiLayerId={aoiLayerId}
            mapId={mapId}
            backendAoiId={backendAoiId}
            geometry={geometry}
            selectedDatasets={selectedDatasetObjs}
            onEnsureAoi={ensureAoi}
            onBack={backToHub}
          />
        )}

        {view === 'composite' && (
          <AoiCompositePanel
            aoiLayerId={aoiLayerId}
            mapId={mapId}
            backendAoiId={backendAoiId}
            geometry={geometry}
            selectedDatasets={selectedDatasetObjs}
            onEnsureAoi={ensureAoi}
            onBack={backToHub}
          />
        )}

        {view === 'change_detection' && (
          <AoiChangeDetectionPanel
            aoiLayerId={aoiLayerId}
            mapId={mapId}
            backendAoiId={backendAoiId}
            geometry={geometry}
            selectedDatasets={selectedDatasetObjs}
            onEnsureAoi={ensureAoi}
            onBack={backToHub}
          />
        )}
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function SectionHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
      <span style={{ color: MC.accent, display: 'flex' }}>{icon}</span>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: MC.sectionLabel }}>
        {label}
      </span>
    </div>
  );
}

function _AnalysisBtn({
  icon, label, disabled, loading, onClick,
}: {
  icon: React.ReactNode; label: string; disabled: boolean; loading: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 10px', borderRadius: 5,
        background: 'transparent',
        border: `1px solid ${disabled ? MC.border : MC.accent}`,
        color: disabled ? MC.textMuted : MC.text,
        fontSize: 11, fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: loading ? 0.6 : 1,
        transition: 'all 0.12s',
      }}
    >
      <span style={{ color: disabled ? MC.textMuted : MC.accent, display: 'flex' }}>{icon}</span>
      {loading ? 'Running...' : label}
    </button>
  );
}

function AoiDatasetItemControl({
  aoiLayerId,
  dataset,
  bbox,
  mapId,
}: {
  aoiLayerId: string;
  dataset: Dataset;
  bbox: [number, number, number, number];
  mapId?: string;
}) {
  const childLayerId = `${aoiLayerId}-ds-${dataset.id}`;
  const childLayer = useMapLayersStore((s) => s.layers[childLayerId]);
  const setLayerBandSelection = useMapLayersStore((s) => s.setLayerBandSelection);

  const bboxStr = bbox.join(',');
  // Use the AOI-scoped endpoint so we only get items intersecting the bbox.
  const { data, isLoading } = useQuery({
    queryKey: qk.maps.datasetItemsInAoi(mapId ?? '', dataset.id, bboxStr),
    queryFn: () => mapsApi.listDatasetItemsInAoi(mapId!, dataset.id, bbox, { limit: 100 }),
    enabled: !!childLayer && !!mapId,
  });
  const items = data?.items ?? [];
  const selectedStacItemId = childLayer?.stacItemId ?? items[0]?.stac_item_id ?? '';

  const handleItemSelect = useCallback(async (stacItemId: string) => {
    const latestLayer = useMapLayersStore.getState().layers[childLayerId];
    if (!latestLayer) return;
    try {
      await switchAoiChildLayerToItem({
        childLayerId,
        datasetId: dataset.id,
        stacItemId,
        layerSnapshot: latestLayer,
      });
    } catch {
      toast.error('Failed to switch AOI item');
    }
  }, [childLayerId, dataset.id]);

  const handleBandChange = useCallback(async (bands: BandSelection, preset?: string | null) => {
    const latestLayer = useMapLayersStore.getState().layers[childLayerId];
    if (!latestLayer || !selectedStacItemId) return;
    setLayerBandSelection(childLayerId, bands, preset ?? null);
    try {
      await switchAoiChildLayerToItem({
        childLayerId,
        datasetId: dataset.id,
        stacItemId: selectedStacItemId,
        layerSnapshot: latestLayer,
        bandSelection: bands,
        activePreset: preset ?? null,
      });
    } catch {
      toast.error('Failed to apply AOI band selection');
    }
  }, [childLayerId, dataset.id, selectedStacItemId, setLayerBandSelection]);

  const handlePresetChange = useCallback(async (presetId: string) => {
    const latestLayer = useMapLayersStore.getState().layers[childLayerId];
    const rc = latestLayer?.renderingConfig;
    if (!latestLayer || !selectedStacItemId || !rc) return;
    const preset = rc.presets[presetId];
    const match = preset?.params.asset_bidx?.match(/\|(\d+),(\d+),(\d+)/);
    const bands: BandSelection | null = match
      ? { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) }
      : null;
    setLayerBandSelection(childLayerId, bands, presetId);
    try {
      await switchAoiChildLayerToItem({
        childLayerId,
        datasetId: dataset.id,
        stacItemId: selectedStacItemId,
        layerSnapshot: latestLayer,
        bandSelection: bands,
        activePreset: bands ? null : presetId,
      });
    } catch {
      toast.error('Failed to apply AOI preset');
    }
  }, [childLayerId, dataset.id, selectedStacItemId, setLayerBandSelection]);

  return (
    <div style={{ border: `1px solid ${MC.border}`, borderRadius: 6, padding: 8, background: MC.inputBg }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: MC.text, marginBottom: 6 }}>
        {dataset.name}
      </div>

      <div style={{ fontSize: 9, color: MC.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>
        Active Item
      </div>
      <select
        value={selectedStacItemId}
        disabled={isLoading || items.length === 0}
        onChange={(e) => { void handleItemSelect(e.target.value); }}
        style={{
          width: '100%',
          height: 26,
          fontSize: 11,
          borderRadius: 4,
          border: `1px solid ${MC.border}`,
          background: MC.panelBg,
          color: MC.text,
          marginBottom: 8,
        }}
      >
        {isLoading && <option value="">Loading items…</option>}
        {!isLoading && items.length === 0 && <option value="">No AOI items found</option>}
        {!isLoading && items.map((item: DatasetItem) => (
          <option key={item.id} value={item.stac_item_id} title={item.stac_item_id}>
            {datasetItemLabel(item)}
          </option>
        ))}
      </select>

      {childLayer?.renderingConfig && childLayer.renderingConfig.bands.length > 1 && (
        <BandSelector
          renderingConfig={childLayer.renderingConfig}
          bandSelection={childLayer.bandSelection ?? null}
          activePreset={childLayer.activePreset ?? null}
          onBandChange={handleBandChange}
          onPresetChange={handlePresetChange}
        />
      )}
    </div>
  );
}

function fmtShortDate(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
}
