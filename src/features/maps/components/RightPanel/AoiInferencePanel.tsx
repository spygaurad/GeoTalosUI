'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Bot, Play, Loader2, CheckCircle2, AlertCircle, X, ChevronDown, ChevronRight, Zap,
  Eye, EyeOff, Square, Trash2,
} from 'lucide-react';
import type LType from 'leaflet';
import { getMapManager } from '../../MapManager';
import { modelsApi } from '@/lib/api/models';
import { inferenceApi } from '@/lib/api/inference';
import { mapAoisApi } from '@/lib/api/map-aois';
import { annotationSetsApi } from '@/lib/api/annotation-sets';
import { annotationSetCollectionsApi, annotationSetCollectionsKey } from '@/lib/api/annotation-set-collections';
import { annotationSchemasApi } from '@/lib/api/annotation-schemas';
import { useMapLayersStore } from '@/stores/mapLayersStore';
import { useMapStore } from '@/stores/mapStore';
import { MC } from '../../mapColors';
import { buildClassStyles } from '../../utils/annotationStyles';
import type { Dataset, AIModel, AnnotationSetMount } from '@/types/api';
import type { LayerConfig } from '../../types';
import { AnalysisDetailHeader } from './AnalysisDetailHeader';

/**
 * Pull TiTiler-compatible render params (asset_bidx + rescale) from an AOI
 * source layer's bandSelection + renderingConfig stats. Mirrors the math in
 * AoiTestInferencePanel's buildItemAoiTileUrl so backend inference patches
 * use the exact same band combination the user is viewing on the map.
 * Returns null when the layer has no bandSelection (caller should send no
 * render_params; backend falls back to the dataset's default preset).
 */
function buildRenderParams(layer: LayerConfig | undefined): Record<string, string> | null {
  if (!layer?.bandSelection) return null;
  const b = layer.bandSelection;
  const params: Record<string, string> = {
    asset_bidx: `data|${b.r},${b.g},${b.b}`,
  };
  const rc = layer.renderingConfig;
  const rBand = rc?.bands?.find((x) => x.index === b.r);
  const gBand = rc?.bands?.find((x) => x.index === b.g);
  const bBand = rc?.bands?.find((x) => x.index === b.b);
  if (rBand && gBand && bBand) {
    const p2 = Math.min(rBand.stats.p2, gBand.stats.p2, bBand.stats.p2);
    const p98 = Math.max(rBand.stats.p98, gBand.stats.p98, bBand.stats.p98);
    params.rescale = `${Math.round(p2)},${Math.round(p98)}`;
  }
  return params;
}

interface AoiInferencePanelProps {
  aoiLayerId: string;
  mapId?: string;
  backendAoiId?: string;
  aoiBbox: [number, number, number, number] | undefined;
  /** Datasets selected on this AOI. */
  selectedDatasets: Dataset[];
  /** Lazy-save callback — resolves to a backend AOI id. */
  onEnsureAoi: () => Promise<string>;
  onBack: () => void;
}

interface RunMeta {
  jobId: string;
  modelName: string;
  datasetName: string;
  /** Display name for the produced annotation set layer. Format:
   *  `<className>_<aoiName>` for prompted (SAM3) runs, `<modelName>_<aoiName>`
   *  otherwise. Built when the run is queued so it survives across remounts. */
  layerName: string;
  /** Schema bound to the model — used to fetch classes + build per-class
   *  fill/stroke styles for the MVT renderer. */
  schemaId: string | null;
  /** Annotation set ids produced by the job — populated by RunRow once the
   *  job completes and the sets get mounted as map layers. Drives the
   *  Visualization aggregation + per-run visibility toggle. */
  setIds?: string[];
}

export function AoiInferencePanel({
  aoiLayerId: aoiLayerId,
  mapId,
  backendAoiId,
  aoiBbox,
  selectedDatasets,
  onEnsureAoi,
  onBack,
}: AoiInferencePanelProps) {
  const [modelId, setModelId] = useState('');
  const [datasetId, setDatasetId] = useState('');
  // When true, the run targets every item in the dataset's STAC collection
  // (scope:'dataset') rather than only the items intersecting the AOI
  // (scope:'aoi', the cheaper default). Either way the backend clips each patch
  // to the AOI bbox — scope only changes which frames run, not the spatial
  // extent. Surfaced only for collection-backed datasets — see
  // `isTemporalDataset` below.
  const [runOnCollection, setRunOnCollection] = useState(false);
  const [patchSizePx, setPatchSizePx] = useState<number | null>(null);
  const [stridePx, setStridePx] = useState<number | null>(null);
  const [textPrompt, setTextPrompt] = useState('');
  const [outputClassId, setOutputClassId] = useState('');
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [bboxPrompts, setBboxPrompts] = useState<{ id: string; bbox: [number, number, number, number] }[]>([]);
  const [runs, setRuns] = useState<RunMeta[]>([]);

  // Leaflet rectangle overlays for the drawn bbox prompts, keyed by prompt id.
  const bboxOverlaysRef = useRef<Map<string, LType.Rectangle>>(new Map());
  const bboxDrawActive = useMapLayersStore((s) => s.bboxPromptDrawMode);
  const capturedBboxPrompt = useMapLayersStore((s) => s.capturedBboxPrompt);

  // ── AOI child layers — drives the band-selection params we send to the
  // backend so its TiTiler patch render matches the user's view. ───────────
  const layerMap = useMapLayersStore((s) => s.layers);
  const aoiChildLayers = useMemo(
    () => Object.values(layerMap).filter((l) => l.parentAoiId === aoiLayerId),
    [layerMap, aoiLayerId],
  );

  // ── Models ────────────────────────────────────────────────────────────────
  const { data: modelsResp, isLoading: loadingModels } = useQuery({
    queryKey: ['models', 'list-for-inference'],
    queryFn: () => modelsApi.list({ page_size: 100 }),
  });
  const models = useMemo(() => modelsResp?.items ?? [], [modelsResp?.items]);

  useEffect(() => {
    if (modelId && models.some((m) => m.id === modelId)) return;
    setModelId(models[0]?.id ?? '');
  }, [models, modelId]);

  useEffect(() => {
    if (datasetId && selectedDatasets.some((d) => d.id === datasetId)) return;
    setDatasetId(selectedDatasets[0]?.id ?? '');
  }, [selectedDatasets, datasetId]);

  const selectedModel = models.find((m) => m.id === modelId);
  const selectedDataset = selectedDatasets.find((d) => d.id === datasetId);
  // A dataset is collection-backed (and thus eligible for a whole-collection
  // run) when it has a STAC collection id. Single-item datasets simply produce
  // one set under scope:'dataset', so the toggle is harmless there too.
  const isTemporalDataset = !!selectedDataset?.stac_collection_id;

  // Reset the collection toggle whenever a non-collection dataset is picked so
  // a stale "whole collection" choice can't leak into an AOI-only run.
  useEffect(() => {
    if (!isTemporalDataset && runOnCollection) setRunOnCollection(false);
  }, [isTemporalDataset, runOnCollection]);

  // ── Text-prompt support (SAM3-style models) ──────────────────────────────
  // A model supports text prompts when its adapter declares a prompt_key_map
  // entry for `text_prompt`. For prompted models the user picks a class from
  // the model's bound annotation schema (sent as output_class_id) AND types a
  // separate free-text prompt forwarded to the endpoint — the two are
  // intentionally decoupled because one class can be hinted by many prompts.
  const adapterCfg = (selectedModel?.output_config?.adapter_config ?? {}) as Record<string, unknown>;
  const promptKeyMap = (adapterCfg.prompt_key_map ?? {}) as Record<string, unknown>;
  const supportsTextPrompt = typeof promptKeyMap.text_prompt === 'string';
  // A model accepts bbox-exemplar prompts when its adapter maps the generic
  // `bboxes` key. The user draws rectangles on the map; we send them as
  // `bbox_prompts_4326` and the backend reprojects each into per-patch pixels.
  const supportsBboxPrompt = typeof promptKeyMap.bboxes === 'string';
  // Prompted models (text and/or bbox) always require an explicit output class —
  // the prompt is just a hint; the class labels every prediction.
  const isPrompted = supportsTextPrompt || supportsBboxPrompt;

  const modelSchemaId = selectedModel?.annotation_schema_id ?? null;
  const { data: schemaClassesResp } = useQuery({
    queryKey: ['inference-panel', 'schema-classes', modelSchemaId],
    queryFn: () => annotationSchemasApi.getClasses(modelSchemaId as string),
    enabled: !!modelSchemaId && isPrompted,
  });
  const schemaClasses = useMemo(
    () => schemaClassesResp?.items ?? [],
    [schemaClassesResp?.items],
  );

  // ── Bbox-prompt overlay management ───────────────────────────────────────
  const clearBboxPrompts = useCallback(() => {
    bboxOverlaysRef.current.forEach((r) => r.remove());
    bboxOverlaysRef.current.clear();
    setBboxPrompts([]);
  }, []);

  const removeBboxPrompt = useCallback((id: string) => {
    const rect = bboxOverlaysRef.current.get(id);
    if (rect) { rect.remove(); bboxOverlaysRef.current.delete(id); }
    setBboxPrompts((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const toggleBboxDraw = useCallback(() => {
    const store = useMapLayersStore.getState();
    if (store.bboxPromptDrawMode) {
      store.setBboxPromptDrawMode(false);
      useMapStore.getState().setActiveDrawTool(null);
    } else {
      store.setBboxPromptDrawMode(true);
      useMapStore.getState().setActiveDrawTool('rectangle');
    }
  }, []);

  // Consume a freshly drawn rectangle: append it to the list and render a styled
  // overlay, then clear the relay slot so the next draw is picked up cleanly.
  useEffect(() => {
    if (!capturedBboxPrompt) return;
    const bbox = capturedBboxPrompt;
    useMapLayersStore.getState().setCapturedBboxPrompt(null);
    const id = `bp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    setBboxPrompts((prev) => [...prev, { id, bbox }]);
    (async () => {
      const L: typeof LType = (await import('leaflet')).default;
      const map = getMapManager().getMap();
      if (!map) return;
      const [W, S, E, N] = bbox;
      const rect = L.rectangle([[S, W], [N, E]], {
        color: MC.accent, weight: 1.5, dashArray: '4 3',
        fillColor: MC.accent, fillOpacity: 0.08, interactive: false,
      });
      rect.addTo(map);
      bboxOverlaysRef.current.set(id, rect);
    })();
  }, [capturedBboxPrompt]);

  // Tear down overlays + draw mode when the panel unmounts.
  useEffect(() => {
    const overlays = bboxOverlaysRef.current;
    return () => {
      overlays.forEach((r) => r.remove());
      overlays.clear();
      const store = useMapLayersStore.getState();
      if (store.bboxPromptDrawMode) {
        store.setBboxPromptDrawMode(false);
        useMapStore.getState().setActiveDrawTool(null);
      }
    };
  }, []);

  // Reset prompt + class + bbox prompts when the model changes so stale picks
  // don't leak into the next run (especially across different schemas).
  useEffect(() => {
    setTextPrompt('');
    setOutputClassId('');
    clearBboxPrompts();
  }, [modelId, clearBboxPrompts]);

  // ── Run inference ────────────────────────────────────────────────────────
  const inferenceMut = useMutation({
    mutationFn: async () => {
      if (!mapId) throw new Error('Map not available');
      if (!aoiBbox) throw new Error('AOI bbox missing');
      if (!selectedModel) throw new Error('Pick a model');
      if (!selectedDataset) throw new Error('Pick a dataset');
      const hasText = supportsTextPrompt && !!textPrompt.trim();
      const hasBbox = supportsBboxPrompt && bboxPrompts.length > 0;
      if (isPrompted) {
        if (!outputClassId) throw new Error('Pick the output class');
        if (!hasText && !hasBbox) {
          throw new Error('Enter a text prompt or draw at least one bbox prompt');
        }
      }

      const aoiId = backendAoiId ?? (await onEnsureAoi());
      if (!aoiId) throw new Error('AOI could not be saved');

      const payload: Parameters<typeof mapAoisApi.createInferenceJob>[2] = {
        model_id: selectedModel.id,
        // 'dataset' fans out over every item in the collection; 'aoi' runs only
        // on items intersecting the AOI (cheaper, the default). Both clip each
        // patch to the AOI bbox on the backend. Only collection-backed datasets
        // expose the toggle, so runOnCollection can't be true otherwise.
        scope: runOnCollection ? 'dataset' : 'aoi',
        dataset_id: selectedDataset.id,
        mount_on_map: true,
      };
      if (patchSizePx != null) payload.patch_size_px = patchSizePx;
      if (stridePx != null) payload.stride_px = stridePx;
      if (isPrompted) {
        // One SAM3 model serves text / bbox / text+bbox. The adapter's
        // prompt_key_map forwards `text_prompt` -> `text_prompts` and
        // `bboxes` -> `bboxes`; bbox prompts are sent as geo `bbox_prompts_4326`
        // and reprojected per-patch on the backend.
        const promptPayload: Record<string, unknown> = {};
        if (hasText) {
          promptPayload.text_prompt = textPrompt
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        }
        if (hasBbox) {
          promptPayload.bbox_prompts_4326 = bboxPrompts.map((b) => b.bbox);
        }
        payload.prompt_payload = promptPayload;
        payload.output_class_id = outputClassId;
      }
      const sourceLayer = aoiChildLayers.find(
        (l) => l.sourceDatasetId === selectedDataset.id,
      );
      const renderParams = buildRenderParams(sourceLayer);
      if (renderParams) payload.render_params = renderParams;

      const job = await mapAoisApi.createInferenceJob(mapId, aoiId, payload);
      const aoiName = layerMap[aoiLayerId]?.name ?? 'aoi';
      const chosenClass = outputClassId
        ? schemaClasses.find((c) => c.id === outputClassId)?.name
        : undefined;
      const layerName = `${chosenClass ?? selectedModel.name}_${aoiName}`;
      return {
        job,
        modelName: selectedModel.name,
        datasetName: selectedDataset.name,
        layerName,
        schemaId: selectedModel.annotation_schema_id,
      };
    },
    onSuccess: ({ job, modelName, datasetName, layerName, schemaId }) => {
      setRuns((prev) => [
        { jobId: job.id, modelName, datasetName, layerName, schemaId },
        ...prev,
      ]);
      toast.success(`Inference queued — ${modelName} on ${datasetName}`);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to start inference');
    },
  });

  const dismissRun = useCallback((jobId: string) => {
    setRuns((prev) => prev.filter((r) => r.jobId !== jobId));
  }, []);

  const handleRunSetsResolved = useCallback((jobId: string, setIds: string[]) => {
    setRuns((prev) => prev.map((r) => (r.jobId === jobId ? { ...r, setIds } : r)));
  }, []);

  const canRun =
    !!mapId && !!aoiBbox && !!selectedModel && !!selectedDataset && !inferenceMut.isPending;

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <AnalysisDetailHeader title="Run Inference" icon={<Bot size={11} />} onBack={onBack} />

      {/* Model */}
      <Field label="Model">
        {loadingModels ? (
          <p style={{ fontSize: 10, color: MC.textMuted, margin: 0 }}>Loading models…</p>
        ) : models.length === 0 ? (
          <p style={{ fontSize: 10, color: MC.textMuted, fontStyle: 'italic', margin: 0 }}>
            No models registered. Add one from the Models page.
          </p>
        ) : (
          <select
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            style={selectStyle}
          >
            {models.map((m) => {
              const label = [m.name, m.version ? `v${m.version}` : null, m.type]
                .filter(Boolean).join(' · ');
              return <option key={m.id} value={m.id}>{label}</option>;
            })}
          </select>
        )}
        {selectedModel && (
          <div style={{ fontSize: 9, color: MC.textMuted, marginTop: 3 }}>
            {selectedModel.framework ? selectedModel.framework : 'custom'}
            {selectedModel.output_config?.adapter
              ? ` · adapter: ${selectedModel.output_config.adapter as string}`
              : ''}
          </div>
        )}
      </Field>

      {/* Dataset */}
      <Field label="Dataset">
        {selectedDatasets.length === 0 ? (
          <p style={{ fontSize: 10, color: MC.textMuted, fontStyle: 'italic', margin: 0 }}>
            Select a dataset on this AOI first (above).
          </p>
        ) : (
          <select
            value={datasetId}
            onChange={(e) => setDatasetId(e.target.value)}
            style={selectStyle}
          >
            {selectedDatasets.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        )}
        {isTemporalDataset && (
          <label
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 6,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={runOnCollection}
              onChange={(e) => setRunOnCollection(e.target.checked)}
              style={{ marginTop: 1, accentColor: MC.accent, cursor: 'pointer' }}
            />
            <span style={{ fontSize: 9, lineHeight: 1.4, color: MC.textSecondary }}>
              <span style={{ fontWeight: 600, color: MC.text }}>Run on collection</span>
              <br />
              {runOnCollection
                ? 'Runs over every item in the temporal collection — each still clipped to this AOI region — one annotation set per frame, grouped for playback. Slower / more compute.'
                : 'Runs only on items intersecting this AOI, clipped to the AOI region (cheaper). Check to process the whole temporal sequence.'}
            </span>
          </label>
        )}
      </Field>

      {/* Class + prompt — for prompted adapters (SAM3-style). Class drives the
          annotation label; the prompt (text and/or drawn bbox exemplars) is
          forwarded to the endpoint. They're intentionally separate — many
          prompts can map to one class. One model serves text / bbox / both. */}
      {isPrompted && (
        <div>
          <button
            type="button"
            onClick={() => setPromptsOpen(!promptsOpen)}
            style={{
              display: 'flex', alignItems: 'center', gap: 4, width: '100%',
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: '4px 0', color: MC.textSecondary,
            }}
          >
            {promptsOpen
              ? <ChevronDown size={11} color={MC.textMuted} />
              : <ChevronRight size={11} color={MC.textMuted} />}
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
              textTransform: 'uppercase', color: MC.textMuted,
            }}>
              Class & prompt
              {outputClassId && (() => {
                const c = schemaClasses.find((sc) => sc.id === outputClassId);
                return c ? <span style={{ color: MC.accent }}> · {c.name}</span> : null;
              })()}
              {bboxPrompts.length > 0 && (
                <span style={{ color: MC.accent }}> · {bboxPrompts.length} box{bboxPrompts.length === 1 ? '' : 'es'}</span>
              )}
            </span>
          </button>

          {promptsOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4 }}>
              {modelSchemaId == null ? (
                <p style={{ fontSize: 9, color: MC.textMuted, fontStyle: 'italic', margin: 0 }}>
                  This model has no annotation schema bound. Edit it on /models
                  and pick a schema before running.
                </p>
              ) : schemaClasses.length === 0 ? (
                <p style={{ fontSize: 9, color: MC.textMuted, fontStyle: 'italic', margin: 0 }}>
                  The bound schema has no classes — add one first.
                </p>
              ) : (
                <Field label="Output class (labels every prediction)">
                  <select
                    value={outputClassId}
                    onChange={(e) => setOutputClassId(e.target.value)}
                    style={selectStyle}
                  >
                    <option value="">— pick a class —</option>
                    {schemaClasses.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </Field>
              )}
              {supportsTextPrompt && (
                <Field label="Text prompt (optional)">
                  <input
                    value={textPrompt}
                    onChange={(e) => setTextPrompt(e.target.value)}
                    placeholder="e.g. yellow excavator, bulldozer"
                    style={inputStyle}
                  />
                  <p style={{ fontSize: 8, color: MC.textMuted, marginTop: 3, lineHeight: 1.4 }}>
                    Free-form prompt sent to the model. Independent from the class
                    above — many prompts can target the same class.
                  </p>
                </Field>
              )}
              {supportsBboxPrompt && (
                <Field label="Bbox prompts (optional)">
                  <button
                    type="button"
                    onClick={toggleBboxDraw}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      width: '100%', padding: '6px 8px', borderRadius: 5,
                      fontSize: 10, fontWeight: 600,
                      border: `1px solid ${bboxDrawActive ? MC.accent : MC.border}`,
                      background: bboxDrawActive ? MC.accent : 'transparent',
                      color: bboxDrawActive ? '#fff' : MC.textSecondary,
                      cursor: 'pointer', transition: 'all 0.12s',
                    }}
                  >
                    <Square size={11} />
                    {bboxDrawActive ? 'Drawing… click to stop' : 'Draw bbox on map'}
                  </button>
                  {bboxPrompts.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6 }}>
                      {bboxPrompts.map((b, i) => (
                        <div key={b.id} style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          fontSize: 9, color: MC.textSecondary,
                          border: `1px solid ${MC.border}`, borderRadius: 4, padding: '3px 6px',
                        }}>
                          <Square size={9} color={MC.accent} />
                          <span style={{ flex: 1, fontFamily: 'monospace' }}>
                            Box {i + 1}: {b.bbox.map((v) => v.toFixed(4)).join(', ')}
                          </span>
                          <button
                            onClick={() => removeBboxPrompt(b.id)}
                            title="Remove box"
                            style={{
                              display: 'flex', background: 'transparent', border: 'none',
                              color: MC.textMuted, cursor: 'pointer', padding: 0,
                            }}
                          >
                            <X size={10} />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={clearBboxPrompts}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
                          background: 'transparent', border: 'none', color: MC.textMuted,
                          fontSize: 9, cursor: 'pointer', padding: '2px 0',
                        }}
                      >
                        <Trash2 size={9} /> Clear all
                      </button>
                    </div>
                  )}
                  <p style={{ fontSize: 8, color: MC.textMuted, marginTop: 3, lineHeight: 1.4 }}>
                    Draw example boxes around target objects. Only patches a box
                    overlaps are sent to the model; boxes are reprojected per patch.
                  </p>
                </Field>
              )}
            </div>
          )}
        </div>
      )}

      {/* Patch size override */}
      <Field label={`Patch size ${patchSizePx == null ? '(model default)' : `(${patchSizePx}px)`}`}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="range" min={128} max={2048} step={64}
            value={patchSizePx ?? 1024}
            onChange={(e) => setPatchSizePx(Number(e.target.value))}
            disabled={patchSizePx == null}
            style={{ flex: 1, opacity: patchSizePx == null ? 0.5 : 1 }}
          />
          <label style={overrideLabelStyle}>
            <input
              type="checkbox"
              checked={patchSizePx != null}
              onChange={(e) => setPatchSizePx(e.target.checked ? 1024 : null)}
            />
            override
          </label>
        </div>
      </Field>

      {/* Stride override */}
      <Field label={`Stride ${stridePx == null ? '(model default)' : `(${stridePx}px)`}`}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="range" min={64} max={2048} step={32}
            value={stridePx ?? Math.min(patchSizePx ?? 1024, 1024)}
            onChange={(e) => setStridePx(Number(e.target.value))}
            disabled={stridePx == null}
            style={{ flex: 1, opacity: stridePx == null ? 0.5 : 1 }}
          />
          <label style={overrideLabelStyle}>
            <input
              type="checkbox"
              checked={stridePx != null}
              onChange={(e) => setStridePx(e.target.checked ? (patchSizePx ?? 1024) : null)}
            />
            override
          </label>
        </div>
      </Field>

      {!aoiBbox && (
        <p style={{ fontSize: 9, color: MC.textMuted, fontStyle: 'italic', margin: 0 }}>
          Draw an AOI before running inference.
        </p>
      )}

      {/* Run button */}
      <button
        onClick={() => inferenceMut.mutate()}
        disabled={!canRun}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          padding: '8px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600,
          border: `1px solid ${canRun ? MC.accent : MC.border}`,
          background: canRun ? MC.accent : 'transparent',
          color: canRun ? '#fff' : MC.textMuted,
          cursor: canRun ? 'pointer' : 'not-allowed',
          transition: 'all 0.12s',
        }}
      >
        {inferenceMut.isPending
          ? <><Loader2 size={11} className="animate-spin" /> Queueing…</>
          : <><Play size={11} /> Run on AOI</>}
      </button>

      <p style={{ fontSize: 8, color: MC.textMuted, margin: 0, lineHeight: 1.4 }}>
        Runs on the selected dataset clipped to this AOI. Each run creates an
        annotation set per item, mounted as a layer on the map when complete.
      </p>

      {/* ── Quick Test panel ── one-click runner that reuses the AOI + selected
            dataset and queues a backend inference job with model defaults. */}
      <QuickTestPanel
        models={models}
        loadingModels={loadingModels}
        selectedDataset={selectedDataset}
        aoiBbox={aoiBbox}
        aoiName={layerMap[aoiLayerId]?.name ?? 'aoi'}
        aoiChildLayers={aoiChildLayers}
        mapId={mapId}
        backendAoiId={backendAoiId}
        onEnsureAoi={onEnsureAoi}
        onRunQueued={(meta) => setRuns((prev) => [meta, ...prev])}
      />

      {/* Active / completed runs */}
      {runs.length > 0 && (
        <div style={{
          borderTop: `1px dashed ${MC.border}`, paddingTop: 8, marginTop: 4,
          display: 'flex', flexDirection: 'column', gap: 4,
        }}>
          {runs.map((r) => (
            <RunRow
              key={r.jobId}
              run={r}
              mapId={mapId}
              onDismiss={() => dismissRun(r.jobId)}
              onSetsResolved={handleRunSetsResolved}
            />
          ))}
        </div>
      )}

    </section>
  );
}

// ── Quick Test panel ────────────────────────────────────────────────────────
// Compact runner that lets the user pick any registered model, optionally type
// a class prompt for SAM3-style models, and fire a backend inference job using
// the model's own patch/stride defaults. Results stream into the same runs
// list as the main "Run on AOI" flow.

interface QuickTestPanelProps {
  models: AIModel[];
  loadingModels: boolean;
  selectedDataset: Dataset | undefined;
  aoiBbox: [number, number, number, number] | undefined;
  aoiName: string;
  aoiChildLayers: LayerConfig[];
  mapId?: string;
  backendAoiId?: string;
  onEnsureAoi: () => Promise<string>;
  onRunQueued: (meta: RunMeta) => void;
}

function QuickTestPanel({
  models, loadingModels, selectedDataset, aoiBbox, aoiName, aoiChildLayers,
  mapId, backendAoiId, onEnsureAoi, onRunQueued,
}: QuickTestPanelProps) {
  const [open, setOpen] = useState(false);
  const [quickModelId, setQuickModelId] = useState('');
  const [quickPrompt, setQuickPrompt] = useState('');
  const [quickClassId, setQuickClassId] = useState('');

  useEffect(() => {
    if (quickModelId && models.some((m) => m.id === quickModelId)) return;
    setQuickModelId(models[0]?.id ?? '');
  }, [models, quickModelId]);

  const quickModel = models.find((m) => m.id === quickModelId);
  const quickAdapterCfg =
    (quickModel?.output_config?.adapter_config ?? {}) as Record<string, unknown>;
  const quickPromptKeyMap =
    (quickAdapterCfg.prompt_key_map ?? {}) as Record<string, unknown>;
  const quickNeedsPrompt = typeof quickPromptKeyMap.text_prompt === 'string';

  const quickSchemaId = quickModel?.annotation_schema_id ?? null;
  const { data: quickSchemaClassesResp } = useQuery({
    queryKey: ['quick-test', 'schema-classes', quickSchemaId],
    queryFn: () => annotationSchemasApi.getClasses(quickSchemaId as string),
    enabled: !!quickSchemaId && quickNeedsPrompt,
  });
  const quickSchemaClasses = useMemo(
    () => quickSchemaClassesResp?.items ?? [],
    [quickSchemaClassesResp?.items],
  );

  // Reset prompt + class when the model changes so stale picks don't leak in.
  useEffect(() => { setQuickPrompt(''); setQuickClassId(''); }, [quickModelId]);

  const quickMut = useMutation({
    mutationFn: async () => {
      if (!mapId) throw new Error('Map not available');
      if (!aoiBbox) throw new Error('AOI bbox missing');
      if (!quickModel) throw new Error('Pick a model');
      if (!selectedDataset) throw new Error('Select a dataset on this AOI first');
      if (quickNeedsPrompt) {
        if (!quickClassId) throw new Error('Pick the output class');
        if (!quickPrompt.trim()) throw new Error('Enter a text prompt');
      }

      const aoiId = backendAoiId ?? (await onEnsureAoi());
      if (!aoiId) throw new Error('AOI could not be saved');

      const payload: Parameters<typeof mapAoisApi.createInferenceJob>[2] = {
        model_id: quickModel.id,
        scope: 'aoi',
        dataset_id: selectedDataset.id,
        mount_on_map: true,
      };
      if (quickNeedsPrompt) {
        // SAM3 expects list; split CSV so users can hint with multiple phrases.
        const promptList = quickPrompt
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        payload.prompt_payload = { text_prompt: promptList };
        payload.output_class_id = quickClassId;
      }
      const sourceLayer = aoiChildLayers.find(
        (l) => l.sourceDatasetId === selectedDataset.id,
      );
      const renderParams = buildRenderParams(sourceLayer);
      if (renderParams) payload.render_params = renderParams;
      const job = await mapAoisApi.createInferenceJob(mapId, aoiId, payload);
      const chosenClass = quickClassId
        ? quickSchemaClasses.find((c) => c.id === quickClassId)?.name
        : undefined;
      const layerName = `${chosenClass ?? quickModel.name}_${aoiName}`;
      return {
        job,
        modelName: quickModel.name,
        datasetName: selectedDataset.name,
        layerName,
        schemaId: quickModel.annotation_schema_id,
      };
    },
    onSuccess: ({ job, modelName, datasetName, layerName, schemaId }) => {
      onRunQueued({ jobId: job.id, modelName, datasetName, layerName, schemaId });
      toast.success(`Quick test queued — ${modelName}`);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Quick test failed to start');
    },
  });

  const canQuickRun =
    !!mapId && !!aoiBbox && !!quickModel && !!selectedDataset && !quickMut.isPending;

  return (
    <section style={{ borderTop: `1px dashed ${MC.border}`, paddingTop: 8 }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, width: '100%',
          background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 0',
        }}
      >
        {open ? <ChevronDown size={11} color={MC.textMuted} /> : <ChevronRight size={11} color={MC.textMuted} />}
        <Zap size={11} color={MC.accent} />
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
          textTransform: 'uppercase', color: MC.sectionLabel,
        }}>
          Quick Test
        </span>
      </button>

      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 6 }}>
          <Field label="Model">
            {loadingModels ? (
              <p style={{ fontSize: 10, color: MC.textMuted, margin: 0 }}>Loading…</p>
            ) : models.length === 0 ? (
              <p style={{ fontSize: 10, color: MC.textMuted, fontStyle: 'italic', margin: 0 }}>
                Register a model first.
              </p>
            ) : (
              <select
                value={quickModelId}
                onChange={(e) => setQuickModelId(e.target.value)}
                style={selectStyle}
              >
                {models.map((m) => {
                  const label = [m.name, m.version ? `v${m.version}` : null, m.type]
                    .filter(Boolean).join(' · ');
                  return <option key={m.id} value={m.id}>{label}</option>;
                })}
              </select>
            )}
          </Field>

          {quickNeedsPrompt && (
            <>
              {quickSchemaId == null ? (
                <p style={{ fontSize: 9, color: MC.textMuted, fontStyle: 'italic', margin: 0 }}>
                  This model has no annotation schema bound.
                </p>
              ) : quickSchemaClasses.length === 0 ? (
                <p style={{ fontSize: 9, color: MC.textMuted, fontStyle: 'italic', margin: 0 }}>
                  Bound schema has no classes.
                </p>
              ) : (
                <Field label="Output class">
                  <select
                    value={quickClassId}
                    onChange={(e) => setQuickClassId(e.target.value)}
                    style={selectStyle}
                  >
                    <option value="">— pick a class —</option>
                    {quickSchemaClasses.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="Text prompt">
                <input
                  value={quickPrompt}
                  onChange={(e) => setQuickPrompt(e.target.value)}
                  placeholder="e.g. yellow excavator"
                  style={inputStyle}
                />
              </Field>
            </>
          )}

          <button
            onClick={() => quickMut.mutate()}
            disabled={!canQuickRun}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '6px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600,
              border: `1px solid ${canQuickRun ? MC.accent : MC.border}`,
              background: canQuickRun ? 'transparent' : 'transparent',
              color: canQuickRun ? MC.accent : MC.textMuted,
              cursor: canQuickRun ? 'pointer' : 'not-allowed',
              transition: 'all 0.12s',
            }}
          >
            {quickMut.isPending
              ? <><Loader2 size={11} className="animate-spin" /> Queueing…</>
              : <><Zap size={11} /> Quick Run</>}
          </button>

          <p style={{ fontSize: 8, color: MC.textMuted, margin: 0, lineHeight: 1.4 }}>
            Reuses the dataset and AOI above. Patch size and stride come from the
            model&apos;s registration defaults.
          </p>
        </div>
      )}
    </section>
  );
}

// ── Run row ─────────────────────────────────────────────────────────────────

interface RunRowProps {
  run: RunMeta;
  mapId?: string;
  onDismiss: () => void;
  onSetsResolved: (jobId: string, setIds: string[]) => void;
}

/**
 * Group a completed multi-frame run's per-item annotation sets into one
 * AnnotationSetCollection so the sequence becomes a single selectable series
 * in Temporal Playback. Best-effort: failures (e.g. a 409 name collision, or a
 * schema-less model) leave the sets on the map individually playable.
 */
async function groupRunIntoCollection(
  sets: AnnotationSetMount[],
  run: RunMeta,
  queryClient: ReturnType<typeof useQueryClient>,
): Promise<void> {
  if (!run.schemaId) return;
  try {
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const name = `${run.layerName} · ${stamp}`;
    const collection = await annotationSetCollectionsApi.create({
      schema_id: run.schemaId,
      name,
      description: `${run.modelName} on ${run.datasetName} — ${sets.length} frames`,
    });
    await Promise.allSettled(
      sets.map((s) => annotationSetCollectionsApi.addSet(collection.id, s.annotation_set_id)),
    );
    void queryClient.invalidateQueries({ queryKey: annotationSetCollectionsKey(run.schemaId) });
    void queryClient.invalidateQueries({ queryKey: annotationSetCollectionsKey() });
    toast.success(`Grouped ${sets.length} sets into "${name}" for playback`);
  } catch (err) {
    toast.message(
      `Sets added, but collection grouping failed: ${err instanceof Error ? err.message : 'unknown error'}`,
    );
  }
}

function RunRow({ run, mapId, onDismiss, onSetsResolved }: RunRowProps) {
  const addAnnotationSetLayer = useMapLayersStore((s) => s.addAnnotationSetLayer);
  const setLayerVisible = useMapLayersStore((s) => s.setLayerVisible);
  const queryClient = useQueryClient();
  const layersAddedRef = useRef(false);
  const [resultCount, setResultCount] = useState<number | null>(null);
  const [overlayVisible, setOverlayVisible] = useState(true);

  const { data: job, error } = useQuery({
    queryKey: ['inference-job', run.jobId],
    queryFn: () => inferenceApi.getJob(run.jobId),
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      if (!status) return 3000;
      return ['pending', 'queued', 'running'].includes(status) ? 3000 : false;
    },
  });

  useEffect(() => {
    if (job?.status !== 'completed' || !mapId || layersAddedRef.current) return;
    layersAddedRef.current = true;
    (async () => {
      try {
        // Pre-fetch schema classes so the MVT renderer can color polygons by
        // class — without this `classStyles` is undefined and the layer shows
        // nothing on the map (just appears in the left panel).
        const classes = run.schemaId
          ? (await annotationSchemasApi.getClasses(run.schemaId)).items
          : [];
        const classStyles = buildClassStyles(classes);

        const { items } = await annotationSetsApi.listByMap(mapId);
        const sets = items.filter((s) => s.job_id === run.jobId);
        sets.forEach((set, i) => {
          // Single set per run in the common case (one dataset_item). When the
          // model fans out across multiple items we suffix with the stac_item_id
          // so each AnnotationSet gets a distinct legend entry.
          const suffix = sets.length > 1 && set.stac_item_id ? `_${set.stac_item_id.slice(0, 8)}` : '';
          addAnnotationSetLayer({
            setId: set.annotation_set_id,
            name: `${run.layerName}${suffix}` || `inference_${i}`,
            datasetId: set.dataset_id ?? undefined,
            stacItemId: set.stac_item_id ?? undefined,
            tileUrl: annotationSetsApi.getTileUrlTemplate(set.annotation_set_id),
            classStyles,
          });
        });
        setResultCount(sets.length);
        if (sets.length > 0) {
          onSetsResolved(run.jobId, sets.map((s) => s.annotation_set_id));
          toast.success(`${run.modelName}: ${sets.length} annotation set${sets.length === 1 ? '' : 's'} added`);

          // Group multi-frame runs into an AnnotationSetCollection so the
          // sequence is one selectable series in Temporal Playback. A single
          // set (single-item run) doesn't need a collection. Requires the
          // model to have a schema (collections are schema-scoped); schema-less
          // models fall back to ungrouped sets (still individually visible).
          if (sets.length > 1 && run.schemaId) {
            void groupRunIntoCollection(sets, run, queryClient);
          }
        } else {
          toast.message(`${run.modelName}: completed with no outputs`);
        }
      } catch (err) {
        toast.error(
          `Failed to load inference results: ${err instanceof Error ? err.message : 'unknown error'}`,
        );
      }
    })();
  }, [job?.status, mapId, run.jobId, run.modelName, run.layerName, run.schemaId, run, addAnnotationSetLayer, onSetsResolved, queryClient]);

  const toggleOverlayVisibility = useCallback(() => {
    const next = !overlayVisible;
    setOverlayVisible(next);
    (run.setIds ?? []).forEach((setId) => setLayerVisible(`annset-${setId}`, next));
  }, [overlayVisible, run.setIds, setLayerVisible]);

  const status = job?.status ?? 'pending';
  const progressPct = job?.progress != null ? Math.round(job.progress * 100) : null;
  const inFlight = ['pending', 'queued', 'running'].includes(status);
  const failed = status === 'failed' || !!error;
  const done = status === 'completed';

  const statusIcon = failed
    ? <AlertCircle size={11} color="#dc2626" />
    : done
      ? <CheckCircle2 size={11} color="#16a34a" />
      : <Loader2 size={11} className="animate-spin" color={MC.accent} />;

  return (
    <div style={{
      border: `1px solid ${MC.border}`, borderRadius: 5,
      padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {statusIcon}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 10, fontWeight: 600, color: MC.text,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {run.modelName}
          </div>
          <div style={{
            fontSize: 8, color: MC.textMuted,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {run.datasetName} · {status}
            {inFlight && job && job.total_items > 0
              ? ` · ${job.processed_items}/${job.total_items}`
              : ''}
            {done && resultCount != null ? ` · ${resultCount} set${resultCount === 1 ? '' : 's'}` : ''}
          </div>
        </div>
        {done && (run.setIds?.length ?? 0) > 0 && (
          <button
            onClick={toggleOverlayVisibility}
            title={overlayVisible ? 'Hide overlay on map' : 'Show overlay on map'}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 2, borderRadius: 3,
              background: 'transparent', border: 'none',
              color: MC.textMuted, cursor: 'pointer',
            }}
          >
            {overlayVisible ? <Eye size={10} /> : <EyeOff size={10} />}
          </button>
        )}
        <button
          onClick={onDismiss}
          title="Dismiss from list"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 2, borderRadius: 3,
            background: 'transparent', border: 'none',
            color: MC.textMuted, cursor: 'pointer',
          }}
        >
          <X size={10} />
        </button>
      </div>

      {inFlight && progressPct != null && (
        <div style={{ height: 3, borderRadius: 2, background: MC.border, overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: `${progressPct}%`, background: MC.accent,
            transition: 'width 0.3s ease',
          }} />
        </div>
      )}

      {failed && job?.logs && (
        <div style={{
          fontSize: 9, color: '#dc2626', fontFamily: 'monospace',
          maxHeight: 60, overflow: 'auto', wordBreak: 'break-word',
        }}>
          {job.logs.slice(0, 240)}
        </div>
      )}
    </div>
  );
}


// ── Helpers ─────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
        textTransform: 'uppercase', color: MC.textMuted,
        display: 'block', marginBottom: 3,
      }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  width: '100%', padding: '6px 8px', borderRadius: 5,
  border: `1px solid ${MC.border}`, background: MC.inputBg ?? '#1e2518',
  color: MC.text, fontSize: 11, cursor: 'pointer',
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 8px', borderRadius: 5,
  border: `1px solid ${MC.border}`, background: MC.inputBg ?? '#1e2518',
  color: MC.text, fontSize: 11,
};

const overrideLabelStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 4,
  fontSize: 9, color: MC.textMuted, cursor: 'pointer',
};
