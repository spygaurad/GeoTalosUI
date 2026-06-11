'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  BoxSelect, Check, ChevronDown, ChevronRight,
  Database, TrendingUp, Layers, BarChart3, Image,
  Play, Loader2, CheckCircle2, AlertCircle, FileImage,
} from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useMapLayersStore } from '@/stores/mapLayersStore';
import { findIntersectingDatasets } from '../../utils/aoiIntersect';
import { analysisApi } from '@/lib/api/analysis';
import { modelsApi } from '@/lib/api/models';
import { datasetsApi } from '@/lib/api/datasets';
import { inferenceApi } from '@/lib/api/inference';
import { annotationSetsApi } from '@/lib/api/annotation-sets';
import { MC } from '../../mapColors';
import type { Dataset, DatasetItem } from '@/types/api';
import type { BandSelection } from '../../types';
import { BandSelector } from './BandSelector';
import { switchAoiChildLayerToItem } from '@/features/maps/utils/aoiChildItem';
// ⚠️ TEMP TEST FEATURE — remove this import + the <AoiTestInferencePanel/> block below
//    when the real backend inference pipeline lands.
import { AoiTestInferencePanel } from './AoiTestInferencePanel';

interface AoiPanelProps {
  aoiLayerId: string;
  datasets: Dataset[];
  mapId?: string;
}

export function AoiPanel({ aoiLayerId, datasets, mapId }: AoiPanelProps) {
  const layer = useMapLayersStore((s) => s.layers[aoiLayerId]);
  const layers = useMapLayersStore((s) => s.layers);
  const aoiSelectedDatasetIds = useMapLayersStore((s) => s.aoiSelectedDatasetIds);
  const toggleAoiDataset = useMapLayersStore((s) => s.toggleAoiDataset);
  const addAoiBoundedDataset = useMapLayersStore((s) => s.addAoiBoundedDataset);
  const removeAoiBoundedDataset = useMapLayersStore((s) => s.removeAoiBoundedDataset);
  const addAnnotationSetLayer = useMapLayersStore((s) => s.addAnnotationSetLayer);

  const [showAnalysis, setShowAnalysis] = useState(false);
  const [showInference, setShowInference] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [inferenceJobId, setInferenceJobId] = useState<string | null>(null);

  const bbox = layer?.aoiBbox;
  const geometry = layer?.aoiGeometry;

  // Find datasets that intersect this AOI
  const intersecting = useMemo(() => {
    if (!bbox) return [];
    return findIntersectingDatasets(bbox, datasets.filter((d) => d.status === 'ready'));
  }, [bbox, datasets]);

  const hasSelected = aoiSelectedDatasetIds.length > 0;

  // Fetch available models
  const { data: modelsData } = useQuery({
    queryKey: ['models', 'list-for-aoi'],
    queryFn: () => modelsApi.list({ page_size: 50 }),
    enabled: showInference,
  });
  const models = modelsData?.items ?? [];

  // Poll inference job while it's running
  const { data: jobData } = useQuery({
    queryKey: ['inference-job', inferenceJobId],
    queryFn: () => inferenceApi.getJob(inferenceJobId!),
    enabled: !!inferenceJobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (!status) return 3000;
      return ['pending', 'queued', 'running'].includes(status) ? 3000 : false;
    },
  });

  // When job completes, load result annotation sets onto map
  const prevJobStatusRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const status = jobData?.status;
    if (status === 'completed' && prevJobStatusRef.current !== 'completed' && inferenceJobId && mapId) {
      annotationSetsApi.listByMap(mapId).then(({ items }) => {
        const resultSets = items.filter((s) => s.created_by_job_id === inferenceJobId);
        resultSets.forEach((set) => {
          const tileUrl = annotationSetsApi.getTileUrlTemplate(set.id);
          addAnnotationSetLayer({ setId: set.id, name: set.name, tileUrl });
        });
        if (resultSets.length > 0) {
          toast.success(`${resultSets.length} inference layer${resultSets.length > 1 ? 's' : ''} added to map`);
        }
      });
    }
    prevJobStatusRef.current = status;
  }, [jobData?.status, inferenceJobId, mapId, addAnnotationSetLayer]);

  /**
   * Toggle dataset selection + create/remove bounded child layer overlay.
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
        useMapLayersStore.getState().removeAoiTimelineItems(aoiLayerId, ds.id);
      } else {
        addAoiBoundedDataset(
          aoiLayerId,
          { id: ds.id, name: ds.name, stac_collection_id: ds.stac_collection_id ?? undefined },
          bbox
        );
      }
    },
    [aoiLayerId, aoiSelectedDatasetIds, bbox, layers, toggleAoiDataset, addAoiBoundedDataset, removeAoiBoundedDataset]
  );

  // ── Inference mutation ──────────────────────────────────────────────────────
  const inferenceMut = useMutation({
    mutationFn: async () => {
      if (!selectedModelId) throw new Error('Select a model first');
      if (aoiSelectedDatasetIds.length === 0) throw new Error('Select at least one dataset');

      // Fetch items for all selected datasets (filtered by AOI bbox)
      const bboxStr = bbox ? `${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]}` : undefined;
      const itemIdArrays = await Promise.all(
        aoiSelectedDatasetIds.map((dsId) =>
          datasetsApi.listItems(dsId, { bbox: bboxStr, page_size: 500 }).then((r) =>
            r.items.map((item) => item.id)
          )
        )
      );
      const datasetItemIds = itemIdArrays.flat();
      if (datasetItemIds.length === 0) throw new Error('No dataset items found in AOI');

      return inferenceApi.run({
        model_id: selectedModelId,
        dataset_item_ids: datasetItemIds,
        map_id: mapId ?? null,
        mount_on_map: !!mapId,
      });
    },
    onSuccess: (job) => {
      setInferenceJobId(job.id);
      toast.loading('Inference job queued…', { id: `inference-${job.id}` });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to start inference');
    },
  });

  // Dismiss loading toast when job finishes
  useEffect(() => {
    if (!inferenceJobId || !jobData) return;
    if (jobData.status === 'completed') {
      toast.dismiss(`inference-${inferenceJobId}`);
      setInferenceJobId(null);
    } else if (jobData.status === 'failed') {
      toast.dismiss(`inference-${inferenceJobId}`);
      toast.error('Inference job failed' + (jobData.logs ? `: ${jobData.logs.slice(0, 120)}` : ''));
      setInferenceJobId(null);
    }
  }, [jobData?.status, inferenceJobId]);

  // ── Analysis mutations ──────────────────────────────────────────────────────
  const ndviMut = useMutation({
    mutationFn: () => {
      const dsId = aoiSelectedDatasetIds[0];
      if (!dsId || !geometry) throw new Error('No dataset or geometry');
      return analysisApi.runNdvi({ dataset_id: dsId, aoi_geometry: geometry });
    },
    onSuccess: () => toast.success('NDVI analysis started'),
    onError: () => toast.error('Failed to start NDVI analysis'),
  });

  const areaStatsMut = useMutation({
    mutationFn: () => {
      const dsId = aoiSelectedDatasetIds[0];
      if (!dsId || !geometry) throw new Error('No dataset or geometry');
      return analysisApi.runAreaStats({ dataset_id: dsId, aoi_geometry: geometry });
    },
    onSuccess: () => toast.success('Area statistics started'),
    onError: () => toast.error('Failed to start area statistics'),
  });

  const compositeMut = useMutation({
    mutationFn: () => {
      if (!geometry || aoiSelectedDatasetIds.length === 0) throw new Error('No datasets');
      return analysisApi.runComposite({ dataset_ids: aoiSelectedDatasetIds, aoi_geometry: geometry });
    },
    onSuccess: () => toast.success('Composite analysis started'),
    onError: () => toast.error('Failed to start composite'),
  });

  const changeDetMut = useMutation({
    mutationFn: () => {
      const dsId = aoiSelectedDatasetIds[0];
      if (!dsId || !geometry) throw new Error('No dataset or geometry');
      return analysisApi.runChangeDetection({
        dataset_id: dsId,
        reference_date: new Date(Date.now() - 30 * 86400000).toISOString(),
        target_date: new Date().toISOString(),
        aoi_geometry: geometry,
      });
    },
    onSuccess: () => toast.success('Change detection started'),
    onError: () => toast.error('Failed to start change detection'),
  });

  if (!layer) return null;

  const jobRunning = !!inferenceJobId && ['pending', 'queued', 'running'].includes(jobData?.status ?? 'pending');
  const jobProgress = jobData?.progress ?? null;

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
          {intersecting.length === 0 ? (
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
                  />
                ))}
            </div>
          </section>
        )}
        
        {/* ── AI Inference ─────────────────────────────────────── */}
        <section>
          <button
            onClick={() => setShowInference(!showInference)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, width: '100%',
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: '4px 0',
            }}
          >
            {showInference ? <ChevronDown size={11} color={MC.textMuted} /> : <ChevronRight size={11} color={MC.textMuted} />}
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: MC.sectionLabel }}>
              AI Inference
            </span>
          </button>

          {showInference && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '6px 0' }}>
              {!hasSelected && (
                <p style={{ fontSize: 10, color: MC.textMuted, fontStyle: 'italic', margin: 0 }}>
                  Select a dataset above to run inference on it.
                </p>
              )}

              {/* Model selector */}
              <div>
                <label style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: MC.textMuted, display: 'block', marginBottom: 3 }}>
                  Model
                </label>
                <select
                  value={selectedModelId}
                  onChange={(e) => setSelectedModelId(e.target.value)}
                  disabled={!hasSelected || jobRunning}
                  style={{
                    width: '100%', padding: '6px 8px', borderRadius: 5,
                    border: `1px solid ${MC.border}`, background: MC.inputBg ?? '#1e2518',
                    color: MC.text, fontSize: 11, cursor: hasSelected ? 'pointer' : 'not-allowed',
                    opacity: hasSelected ? 1 : 0.5,
                  }}
                >
                  <option value="">— select model —</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}{m.type ? ` (${m.type})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Job status */}
              {jobData && (
                <div style={{
                  padding: '7px 9px', borderRadius: 5,
                  background: jobData.status === 'completed'
                    ? 'rgba(21,128,61,0.1)'
                    : jobData.status === 'failed'
                    ? 'rgba(185,28,28,0.1)'
                    : MC.accentDim,
                  border: `1px solid ${
                    jobData.status === 'completed' ? 'rgba(21,128,61,0.25)'
                    : jobData.status === 'failed' ? 'rgba(185,28,28,0.25)'
                    : MC.accent}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: jobProgress != null ? 5 : 0 }}>
                    {jobRunning ? (
                      <Loader2 size={11} color={MC.accent} className="animate-spin" />
                    ) : jobData.status === 'completed' ? (
                      <CheckCircle2 size={11} color="rgb(21,128,61)" />
                    ) : (
                      <AlertCircle size={11} color="rgb(185,28,28)" />
                    )}
                    <span style={{ fontSize: 10, fontWeight: 600, color: MC.text }}>
                      {jobData.status.charAt(0).toUpperCase() + jobData.status.slice(1)}
                    </span>
                    {jobRunning && (
                      <span style={{ fontSize: 9, color: MC.textMuted, marginLeft: 'auto' }}>
                        {jobData.processed_items}/{jobData.total_items} items
                      </span>
                    )}
                  </div>
                  {jobRunning && jobProgress != null && (
                    <div style={{
                      height: 3, borderRadius: 2, background: MC.border,
                      overflow: 'hidden',
                    }}>
                      <div style={{
                        height: '100%', borderRadius: 2,
                        background: MC.accent,
                        width: `${Math.round(jobProgress * 100)}%`,
                        transition: 'width 0.3s ease',
                      }} />
                    </div>
                  )}
                </div>
              )}

              {/* Run button */}
              <button
                onClick={() => inferenceMut.mutate()}
                disabled={!hasSelected || !selectedModelId || jobRunning || inferenceMut.isPending}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  padding: '8px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600,
                  border: `1px solid ${!hasSelected || !selectedModelId || jobRunning ? MC.border : MC.accent}`,
                  background: hasSelected && selectedModelId && !jobRunning && !inferenceMut.isPending
                    ? MC.accent : 'transparent',
                  color: hasSelected && selectedModelId && !jobRunning && !inferenceMut.isPending
                    ? '#fff' : MC.textMuted,
                  cursor: hasSelected && selectedModelId && !jobRunning ? 'pointer' : 'not-allowed',
                  transition: 'all 0.12s',
                }}
              >
                {jobRunning || inferenceMut.isPending ? (
                  <>
                    <Loader2 size={11} className="animate-spin" />
                    {inferenceMut.isPending ? 'Starting…' : 'Running…'}
                  </>
                ) : (
                  <>
                    <Play size={11} />
                    Run on AOI
                  </>
                )}
              </button>

              {!mapId && (
                <p style={{ fontSize: 9, color: MC.textMuted, fontStyle: 'italic', margin: 0 }}>
                  Open a map to automatically overlay inference results.
                </p>
              )}
            </div>
          )}
        </section>

        {/* ── Analysis Actions ─────────────────────────────────── */}
        <section>
          <button
            onClick={() => setShowAnalysis(!showAnalysis)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, width: '100%',
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: '4px 0',
            }}
          >
            {showAnalysis ? <ChevronDown size={11} color={MC.textMuted} /> : <ChevronRight size={11} color={MC.textMuted} />}
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: MC.sectionLabel }}>
              Analysis
            </span>
          </button>

          {showAnalysis && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 0' }}>
              <AnalysisBtn
                icon={<TrendingUp size={12} />}
                label="Change Detection"
                disabled={!hasSelected}
                loading={changeDetMut.isPending}
                onClick={() => changeDetMut.mutate()}
              />
              <AnalysisBtn
                icon={<Layers size={12} />}
                label="NDVI"
                disabled={!hasSelected}
                loading={ndviMut.isPending}
                onClick={() => ndviMut.mutate()}
              />
              <AnalysisBtn
                icon={<BarChart3 size={12} />}
                label="Area Statistics"
                disabled={!hasSelected}
                loading={areaStatsMut.isPending}
                onClick={() => areaStatsMut.mutate()}
              />
              <AnalysisBtn
                icon={<Image size={12} />}
                label="Composite"
                disabled={aoiSelectedDatasetIds.length < 2}
                loading={compositeMut.isPending}
                onClick={() => compositeMut.mutate()}
              />
            </div>
          )}
        </section>

        {/* ⚠️ TEMP TEST FEATURE — remove this section + the import above when
            the real backend inference pipeline lands. */}
        <AoiTestInferencePanel aoiLayerId={aoiLayerId} aoiBbox={bbox} />
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

function AnalysisBtn({
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
}: {
  aoiLayerId: string;
  dataset: Dataset;
  bbox: [number, number, number, number];
}) {
  const childLayerId = `${aoiLayerId}-ds-${dataset.id}`;
  const childLayer = useMapLayersStore((s) => s.layers[childLayerId]);
  const setLayerBandSelection = useMapLayersStore((s) => s.setLayerBandSelection);

  const bboxStr = bbox.join(',');
  const { data, isLoading } = useQuery({
    queryKey: ['aoi', 'items', dataset.id, bboxStr],
    queryFn: () => datasetsApi.listItems(dataset.id, { bbox: bboxStr, page_size: 200 }),
    enabled: !!childLayer,
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
          <option key={item.id} value={item.stac_item_id}>
            {item.stac_item_id}
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
