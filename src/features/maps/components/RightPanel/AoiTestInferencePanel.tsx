'use client';

/**
 * ⚠️ TEMPORARY TEST FEATURE — REMOVE WHEN BACKEND INTEGRATION LANDS
 *
 * Calls the standalone PalmAPI inference service (GreenMark/src/palm_api/app.py)
 * running on http://localhost:8012 directly from the browser.
 *
 * Flow:
 *   1. The user picks the source layer from the AOI's child layers (each AOI
 *      child layer is a dataset clipped to the AOI, already configured with
 *      band selection from the left-panel "Band" context menu).
 *   2. We fetch the same tiles Leaflet is rendering, stitch + crop to the AOI
 *      bbox, and POST the resulting PNG to the chosen PalmAPI endpoint.
 *   3. Detected boxes / RLE masks / pose keypoints are reprojected to lat/lng
 *      using the AOI bbox as the geographic extent of the patch and overlaid
 *      on the map with the selected schema-class style.
 *
 * Each "Run on AOI" produces an independent **inference run** that is kept
 * in a module-level registry. Runs survive component remounts (so switching
 * to a different AOI keeps prior overlays alive), and multiple runs can stack
 * on the same AOI or on different AOIs simultaneously. They live until the
 * user removes them or the page reloads.
 *
 * Endpoints:
 *   /predict/upload                YOLO detection (bboxes)
 *   /segment/upload                YOLO + SAM2  (bboxes + RLE masks)
 *   /segment/sam3/text             SAM3 text prompts (bboxes + masks)
 *   /segment/sam3/bbox             SAM3 bbox prompts (bboxes + masks)
 *   /segment/sam3/multimodal       SAM3 text + bbox prompts (bboxes + masks)
 *   /predict/crown                 YOLOv11-Pose (bboxes + keypoints)
 *
 * To remove this feature: delete this file and remove the import + JSX in
 * AoiPanel.tsx (search for "AoiTestInferencePanel").
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Beaker, Play, Loader2, Trash2, ChevronDown, ChevronRight, Eye, EyeOff, SlidersHorizontal,
} from 'lucide-react';
import type LType from 'leaflet';
import { getMapManager } from '../../MapManager';
import { useMapLayersStore } from '@/stores/mapLayersStore';
import { annotationSchemasApi } from '@/lib/api/annotation-schemas';
import { datasetsApi } from '@/lib/api/datasets';
import { normalizeClassStyleDefinition } from '../../utils/annotationStyles';
import { MC } from '../../mapColors';
import type { LayerConfig } from '../../types';
import type { RenderingConfig } from '@/types/api';

const PALM_API_BASE = 'http://localhost:8012';
const TILE_SIZE = 256;
const MAX_TILES = 64;          // safety cap when stitching

type EndpointKey =
  | 'predict_upload'
  | 'segment_upload'
  | 'sam3_text'
  | 'sam3_bbox'
  | 'sam3_multimodal'
  | 'predict_crown';

interface EndpointMeta {
  label: string;
  path: string;
  needsText: 'none' | 'single' | 'csv';
  needsBboxPrompt: boolean;
}

const ENDPOINTS: Record<EndpointKey, EndpointMeta> = {
  predict_upload:   { label: 'YOLO Detect',          path: '/predict/upload',          needsText: 'none',   needsBboxPrompt: false },
  segment_upload:   { label: 'YOLO + SAM2',          path: '/segment/upload',          needsText: 'none',   needsBboxPrompt: false },
  sam3_text:        { label: 'SAM3 (text)',          path: '/segment/sam3/text',       needsText: 'csv',    needsBboxPrompt: false },
  sam3_bbox:        { label: 'SAM3 (bbox)',          path: '/segment/sam3/bbox',       needsText: 'none',   needsBboxPrompt: true  },
  sam3_multimodal:  { label: 'SAM3 (text+bbox)',     path: '/segment/sam3/multimodal', needsText: 'single', needsBboxPrompt: true  },
  predict_crown:    { label: 'YOLO Pose / Crown',    path: '/predict/crown',           needsText: 'none',   needsBboxPrompt: false },
};

// ── Backend response shapes ───────────────────────────────────────────────────
interface BackendDetection {
  bbox_xyxy: [number, number, number, number];
  class_name?: string;
  item_name?: string;
  confidence?: number;
  keypoints?: Array<{ x: number; y: number; confidence: number; index: number; name?: string | null }>;
}
interface BackendUncompressedRLE { size: [number, number]; counts: number[] }
interface BackendMask {
  bbox: number[];
  class_name?: string;
  rle: BackendUncompressedRLE;
  confidence?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Module-level inference run registry. Persists across component remounts so
// switching to another AOI panel does NOT clear prior overlays from the map.
// Runs live until explicitly removed (or page reload).
// ─────────────────────────────────────────────────────────────────────────────

type ClassStyle = ReturnType<typeof normalizeClassStyleDefinition>;

type OverlayType = 'keypoint' | 'mask';
type ColorMode = 'class' | 'confidence';
interface RunOverlay {
  layer: LType.Layer;
  type: OverlayType;
  confidence?: number; // 0..1 — used by the Visualization confidence filter
  className?: string;  // per-overlay class (falls back to run.className)
  areaPx?: number;     // mask area in pixels (undefined for keypoints)
  rle?: BackendUncompressedRLE; // kept so we can re-render mask color
}

interface InferenceRun {
  id: string;
  aoiLayerId: string;
  aoiBbox: [number, number, number, number];
  endpoint: EndpointKey;
  modelLabel: string;
  className: string;
  classStyle: ClassStyle;
  textPrompt?: string;
  timestamp: number;
  detectionCount: number;
  maskCount: number;
  visible: boolean;
  layers: Map<string, RunOverlay>;
}

const inferenceRuns = new Map<string, InferenceRun>();
const runListeners = new Set<() => void>();
function notifyRunChange() { runListeners.forEach((fn) => fn()); }

// Global confidence floor — overlays with confidence < threshold are hidden.
// Overlays without a confidence (e.g. some keypoints) are always shown.
let confidenceThreshold = 0;
function getConfidenceThreshold() { return confidenceThreshold; }
function setConfidenceThreshold(value: number) {
  const clamped = Math.max(0, Math.min(1, value));
  if (clamped === confidenceThreshold) return;
  confidenceThreshold = clamped;
  inferenceRuns.forEach((run) => applyRunVisibility(run));
  notifyRunChange();
}

// Global minimum mask pixel area — masks below this are hidden.
let areaMinPx = 0;
function getAreaMin() { return areaMinPx; }
function setAreaMin(value: number) {
  const clamped = Math.max(0, value);
  if (clamped === areaMinPx) return;
  areaMinPx = clamped;
  inferenceRuns.forEach((run) => applyRunVisibility(run));
  notifyRunChange();
}

// Global color rendering mode — switches between schema class color and a
// red→green confidence gradient. Affects existing overlays via re-render.
let colorMode: ColorMode = 'class';
function getColorMode() { return colorMode; }
function setColorMode(mode: ColorMode) {
  if (colorMode === mode) return;
  colorMode = mode;
  inferenceRuns.forEach((run) => {
    run.layers.forEach((overlay) => applyOverlayColor(run, overlay));
  });
  notifyRunChange();
}

function confidenceColor(c: number): string {
  // 0 → red, 0.5 → yellow, 1 → green. Returned as hex so it round-trips
  // through parseColor() when rendering masks to a canvas.
  const hue = Math.max(0, Math.min(1, c)) * 120;
  return hslToHex(hue, 0.75, 0.5);
}

function hslToHex(h: number, s: number, l: number): string {
  // h in [0, 360], s and l in [0, 1]
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0, g1 = 0, b1 = 0;
  if (hp < 1)      { r1 = c; g1 = x; b1 = 0; }
  else if (hp < 2) { r1 = x; g1 = c; b1 = 0; }
  else if (hp < 3) { r1 = 0; g1 = c; b1 = x; }
  else if (hp < 4) { r1 = 0; g1 = x; b1 = c; }
  else if (hp < 5) { r1 = x; g1 = 0; b1 = c; }
  else             { r1 = c; g1 = 0; b1 = x; }
  const m = l - c / 2;
  const to255 = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to255(r1)}${to255(g1)}${to255(b1)}`;
}

function applyOverlayColor(run: InferenceRun, overlay: RunOverlay) {
  const useConfidence = colorMode === 'confidence' && typeof overlay.confidence === 'number';
  if (overlay.type === 'keypoint') {
    const color = useConfidence ? confidenceColor(overlay.confidence!) : run.classStyle.fillColor;
    const stroke = useConfidence ? confidenceColor(overlay.confidence!) : run.classStyle.strokeColor;
    (overlay.layer as LType.CircleMarker).setStyle({ color: stroke, fillColor: color });
  } else if (overlay.type === 'mask' && overlay.rle) {
    const color = useConfidence ? confidenceColor(overlay.confidence!) : run.classStyle.fillColor;
    const dataUrl = renderMaskToDataUrl(overlay.rle, color, run.classStyle.fillOpacity);
    if (dataUrl) (overlay.layer as LType.ImageOverlay).setUrl(dataUrl);
  }
}

function overlayPassesFilters(run: InferenceRun, overlay: RunOverlay): boolean {
  if (!run.visible) return false;
  if (typeof overlay.confidence === 'number' && overlay.confidence < confidenceThreshold) return false;
  if (typeof overlay.areaPx === 'number' && overlay.areaPx < areaMinPx) return false;
  return true;
}

function countMaskPixels(rle: BackendUncompressedRLE): number {
  let count = 0;
  let value = 0;
  for (const len of rle.counts) {
    if (value === 1) count += len;
    value = 1 - value;
  }
  return count;
}

function applyRunVisibility(run: InferenceRun) {
  const map = getMapManager().getMap();
  if (!map) return;
  run.layers.forEach((overlay) => {
    const shouldShow = overlayPassesFilters(run, overlay);
    if (shouldShow && !map.hasLayer(overlay.layer)) map.addLayer(overlay.layer);
    else if (!shouldShow && map.hasLayer(overlay.layer)) map.removeLayer(overlay.layer);
  });
}

function useInferenceRuns(): InferenceRun[] {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    runListeners.add(fn);
    return () => { runListeners.delete(fn); };
  }, []);
  return Array.from(inferenceRuns.values());
}

function findOverlay(runId: string, localId: string): RunOverlay | null {
  return inferenceRuns.get(runId)?.layers.get(localId) ?? null;
}

function detachRunLayers(run: InferenceRun) {
  const map = getMapManager().getMap();
  if (!map) return;
  run.layers.forEach(({ layer }) => {
    if (map.hasLayer(layer)) map.removeLayer(layer);
  });
}

function removeRun(runId: string) {
  const run = inferenceRuns.get(runId);
  if (!run) return;
  detachRunLayers(run);
  inferenceRuns.delete(runId);
  notifyRunChange();
}

function setRunVisible(runId: string, visible: boolean) {
  const run = inferenceRuns.get(runId);
  if (!run || run.visible === visible) return;
  run.visible = visible;
  applyRunVisibility(run);
  notifyRunChange();
}

function clearAllRuns() {
  inferenceRuns.forEach((run) => detachRunLayers(run));
  inferenceRuns.clear();
  notifyRunChange();
}

function clearRunsForAoi(aoiLayerId: string) {
  Array.from(inferenceRuns.values()).forEach((run) => {
    if (run.aoiLayerId !== aoiLayerId) return;
    detachRunLayers(run);
    inferenceRuns.delete(run.id);
  });
  notifyRunChange();
}

interface AoiTestInferencePanelProps {
  aoiLayerId: string;
  aoiBbox: [number, number, number, number] | undefined; // [W, S, E, N]
}

export function AoiTestInferencePanel({ aoiLayerId, aoiBbox }: AoiTestInferencePanelProps) {
  const [open, setOpen] = useState(false);

  // ── AOI child layers — each is a dataset/item clipped to AOI with bands
  // already chosen via the left-panel band context menu. ───────────────────
  const layers = useMapLayersStore((s) => s.layers);
  const childLayers = useMemo(
    () =>
      Object.values(layers).filter((l) => l.parentAoiId === aoiLayerId && l.tileUrl),
    [layers, aoiLayerId],
  );

  const [sourceLayerId, setSourceLayerId] = useState<string>('');
  useEffect(() => {
    if (sourceLayerId && childLayers.some((l) => l.id === sourceLayerId)) return;
    setSourceLayerId(childLayers[0]?.id ?? '');
  }, [childLayers, sourceLayerId]);
  const sourceLayer = childLayers.find((l) => l.id === sourceLayerId);
  const sourceDatasetId = sourceLayer?.sourceDatasetId ?? '';

  // ── Items within the chosen AOI source layer that intersect the AOI ──────
  const aoiBboxParam = aoiBbox ? `${aoiBbox[0]},${aoiBbox[1]},${aoiBbox[2]},${aoiBbox[3]}` : undefined;
  const { data: itemsResp, isLoading: loadingItems } = useQuery({
    queryKey: ['aoi-test', 'items', sourceDatasetId, aoiBboxParam],
    queryFn: () => datasetsApi.listItems(sourceDatasetId, { bbox: aoiBboxParam, page_size: 50 }),
    enabled: open && !!sourceDatasetId && !!aoiBboxParam,
  });
  const items = itemsResp?.items ?? [];

  // Stored as STAC item ID (not dataset-item UUID) so it stays in sync with
  // AOI child layers, which track active source via layer.stacItemId.
  const [sourceItemId, setSourceItemId] = useState<string>('');
  useEffect(() => {
    const activeLayerItem = sourceLayer?.stacItemId;
    if (activeLayerItem && items.some((it) => it.stac_item_id === activeLayerItem)) {
      setSourceItemId(activeLayerItem);
      return;
    }
    if (sourceItemId && items.some((it) => it.stac_item_id === sourceItemId)) return;
    setSourceItemId(items[0]?.stac_item_id ?? '');
  }, [items, sourceItemId, sourceLayer?.stacItemId]);

  // ── Schema & class (drives the overlay color) ─────────────────────────────
  const [schemaId, setSchemaId] = useState('');
  const [classId, setClassId] = useState('');

  const { data: schemasResp } = useQuery({
    queryKey: ['aoi-test', 'schemas'],
    queryFn: () => annotationSchemasApi.list(50, 0),
    enabled: open,
  });
  const schemas = schemasResp?.items ?? [];

  const { data: classesResp } = useQuery({
    queryKey: ['aoi-test', 'classes', schemaId],
    queryFn: () => annotationSchemasApi.getClasses(schemaId),
    enabled: open && !!schemaId,
  });
  const classes = classesResp?.items ?? [];

  useEffect(() => { if (!schemaId && schemas.length > 0) setSchemaId(schemas[0].id); }, [schemas, schemaId]);
  useEffect(() => { setClassId(''); }, [schemaId]);
  useEffect(() => { if (!classId && classes.length > 0) setClassId(classes[0].id); }, [classes, classId]);

  const selectedClass = classes.find((c) => c.id === classId);
  const classStyle = normalizeClassStyleDefinition(
    (selectedClass?.style?.definition ?? null) as Record<string, unknown> | null,
  );

  // ── Endpoint + prompts ────────────────────────────────────────────────────
  const [endpoint, setEndpoint] = useState<EndpointKey>('sam3_text');
  const ep = ENDPOINTS[endpoint];

  const [textPrompt, setTextPrompt] = useState('palm tree');
  const [bboxPrompt, setBboxPrompt] = useState('[[0, 0, 200, 200]]');
  const [confThreshold, setConfThreshold] = useState(0.25);

  // ── Run registry subscription ─────────────────────────────────────────────
  const runs = useInferenceRuns();
  const currentAoiRuns = useMemo(
    () => runs.filter((r) => r.aoiLayerId === aoiLayerId),
    [runs, aoiLayerId],
  );
  const otherAoiRuns = useMemo(
    () => runs.filter((r) => r.aoiLayerId !== aoiLayerId),
    [runs, aoiLayerId],
  );

  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [selectedCompositeId, setSelectedCompositeId] = useState<string | null>(null);
  const [annotationOpacity, setAnnotationOpacity] = useState(1);

  const updateAnnotationOpacity = useCallback((compositeId: string, opacity: number) => {
    const sep = compositeId.indexOf('::');
    if (sep < 0) return;
    const runId = compositeId.slice(0, sep);
    const localId = compositeId.slice(sep + 2);
    const entry = findOverlay(runId, localId);
    if (!entry) return;
    const { layer, type } = entry;
    if (type === 'keypoint' && 'setStyle' in layer) {
      (layer as LType.CircleMarker).setStyle({ fillOpacity: opacity });
    } else if (type === 'mask' && 'setOpacity' in layer) {
      (layer as LType.ImageOverlay).setOpacity(opacity);
    }
  }, []);

  // ── Run inference — stacks a new run, never clears prior overlays ─────────
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    if (!aoiBbox) { toast.error('AOI bbox missing'); return; }
    if (!sourceLayer) { toast.error('No AOI source layer'); return; }
    if (!sourceDatasetId) { toast.error('Source layer has no dataset id'); return; }
    if (!sourceItemId) { toast.error('Pick a dataset item'); return; }
    if (!selectedClass) { toast.error('Select a schema and class'); return; }

    if (ep.needsText !== 'none' && !textPrompt.trim()) {
      toast.error('Text prompt required'); return;
    }
    if (ep.needsBboxPrompt) {
      try {
        const parsed = JSON.parse(bboxPrompt);
        if (!Array.isArray(parsed) || parsed.length === 0) throw new Error();
      } catch { toast.error('Invalid bbox JSON'); return; }
    }

    setRunning(true);
    const tid = toast.loading('Rendering AOI patch…');

    const runId = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const newRun: InferenceRun = {
      id: runId,
      aoiLayerId,
      aoiBbox,
      endpoint,
      modelLabel: ep.label,
      className: selectedClass.name,
      classStyle,
      textPrompt: ep.needsText !== 'none' ? textPrompt.trim() : undefined,
      timestamp: Date.now(),
      detectionCount: 0,
      maskCount: 0,
      visible: true,
      layers: new Map(),
    };

    try {
      // ── 1. Build a per-item tile URL using the AOI child layer's bands ───
      const tileUrl = await buildItemAoiTileUrl(
        sourceDatasetId,
        sourceItemId,
        sourceLayer,
      );

      // ── 2. Render AOI region from those tiles ────────────────────────────
      const map = getMapManager().getMap();
      if (!map) throw new Error('Map not initialized');
      const baseZoom = clampZoomForTileBudget(aoiBbox, Math.round(map.getZoom?.() ?? 18));
      const { blob, width: imgW, height: imgH } =
        await renderAoiFromTiles(tileUrl, aoiBbox, baseZoom);

      // ── 3. Build inference request URL ───────────────────────────────────
      toast.loading(`Running ${ep.label}…`, { id: tid });
      const url = new URL(PALM_API_BASE + ep.path);
      if (endpoint === 'predict_upload' || endpoint === 'segment_upload' || endpoint === 'predict_crown') {
        url.searchParams.set('conf_threshold', String(confThreshold));
        url.searchParams.set('iou_threshold', '0.7');
      }
      if (ep.needsText === 'csv') {
        textPrompt.split(',').map((s) => s.trim()).filter(Boolean)
          .forEach((p) => url.searchParams.append('text_prompts', p));
      }
      if (ep.needsText === 'single') {
        url.searchParams.set('text_prompt', textPrompt.trim());
      }
      if (ep.needsBboxPrompt) {
        url.searchParams.set('bboxes', bboxPrompt);
      }

      const form = new FormData();
      form.append('file', new File([blob], 'aoi-patch.png', { type: 'image/png' }));

      let res: Response;
      try {
        res = await fetch(url.toString(), { method: 'POST', body: form });
      } catch (netErr) {
        const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
        const hint = isHttps
          ? ' (page is HTTPS but PalmAPI is HTTP — browser blocks mixed content; serve PalmAPI over HTTPS or run the UI on HTTP)'
          : ' (server unreachable on localhost:8012; is uvicorn running?)';
        throw new Error(
          `Network error: ${netErr instanceof Error ? netErr.message : String(netErr)}${hint}`,
        );
      }
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
      }
      const json = await res.json();

      const detections: BackendDetection[] = Array.isArray(json) ? json : (json.detections ?? []);
      const masks: BackendMask[] = Array.isArray(json) ? [] : (json.masks ?? []);

      // ── 4. Render overlays on map (added to newRun, NOT cleared) ─────────
      const L: typeof LType = (await import('leaflet')).default;
      const [W, S, E, N] = aoiBbox;

      const pxToLatLng = (px: number, py: number): [number, number] => {
        const lng = W + (px / imgW) * (E - W);
        const lat = N - (py / imgH) * (N - S); // image y=0 at top → north
        return [lat, lng];
      };

      // Per-detection: keypoints only (bounding boxes intentionally omitted —
      // segmentation runs render masks; pose runs render keypoints).
      for (let idx = 0; idx < detections.length; idx++) {
        const d = detections[idx];

        if (d.keypoints?.length) {
          for (let kpIdx = 0; kpIdx < d.keypoints.length; kpIdx++) {
            const kp = d.keypoints[kpIdx];
            if (kp.confidence < 0.2) continue;
            const [lat, lng] = pxToLatLng(kp.x, kp.y);
            const kpLocalId = `keypoint-${idx}-${kpIdx}`;
            const kpCompositeId = `${runId}::${kpLocalId}`;
            const c = L.circleMarker([lat, lng], {
              radius: 3,
              color: classStyle.strokeColor,
              fillColor: classStyle.fillColor,
              fillOpacity: 1,
              weight: 1,
            });
            if (kp.name) c.bindTooltip(kp.name, { direction: 'top' });
            c.on('click', () => {
              setSelectedCompositeId(kpCompositeId);
              setExpandedRunId(runId);
            });
            c.addTo(map);
            // Use the per-keypoint confidence so the visualization slider can
            // cull low-confidence joints individually. Fall back to the parent
            // detection's confidence when the keypoint omits it.
            const kpConf = typeof kp.confidence === 'number'
              ? kp.confidence
              : (typeof d.confidence === 'number' ? d.confidence : undefined);
            newRun.layers.set(kpLocalId, {
              layer: c,
              type: 'keypoint',
              confidence: kpConf,
              className: d.class_name ?? newRun.className,
            });
          }
        }
      }

      // Masks → image overlays (one per mask, all over AOI extent)
      for (let maskIdx = 0; maskIdx < masks.length; maskIdx++) {
        const m = masks[maskIdx];
        const dataUrl = renderMaskToDataUrl(m.rle, classStyle.fillColor, classStyle.fillOpacity);
        if (!dataUrl) continue;
        const localId = `mask-${maskIdx}`;
        const compositeId = `${runId}::${localId}`;
        const overlay = L.imageOverlay(dataUrl, [[S, W], [N, E]], {
          opacity: 1,
          interactive: true,
        });
        overlay.on('click', () => {
          setSelectedCompositeId(compositeId);
          setExpandedRunId(runId);
        });
        overlay.addTo(map);
        newRun.layers.set(localId, {
          layer: overlay,
          type: 'mask',
          confidence: typeof m.confidence === 'number' ? m.confidence : undefined,
          className: m.class_name ?? newRun.className,
          areaPx: countMaskPixels(m.rle),
          rle: m.rle,
        });
      }

      newRun.detectionCount = detections.length;
      newRun.maskCount = masks.length;

      if (newRun.layers.size === 0) {
        toast.success(`${ep.label} done — no detections`, { id: tid });
      } else {
        inferenceRuns.set(runId, newRun);
        if (colorMode === 'confidence') {
          newRun.layers.forEach((o) => applyOverlayColor(newRun, o));
        }
        applyRunVisibility(newRun); // respect the current Visualization threshold
        notifyRunChange();
        setExpandedRunId(runId);

        const summary = [
          detections.length ? `${detections.length} detections` : null,
          masks.length ? `${masks.length} masks` : null,
        ].filter(Boolean).join(' · ');
        toast.success(`${ep.label} done${summary ? ` — ${summary}` : ''}`, { id: tid });
      }
    } catch (err) {
      // Detach any partial layers we may have added before the error.
      detachRunLayers(newRun);
      const msg = err instanceof Error ? err.message : 'Inference failed';
      toast.error(msg, { id: tid });
    } finally {
      setRunning(false);
    }
  }, [
    aoiBbox, aoiLayerId, sourceLayer, sourceDatasetId, sourceItemId,
    selectedClass, classStyle, endpoint, ep,
    textPrompt, bboxPrompt, confThreshold,
  ]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <section style={{ borderTop: `1px dashed ${MC.border}`, paddingTop: 8 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, width: '100%',
          background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 0',
        }}
      >
        {open ? <ChevronDown size={11} color={MC.textMuted} /> : <ChevronRight size={11} color={MC.textMuted} />}
        <Beaker size={11} color={MC.accent} />
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: MC.sectionLabel }}>
          Model Assisted Inference
        </span>
        {runs.length > 0 && (
          <span style={{
            marginLeft: 'auto', fontSize: 9, fontWeight: 600,
            color: MC.textSecondary, background: MC.inputBg ?? '#1e2518',
            border: `1px solid ${MC.border}`, padding: '1px 6px', borderRadius: 8,
          }}>
            {runs.length} run{runs.length === 1 ? '' : 's'}
          </span>
        )}
      </button>

      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0' }}>
          {/* Endpoint */}
          <Field label="Select Model">
            <select
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value as EndpointKey)}
              style={selectStyle}
            >
              {(Object.keys(ENDPOINTS) as EndpointKey[]).map((k) => (
                <option key={k} value={k}>{ENDPOINTS[k].label}</option>
              ))}
            </select>
          </Field>

          {/* Schema */}
          <Field label="Schema">
            <select value={schemaId} onChange={(e) => setSchemaId(e.target.value)} style={selectStyle}>
              <option value="">— select —</option>
              {schemas.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
            </select>
          </Field>

          {/* Class */}
          <Field label="Class">
            <select
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              disabled={!schemaId}
              style={{ ...selectStyle, opacity: schemaId ? 1 : 0.5 }}
            >
              <option value="">— select —</option>
              {classes.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </select>
            {selectedClass && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <span style={{
                  width: 12, height: 12, borderRadius: 3,
                  background: classStyle.fillColor,
                  border: `1.5px solid ${classStyle.strokeColor}`,
                }} />
                <span style={{ fontSize: 9, color: MC.textMuted }}>
                  {classStyle.fillColor} · stroke {classStyle.strokeColor}
                </span>
              </div>
            )}
          </Field>

          {/* Source AOI layer */}
          <Field label="Source layer">
            {childLayers.length === 0 ? (
              <p style={{ fontSize: 10, color: MC.textMuted, fontStyle: 'italic', margin: 0 }}>
                Select a dataset under this AOI first; pick bands from its layer entry in the
                left panel (right-click an item → Band selection).
              </p>
            ) : (
              <select
                value={sourceLayerId}
                onChange={(e) => setSourceLayerId(e.target.value)}
                style={selectStyle}
              >
                {childLayers.map((l) => (
                  <option key={l.id} value={l.id}>{l.name ?? l.id}</option>
                ))}
              </select>
            )}
          </Field>

          {/* Item picker — within the chosen source dataset, AOI-clipped */}
          {sourceDatasetId && (
            <Field label="Item">
              {loadingItems ? (
                <p style={{ fontSize: 10, color: MC.textMuted, margin: 0 }}>Loading items…</p>
              ) : items.length === 0 ? (
                <p style={{ fontSize: 10, color: MC.textMuted, fontStyle: 'italic', margin: 0 }}>
                  No items intersect the AOI.
                </p>
              ) : (
                  <select
                    value={sourceItemId}
                    onChange={(e) => setSourceItemId(e.target.value)}
                    style={selectStyle}
                  >
                    {items.map((it) => (
                      <option key={it.id} value={it.stac_item_id}>
                        {it.filename || it.stac_item_id}
                      </option>
                    ))}
                  </select>
              )}
            </Field>
          )}

          {/* Text prompt */}
          {ep.needsText !== 'none' && (
            <Field label={ep.needsText === 'csv' ? 'Text prompts (comma-separated)' : 'Text prompt'}>
              <input
                value={textPrompt}
                onChange={(e) => setTextPrompt(e.target.value)}
                placeholder={ep.needsText === 'csv' ? 'palm tree, building' : 'palm tree'}
                style={inputStyle}
              />
            </Field>
          )}

          {/* Bbox prompt */}
          {ep.needsBboxPrompt && (
            <Field label="Bbox prompts (JSON, image-pixel space)">
              <textarea
                value={bboxPrompt}
                onChange={(e) => setBboxPrompt(e.target.value)}
                rows={2}
                style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 10, resize: 'vertical' }}
              />
            </Field>
          )}

          {/* Confidence */}
          {(endpoint === 'predict_upload' || endpoint === 'segment_upload' || endpoint === 'predict_crown') && (
            <Field label={`Confidence (${confThreshold.toFixed(2)})`}>
              <input
                type="range" min={0.05} max={0.95} step={0.05}
                value={confThreshold}
                onChange={(e) => setConfThreshold(Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </Field>
          )}

          {!aoiBbox && (
            <p style={{ fontSize: 9, color: MC.textMuted, fontStyle: 'italic', margin: 0 }}>
              Draw an AOI before running inference.
            </p>
          )}

          {/* Run / Clear-this-AOI */}
          {(() => {
            const disabled =
              running || !aoiBbox || !classId || !sourceDatasetId || !sourceItemId;
            return (
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={run}
                  disabled={disabled}
                  style={{
                    flex: 1,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    padding: '8px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600,
                    border: `1px solid ${disabled ? MC.border : MC.accent}`,
                    background: disabled ? 'transparent' : MC.accent,
                    color: disabled ? MC.textMuted : '#fff',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    transition: 'all 0.12s',
                  }}
                >
                  {running
                    ? <><Loader2 size={11} className="animate-spin" /> Running…</>
                    : <><Play size={11} /> Run on AOI</>}
                </button>
                <button
                  onClick={() => clearRunsForAoi(aoiLayerId)}
                  disabled={running || currentAoiRuns.length === 0}
                  title="Clear all runs on this AOI"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: '8px 10px', borderRadius: 5,
                    background: 'transparent', border: `1px solid ${MC.border}`,
                    color: MC.textSecondary,
                    cursor: (running || currentAoiRuns.length === 0) ? 'not-allowed' : 'pointer',
                    opacity: (running || currentAoiRuns.length === 0) ? 0.5 : 1,
                  }}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            );
          })()}

          <p style={{ fontSize: 8, color: MC.textMuted, margin: 0, lineHeight: 1.4 }}>
            ⚠ Test only. Each run stays on the map until you remove it. You can stack
            multiple models on this AOI, switch to another AOI and run more — overlays
            from previous AOIs remain visible.
          </p>
        </div>
      )}

      {runs.length > 0 && (
        <section style={{ borderTop: `1px dashed ${MC.border}`, paddingTop: 8, marginTop: 8 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between',
            paddingBottom: 8,
          }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: MC.sectionLabel }}>
              Inference Runs ({runs.length})
            </span>
            <button
              onClick={clearAllRuns}
              title="Remove all inference runs across all AOIs"
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '3px 8px', borderRadius: 4, fontSize: 9, fontWeight: 600,
                background: 'transparent', border: `1px solid ${MC.border}`,
                color: MC.textSecondary, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.05em',
              }}
            >
              <Trash2 size={9} /> Clear all
            </button>
          </div>

          <InferenceVisualization runs={runs} currentAoiRuns={currentAoiRuns} />

          {currentAoiRuns.length > 0 && (
            <RunGroup
              title="This AOI"
              runs={currentAoiRuns}
              layers={layers}
              expandedRunId={expandedRunId}
              setExpandedRunId={setExpandedRunId}
              selectedCompositeId={selectedCompositeId}
              setSelectedCompositeId={setSelectedCompositeId}
              annotationOpacity={annotationOpacity}
              setAnnotationOpacity={setAnnotationOpacity}
              updateAnnotationOpacity={updateAnnotationOpacity}
            />
          )}

          {otherAoiRuns.length > 0 && (
            <RunGroup
              title="Other AOIs"
              runs={otherAoiRuns}
              layers={layers}
              expandedRunId={expandedRunId}
              setExpandedRunId={setExpandedRunId}
              selectedCompositeId={selectedCompositeId}
              setSelectedCompositeId={setSelectedCompositeId}
              annotationOpacity={annotationOpacity}
              setAnnotationOpacity={setAnnotationOpacity}
              updateAnnotationOpacity={updateAnnotationOpacity}
              dimmed
            />
          )}
        </section>
      )}
    </section>
  );
}

// ── Visualization (confidence threshold + run stats) ─────────────────────────
// Temporary view-layer controls that mutate which overlays are on the map but
// never destroy a run. Resetting threshold to 0 restores everything.

interface InferenceVisualizationProps {
  runs: InferenceRun[];
  currentAoiRuns: InferenceRun[];
}

// Slider domain → area (quadratic curve for fine control at the low end where
// noise-filtering happens). Slider sweeps 0..1000.
const AREA_SLIDER_MAX = 1000;
function sliderToArea(s: number, maxArea: number): number {
  if (maxArea <= 0 || s <= 0) return 0;
  const t = Math.min(1, s / AREA_SLIDER_MAX);
  return Math.round(t * t * maxArea);
}
function areaToSlider(a: number, maxArea: number): number {
  if (maxArea <= 0 || a <= 0) return 0;
  return Math.round(Math.sqrt(a / maxArea) * AREA_SLIDER_MAX);
}

function InferenceVisualization({ runs, currentAoiRuns }: InferenceVisualizationProps) {
  const [open, setOpen] = useState(false);
  const [threshold, setThresholdLocal] = useState<number>(getConfidenceThreshold());
  const [mode, setModeLocal] = useState<ColorMode>(getColorMode());
  const [areaMin, setAreaMinLocal] = useState<number>(getAreaMin());

  // Keep local state in sync if another panel changes the module-level value.
  useEffect(() => {
    setThresholdLocal(getConfidenceThreshold());
    setModeLocal(getColorMode());
    setAreaMinLocal(getAreaMin());
  }, [runs]);

  const stats = useMemo(() => {
    let total = 0;
    let visible = 0;
    let withConf = 0;
    let minConf = 1;
    let maxConf = 0;
    let withArea = 0;
    let maxArea = 0;
    runs.forEach((run) => {
      run.layers.forEach((overlay) => {
        total++;
        if (typeof overlay.confidence === 'number') {
          withConf++;
          if (overlay.confidence < minConf) minConf = overlay.confidence;
          if (overlay.confidence > maxConf) maxConf = overlay.confidence;
        }
        if (typeof overlay.areaPx === 'number') {
          withArea++;
          if (overlay.areaPx > maxArea) maxArea = overlay.areaPx;
        }
        if (overlayPassesFilters(run, overlay)) visible++;
      });
    });
    return {
      total, visible, withConf, withArea, maxArea,
      minConf: withConf ? minConf : 0, maxConf,
    };
  }, [runs, threshold, areaMin, mode]);

  // Small bucketed histogram (10 bins, 0.1 wide) for confidence distribution.
  const histogram = useMemo(() => {
    const bins = new Array(10).fill(0) as number[];
    runs.forEach((run) => {
      run.layers.forEach((o) => {
        if (typeof o.confidence !== 'number') return;
        const i = Math.min(9, Math.max(0, Math.floor(o.confidence * 10)));
        bins[i]++;
      });
    });
    const peak = Math.max(1, ...bins);
    return { bins, peak };
  }, [runs]);

  // Class distribution — counts per class name within the CURRENT AOI's runs.
  // Color/stroke come from the first run that contributed to that class so the
  // chart legend matches the on-map overlays.
  const classDist = useMemo(() => {
    const byClass = new Map<string, { count: number; color: string; stroke: string }>();
    currentAoiRuns.forEach((run) => {
      run.layers.forEach((o) => {
        const name = o.className ?? run.className;
        const entry = byClass.get(name);
        if (entry) {
          entry.count++;
        } else {
          byClass.set(name, {
            count: 1,
            color: run.classStyle.fillColor,
            stroke: run.classStyle.strokeColor,
          });
        }
      });
    });
    return Array.from(byClass.entries())
      .map(([name, info]) => ({ name, ...info }))
      .sort((a, b) => b.count - a.count);
  }, [currentAoiRuns]);
  const classDistTotal = classDist.reduce((s, c) => s + c.count, 0);

  const handleThresholdChange = (v: number) => {
    setThresholdLocal(v);
    setConfidenceThreshold(v);
  };
  const handleModeChange = (next: ColorMode) => {
    setModeLocal(next);
    setColorMode(next);
  };
  const handleAreaSliderChange = (sliderVal: number) => {
    const px = sliderToArea(sliderVal, stats.maxArea);
    setAreaMinLocal(px);
    setAreaMin(px);
  };

  return (
    <section style={{ borderTop: `1px dashed ${MC.border}`, paddingTop: 8, marginBottom: 8 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, width: '100%',
          background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 0',
        }}
      >
        {open ? <ChevronDown size={11} color={MC.textMuted} /> : <ChevronRight size={11} color={MC.textMuted} />}
        <SlidersHorizontal size={11} color={MC.accent} />
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
          textTransform: 'uppercase', color: MC.sectionLabel,
        }}>
          Visualization
        </span>
        <span style={{
          marginLeft: 'auto', fontSize: 9, fontWeight: 600,
          color: MC.textSecondary, background: MC.inputBg ?? '#1e2518',
          border: `1px solid ${MC.border}`, padding: '1px 6px', borderRadius: 8,
        }}>
          {stats.visible}/{stats.total}
        </span>
      </button>

      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '8px 0' }}>
          {/* Color mode toggle */}
          <Field label="Color mode">
            <div style={{ display: 'flex', gap: 4 }}>
              {(['class', 'confidence'] as ColorMode[]).map((m) => {
                const active = mode === m;
                return (
                  <button
                    key={m}
                    onClick={() => handleModeChange(m)}
                    style={{
                      flex: 1, padding: '5px 8px', borderRadius: 4,
                      fontSize: 10, fontWeight: 600,
                      background: active ? MC.accent : 'transparent',
                      border: `1px solid ${active ? MC.accent : MC.border}`,
                      color: active ? '#fff' : MC.textSecondary,
                      cursor: 'pointer', textTransform: 'capitalize',
                      transition: 'all 0.12s',
                    }}
                  >
                    By {m}
                  </button>
                );
              })}
            </div>
            {mode === 'confidence' && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6, marginTop: 6,
              }}>
                <div style={{
                  flex: 1, height: 6, borderRadius: 3,
                  background: 'linear-gradient(to right, hsl(0,75%,50%), hsl(60,75%,50%), hsl(120,75%,50%))',
                }} />
                <span style={{ fontSize: 8, color: MC.textMuted, whiteSpace: 'nowrap' }}>
                  low → high
                </span>
              </div>
            )}
          </Field>

          <Field label={`Confidence ≥ ${threshold.toFixed(2)}`}>
            <input
              type="range" min={0} max={1} step={0.01}
              value={threshold}
              onChange={(e) => handleThresholdChange(Number(e.target.value))}
              style={{ width: '100%' }}
            />
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              fontSize: 8, color: MC.textMuted, marginTop: 2,
            }}>
              <span>0.00</span>
              <span>0.50</span>
              <span>1.00</span>
            </div>
          </Field>

          {/* Confidence histogram (only meaningful if any overlay has confidence) */}
          {stats.withConf > 0 && (
            <Field label="Distribution">
              <div style={{
                display: 'flex', alignItems: 'flex-end', gap: 1, height: 32,
                padding: 2, border: `1px solid ${MC.border}`,
                background: MC.inputBg ?? '#1e2518', borderRadius: 4,
              }}>
                {histogram.bins.map((count, i) => {
                  const binStart = i / 10;
                  const above = binStart + 0.0999 >= threshold; // bin contributes to visible
                  const h = (count / histogram.peak) * 100;
                  return (
                    <div
                      key={i}
                      title={`[${binStart.toFixed(1)}, ${(binStart + 0.1).toFixed(1)}): ${count}`}
                      style={{
                        flex: 1, height: `${h}%`, minHeight: count > 0 ? 1 : 0,
                        background: above ? MC.accent : MC.border,
                        borderRadius: 1, transition: 'background 0.15s',
                      }}
                    />
                  );
                })}
              </div>
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                fontSize: 8, color: MC.textMuted, marginTop: 2,
              }}>
                <span>min {stats.minConf.toFixed(2)}</span>
                <span>max {stats.maxConf.toFixed(2)}</span>
              </div>
            </Field>
          )}

          {/* Min mask area filter — masks below this many pixels are hidden */}
          {stats.withArea > 0 && (
            <Field label={`Min mask area ≥ ${areaMin.toLocaleString()} px`}>
              <input
                type="range"
                min={0}
                max={AREA_SLIDER_MAX}
                step={1}
                value={areaToSlider(areaMin, stats.maxArea)}
                onChange={(e) => handleAreaSliderChange(Number(e.target.value))}
                style={{ width: '100%' }}
              />
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                fontSize: 8, color: MC.textMuted, marginTop: 2,
              }}>
                <span>0</span>
                <span>{Math.round(stats.maxArea / 4).toLocaleString()}</span>
                <span>{stats.maxArea.toLocaleString()}</span>
              </div>
            </Field>
          )}

          {/* Class distribution within the current AOI */}
          {classDist.length > 0 && (
            <Field label={`Class distribution (this AOI · ${classDistTotal})`}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {classDist.map(({ name, count, color, stroke }) => {
                  const pct = classDist[0].count > 0 ? (count / classDist[0].count) * 100 : 0;
                  const sharePct = classDistTotal > 0
                    ? ((count / classDistTotal) * 100).toFixed(0)
                    : '0';
                  return (
                    <div key={name} style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                      <span style={{
                        width: 10, height: 10, borderRadius: 2,
                        background: color, border: `1.5px solid ${stroke}`,
                        flexShrink: 0,
                      }} />
                      <span style={{
                        fontSize: 10, color: MC.text, minWidth: 70, flexShrink: 0,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }} title={name}>
                        {name}
                      </span>
                      <div style={{
                        flex: 1, height: 6, borderRadius: 3,
                        background: MC.inputBg ?? '#1e2518', overflow: 'hidden',
                      }}>
                        <div style={{
                          width: `${pct}%`, height: '100%',
                          background: color, transition: 'width 0.2s',
                        }} />
                      </div>
                      <span style={{
                        fontSize: 10, fontWeight: 600, color: MC.text,
                        minWidth: 28, textAlign: 'right', flexShrink: 0,
                      }}>
                        {count}
                      </span>
                      <span style={{
                        fontSize: 8, color: MC.textMuted,
                        minWidth: 26, textAlign: 'right', flexShrink: 0,
                      }}>
                        {sharePct}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </Field>
          )}

          <div style={{
            display: 'flex', justifyContent: 'space-between',
            fontSize: 9, color: MC.textMuted,
          }}>
            <span>{stats.visible} of {stats.total} overlays shown</span>
            <button
              onClick={() => {
                handleThresholdChange(0);
                handleAreaSliderChange(0);
              }}
              disabled={threshold === 0 && areaMin === 0}
              style={{
                background: 'transparent', border: 'none',
                color: (threshold === 0 && areaMin === 0) ? MC.textMuted : MC.accent,
                fontSize: 9, fontWeight: 600,
                cursor: (threshold === 0 && areaMin === 0) ? 'default' : 'pointer',
                padding: 0, textTransform: 'uppercase', letterSpacing: '0.05em',
              }}
            >
              Reset filters
            </button>
          </div>

          <p style={{ fontSize: 8, color: MC.textMuted, margin: 0, lineHeight: 1.4 }}>
            Hides overlays without removing them. Overlays without a confidence score or
            mask area are always shown (filters skip them).
          </p>
        </div>
      )}
    </section>
  );
}

// ── Inference run group + row ────────────────────────────────────────────────

interface RunGroupProps {
  title: string;
  runs: InferenceRun[];
  layers: Record<string, LayerConfig>;
  expandedRunId: string | null;
  setExpandedRunId: (id: string | null) => void;
  selectedCompositeId: string | null;
  setSelectedCompositeId: (id: string | null) => void;
  annotationOpacity: number;
  setAnnotationOpacity: (v: number) => void;
  updateAnnotationOpacity: (compositeId: string, opacity: number) => void;
  dimmed?: boolean;
}

function RunGroup({
  title, runs, layers,
  expandedRunId, setExpandedRunId,
  selectedCompositeId, setSelectedCompositeId,
  annotationOpacity, setAnnotationOpacity,
  updateAnnotationOpacity,
  dimmed,
}: RunGroupProps) {
  return (
    <div style={{ marginBottom: 6, opacity: dimmed ? 0.85 : 1 }}>
      <div style={{
        fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
        color: MC.textMuted, padding: '4px 0',
      }}>
        {title} ({runs.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {runs.map((run) => (
          <RunRow
            key={run.id}
            run={run}
            aoiName={layers[run.aoiLayerId]?.name ?? run.aoiLayerId.slice(0, 8)}
            expanded={expandedRunId === run.id}
            onToggleExpand={() => setExpandedRunId(expandedRunId === run.id ? null : run.id)}
            selectedCompositeId={selectedCompositeId}
            setSelectedCompositeId={setSelectedCompositeId}
            annotationOpacity={annotationOpacity}
            setAnnotationOpacity={setAnnotationOpacity}
            updateAnnotationOpacity={updateAnnotationOpacity}
          />
        ))}
      </div>
    </div>
  );
}

interface RunRowProps {
  run: InferenceRun;
  aoiName: string;
  expanded: boolean;
  onToggleExpand: () => void;
  selectedCompositeId: string | null;
  setSelectedCompositeId: (id: string | null) => void;
  annotationOpacity: number;
  setAnnotationOpacity: (v: number) => void;
  updateAnnotationOpacity: (compositeId: string, opacity: number) => void;
}

function RunRow({
  run, aoiName, expanded, onToggleExpand,
  selectedCompositeId, setSelectedCompositeId,
  annotationOpacity, setAnnotationOpacity,
  updateAnnotationOpacity,
}: RunRowProps) {
  const counts = [
    run.detectionCount ? `${run.detectionCount} det` : null,
    run.maskCount ? `${run.maskCount} mask` : null,
  ].filter(Boolean).join(' · ');
  const promptHint = run.textPrompt ? ` · "${run.textPrompt}"` : '';

  const localSelectedId = selectedCompositeId?.startsWith(`${run.id}::`)
    ? selectedCompositeId
    : null;

  return (
    <div style={{
      border: `1px solid ${MC.border}`, borderRadius: 5,
      background: 'transparent',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px',
        cursor: 'pointer',
      }}
        onClick={onToggleExpand}
      >
        {expanded
          ? <ChevronDown size={10} color={MC.textMuted} />
          : <ChevronRight size={10} color={MC.textMuted} />}
        <span style={{
          width: 10, height: 10, borderRadius: 2,
          background: run.classStyle.fillColor,
          border: `1.5px solid ${run.classStyle.strokeColor}`,
          flexShrink: 0,
        }} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <span style={{
            fontSize: 10, fontWeight: 600, color: MC.text,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {run.modelLabel}{promptHint}
          </span>
          <span style={{
            fontSize: 8, color: MC.textMuted,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {run.className} · {aoiName}{counts ? ` · ${counts}` : ''}
          </span>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); setRunVisible(run.id, !run.visible); }}
          title={run.visible ? 'Hide overlays' : 'Show overlays'}
          style={iconBtnStyle}
        >
          {run.visible ? <Eye size={10} /> : <EyeOff size={10} />}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (selectedCompositeId?.startsWith(`${run.id}::`)) setSelectedCompositeId(null);
            removeRun(run.id);
          }}
          title="Remove this run"
          style={iconBtnStyle}
        >
          <Trash2 size={10} />
        </button>
      </div>

      {expanded && (
        <div style={{
          padding: '4px 8px 8px 8px',
          borderTop: `1px solid ${MC.border}`,
        }}>
          {localSelectedId && (
            <Field label={`Opacity (${Math.round(annotationOpacity * 100)}%)`}>
              <input
                type="range" min={0} max={1} step={0.05}
                value={annotationOpacity}
                onChange={(e) => {
                  const op = Number(e.target.value);
                  setAnnotationOpacity(op);
                  updateAnnotationOpacity(localSelectedId, op);
                }}
                style={{ width: '100%' }}
              />
            </Field>
          )}
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 3,
            maxHeight: 160, overflowY: 'auto',
          }}>
            {Array.from(run.layers.keys()).map((localId) => {
              const compositeId = `${run.id}::${localId}`;
              const active = selectedCompositeId === compositeId;
              return (
                <button
                  key={compositeId}
                  onClick={() => setSelectedCompositeId(compositeId)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                    padding: '5px 7px', borderRadius: 4, fontSize: 9,
                    background: active ? MC.accent : 'transparent',
                    border: `1px solid ${active ? MC.accent : MC.border}`,
                    color: active ? '#fff' : MC.text,
                    cursor: 'pointer', transition: 'all 0.12s', textAlign: 'left',
                  }}
                >
                  <span style={{ fontSize: 8, color: 'currentColor', opacity: 0.7, fontWeight: 700 }}>
                    {localId.split('-')[0].toUpperCase()}
                  </span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {localId}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── UI helpers ───────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
        color: MC.textMuted, display: 'block', marginBottom: 3,
      }}>{label}</label>
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

const iconBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 4, borderRadius: 3,
  background: 'transparent', border: `1px solid ${MC.border}`,
  color: MC.textSecondary, cursor: 'pointer', flexShrink: 0,
};

// ── Per-item tile URL builder ────────────────────────────────────────────────
// Build a tile URL for a single STAC item that respects the AOI child layer's
// band selection / preset / clip bounds. The user picks bands once on the AOI
// child layer (via Layer Style or item right-click); we reuse those here so
// the inference image matches what's on the map.
async function buildItemAoiTileUrl(
  datasetId: string,
  stacItemId: string,
  parentLayer: LayerConfig,
): Promise<string> {
  const tc = await datasetsApi.getItemTileConfigByStacId(datasetId, stacItemId);
  if (!tc.tile_url_template) throw new Error('Item has no tile URL template');

  const baseUrl = tc.tile_url_template.split('?')[0];
  const params = new URLSearchParams();

  if (parentLayer.bandSelection) {
    const b = parentLayer.bandSelection;
    params.set('asset_bidx', `data|${b.r},${b.g},${b.b}`);
    const rc: RenderingConfig | null | undefined =
      tc.rendering_config ?? parentLayer.renderingConfig;
    const rBand = rc?.bands?.find((x) => x.index === b.r);
    const gBand = rc?.bands?.find((x) => x.index === b.g);
    const bBand = rc?.bands?.find((x) => x.index === b.b);
    if (rBand && gBand && bBand) {
      const p2 = Math.min(rBand.stats.p2, gBand.stats.p2, bBand.stats.p2);
      const p98 = Math.max(rBand.stats.p98, gBand.stats.p98, bBand.stats.p98);
      params.set('rescale', `${Math.round(p2)},${Math.round(p98)}`);
    }
  } else if (
    parentLayer.activePreset &&
    tc.rendering_config?.presets?.[parentLayer.activePreset]
  ) {
    const pp = tc.rendering_config.presets[parentLayer.activePreset].params;
    Object.entries(pp).forEach(([k, v]) => { if (v) params.set(k, String(v)); });
  } else if (
    tc.rendering_config?.default_preset &&
    tc.rendering_config.presets?.[tc.rendering_config.default_preset]
  ) {
    const pp = tc.rendering_config.presets[tc.rendering_config.default_preset].params;
    Object.entries(pp).forEach(([k, v]) => { if (v) params.set(k, String(v)); });
  }

  if (parentLayer.clipBounds) {
    params.set('bbox', parentLayer.clipBounds.join(','));
  }

  return params.toString() ? `${baseUrl}?${params.toString()}` : baseUrl;
}

// ── Tile rendering helpers ───────────────────────────────────────────────────
// Slippy-tile math for Web Mercator. Output tile XY at the given zoom.
function lngToTileX(lng: number, z: number) {
  return Math.floor(((lng + 180) / 360) * Math.pow(2, z));
}
function latToTileY(lat: number, z: number) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z));
}
function lngLatToWorldPx(lng: number, lat: number, z: number) {
  const n = Math.pow(2, z);
  const x = ((lng + 180) / 360) * n * TILE_SIZE;
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * n * TILE_SIZE;
  return { x, y };
}

/** Drop the zoom until the AOI bbox covers <= MAX_TILES tiles. */
function clampZoomForTileBudget(
  bbox: [number, number, number, number],
  startZoom: number,
): number {
  const [W, S, E, N] = bbox;
  for (let z = Math.max(0, Math.min(22, startZoom)); z >= 0; z--) {
    const tx0 = lngToTileX(W, z);
    const tx1 = lngToTileX(E, z);
    const ty0 = latToTileY(N, z);
    const ty1 = latToTileY(S, z);
    const tiles = (Math.abs(tx1 - tx0) + 1) * (Math.abs(ty1 - ty0) + 1);
    if (tiles <= MAX_TILES) return z;
  }
  return 0;
}

/**
 * Render the AOI region from a {z}/{x}/{y} tile URL template.
 * Fetches each tile as a blob, draws into a canvas, then crops to the AOI bbox
 * in world-pixel space and returns the resulting PNG blob + dimensions.
 */
async function renderAoiFromTiles(
  tileUrlTemplate: string,
  aoiBbox: [number, number, number, number],
  zoom: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  const [W, S, E, N] = aoiBbox;
  const tx0 = Math.min(lngToTileX(W, zoom), lngToTileX(E, zoom));
  const tx1 = Math.max(lngToTileX(W, zoom), lngToTileX(E, zoom));
  const ty0 = Math.min(latToTileY(N, zoom), latToTileY(S, zoom));
  const ty1 = Math.max(latToTileY(N, zoom), latToTileY(S, zoom));

  const tileCountX = tx1 - tx0 + 1;
  const tileCountY = ty1 - ty0 + 1;
  if (tileCountX * tileCountY > MAX_TILES) {
    throw new Error(`AOI covers ${tileCountX * tileCountY} tiles at z${zoom}; reduce zoom or AOI`);
  }

  const stitch = document.createElement('canvas');
  stitch.width = tileCountX * TILE_SIZE;
  stitch.height = tileCountY * TILE_SIZE;
  const sctx = stitch.getContext('2d');
  if (!sctx) throw new Error('Canvas 2D not available');

  const fetches: Promise<void>[] = [];
  for (let tx = tx0; tx <= tx1; tx++) {
    for (let ty = ty0; ty <= ty1; ty++) {
      const tileUrl = tileUrlTemplate
        .replace('{z}', String(zoom))
        .replace('{x}', String(tx))
        .replace('{y}', String(ty))
        .replace('{r}', '');     // some templates allow @{r}x retina
      fetches.push(
        fetch(tileUrl, { credentials: 'include' })
          .then(async (r) => {
            if (!r.ok) throw new Error(`tile ${tx},${ty} → HTTP ${r.status}`);
            const b = await r.blob();
            const ou = URL.createObjectURL(b);
            try {
              const img = await loadImage(ou);
              sctx.drawImage(img, (tx - tx0) * TILE_SIZE, (ty - ty0) * TILE_SIZE);
            } finally {
              URL.revokeObjectURL(ou);
            }
          }),
      );
    }
  }
  await Promise.all(fetches);

  // Crop the stitched canvas to the AOI rectangle in world-pixel coords.
  const tl = lngLatToWorldPx(W, N, zoom);
  const br = lngLatToWorldPx(E, S, zoom);
  const originX = tx0 * TILE_SIZE;
  const originY = ty0 * TILE_SIZE;
  const cropX = Math.max(0, Math.round(tl.x - originX));
  const cropY = Math.max(0, Math.round(tl.y - originY));
  const cropW = Math.max(1, Math.min(stitch.width - cropX, Math.round(br.x - tl.x)));
  const cropH = Math.max(1, Math.min(stitch.height - cropY, Math.round(br.y - tl.y)));

  const out = document.createElement('canvas');
  out.width = cropW;
  out.height = cropH;
  const octx = out.getContext('2d');
  if (!octx) throw new Error('Canvas 2D not available');
  octx.drawImage(stitch, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

  const blob: Blob = await new Promise((resolve, reject) => {
    out.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Failed to encode AOI image'))),
      'image/png',
    );
  });
  return { blob, width: cropW, height: cropH };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
  });
}

// ── Mask decoder + color helpers ─────────────────────────────────────────────

/**
 * Decode COCO uncompressed RLE (Fortran/column-major order) and render to a
 * data URL with the given color + alpha.
 */
function renderMaskToDataUrl(
  rle: BackendUncompressedRLE,
  fillColor: string,
  fillOpacity: number,
): string | null {
  const [h, w] = rle.size;
  if (!h || !w) return null;

  const { r, g, b } = parseColor(fillColor);
  const a = Math.round(Math.max(0, Math.min(1, fillOpacity)) * 255);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const imageData = ctx.createImageData(w, h);
  const data = imageData.data;

  let pos = 0;
  let value = 0;
  for (const len of rle.counts) {
    if (value === 1) {
      for (let i = 0; i < len; i++) {
        const flatIdx = pos + i;
        const row = flatIdx % h;
        const col = (flatIdx - row) / h;
        const dst = (row * w + col) * 4;
        data[dst] = r;
        data[dst + 1] = g;
        data[dst + 2] = b;
        data[dst + 3] = a;
      }
    }
    pos += len;
    value = 1 - value;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

function parseColor(c: string): { r: number; g: number; b: number } {
  const hex = c.replace('#', '');
  if (hex.length === 3) {
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
    };
  }
  if (hex.length === 6) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }
  return { r: 196, g: 152, b: 92 };
}
