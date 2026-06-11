import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type {
  LayerConfig,
  LayerStyle,
  LayerSourceType,
  SelectedFeature,
  RightPanelMode,
  LayerType,
  PendingAnnotation,
  BandSelection,
  AoiTimelineFrame,
  AnnotationFilter,
} from '@/features/maps/types';
import { DEFAULT_ANNOTATION_FILTER } from '@/features/maps/types';
import type { RenderingConfig } from '@/types/api';
import type { DatasetItem } from '@/types/api';
import type { GeoJSONGeometry } from '@/types/geo';
import { annotationSetsApi } from '@/lib/api/annotation-sets';
import { buildTileUrlFromConfig } from '@/features/maps/utils/datasetItemLayer';
import { getNextZIndex, resetZIndex } from './layerZIndex';

// ── Feature-click tracking (module-level) ──────────────────────────────────────
let _featureClickTime = 0;
export function markFeatureClick() { _featureClickTime = Date.now(); }
export function wasFeatureJustClicked() { return Date.now() - _featureClickTime < 100; }

// ── Locally-removed layer tracking (module-level) ─────────────────────────────
// Tracks layer IDs the user has explicitly removed during the current session.
// Cleared by resetForMap(). Prevents mapData re-sync from re-adding deleted layers
// regardless of which code path triggered the removal (LayerCard item toggle,
// dataset remove, annotation set remove, etc.).
const _locallyRemovedLayerIds = new Set<string>();
export function markLayerLocallyRemoved(id: string) { _locallyRemovedLayerIds.add(id); }
export function wasLayerLocallyRemoved(id: string) { return _locallyRemovedLayerIds.has(id); }
export function clearLocallyRemovedLayers() { _locallyRemovedLayerIds.clear(); }

import {
  DEFAULT_ANNOTATION_STYLE,
  DEFAULT_DATASET_STYLE,
  DEFAULT_TRACKING_STYLE,
  DEFAULT_ALERT_STYLE,
  DEFAULT_TILE_SERVICE_STYLE,
  DEFAULT_AOI_STYLE,
} from '@/features/maps/types';

const DEFAULT_STYLES: Record<LayerType, LayerStyle> = {
  annotation: DEFAULT_ANNOTATION_STYLE,
  dataset: DEFAULT_DATASET_STYLE,
  tracking: DEFAULT_TRACKING_STYLE,
  alert: DEFAULT_ALERT_STYLE,
  aoi: DEFAULT_AOI_STYLE,
};

interface MapLayersState {
  layers: Record<string, LayerConfig>;
  rightPanelMode: RightPanelMode;
  selectedLayerId: string | null;
  selectedFeature: SelectedFeature | null;
  measurementActive: boolean;
  measurementPoints: [number, number][];
  currentZoom: number;
  focusedLayerId: string | null;

  zoomToBounds: [number, number, number, number] | null;
  /** When true, the pending zoomToBounds request must only zoom IN (never out). */
  zoomInwardOnly: boolean;
  clearZoomToBounds: () => void;
  focusLayer: (layerId: string) => void;
  setCurrentZoom: (zoom: number) => void;

  pendingAnnotation: PendingAnnotation | null;
  openAnnotationPanel: () => void;
  setPendingAnnotationField: (patch: Partial<Omit<PendingAnnotation, 'attributes' | 'style'>>) => void;
  setPendingAnnotationStyle: (patch: Partial<LayerStyle>) => void;
  addPendingAnnotationAttribute: () => void;
  updatePendingAnnotationAttribute: (idx: number, key: string, value: string) => void;
  removePendingAnnotationAttribute: (idx: number) => void;
  clearPendingAnnotation: () => void;

  backendLayerIds: Record<string, string>;
  setBackendLayerId: (datasetId: string, layerId: string) => void;

  autoSaveDirty: boolean;
  markAutoSaveDirty: () => void;
  clearAutoSaveDirty: () => void;

  initLayer: (id: string, type: LayerType, opts?: {
    name?: string;
    sourceType?: LayerSourceType;
    zIndex?: number;
    tileServiceUrl?: string;
    parentDatasetId?: string;
    stacItemId?: string;
    annotationSetId?: string;
    classStyles?: Record<string, { fillColor: string; strokeColor: string; strokeWidth: number; fillOpacity: number }>;
    tileFormat?: 'raster' | 'mvt';
    mvtLayerName?: string;
    tileUrl?: string;
  }) => void;
  addAnnotationSetLayer: (args: {
    setId: string;
    name: string;
    classStyles?: Record<string, { fillColor: string; strokeColor: string; strokeWidth: number; fillOpacity: number }>;
    parentLayerId?: string;
    stacItemId?: string;
    datasetId?: string;
    /** True when this layer renders a raster segmentation mask via TiTiler (not MVT vector tiles). */
    isRasterMask?: boolean;
    /** Pre-built tile URL for raster mask layers (from buildRasterTileUrl). */
    tileUrl?: string;
  }) => string;
  removeAnnotationSetLayer: (setId: string) => void;
  aoiAnnotationSetBindings: Record<string, string[]>;
  bindAnnotationSetToStacItem: (stacItemId: string, setId: string) => void;
  unbindAnnotationSetFromStacItem: (stacItemId: string, setId: string) => void;
  removeLayer: (id: string) => void;
  setLayerVisible: (id: string, visible: boolean) => void;
  renameLayer: (id: string, name: string) => void;
  setLayerOpacity: (id: string, opacity: number) => void;
  setLayerStyle: (id: string, patch: Partial<LayerStyle>) => void;
  /** Update the annotation visualization filter for an annotation_set layer. */
  setLayerAnnotationFilter: (id: string, patch: Partial<AnnotationFilter>) => void;
  setLayerTileConfig: (
    id: string,
    config: { tileUrl: string; tileBounds?: [number, number, number, number]; tileMinZoom?: number; tileMaxZoom?: number }
  ) => void;
  setLayerRenderingConfig: (id: string, config: RenderingConfig) => void;
  setLayerParentDatasetId: (id: string, parentDatasetId: string) => void;
  setLayerBandSelection: (id: string, bands: BandSelection | null, preset?: string | null) => void;
  getLayer: (id: string) => LayerConfig | undefined;

  applyReorder: (newOrder: Record<string, number>) => void;
  moveLayer: (id: string, direction: 'up' | 'down') => [string, string] | null;

  selectedDatasetId: string | null;
  openDatasetPanel: (datasetId: string) => void;

  selectedItemsDatasetId: string | null;
  openItemsPanel: (datasetId: string) => void;

  selectedAnnotationSetId: string | null;
  openAnnotationSetPanel: (annotationSetId: string) => void;

  openFeaturePanel: (feature: SelectedFeature) => void;
  openStylePanel: (layerId: string) => void;
  openMeasurementPanel: () => void;
  showAnnotationPanel: () => void;
  closeRightPanel: () => void;

  layerOnMapClick: (layerId: string) => void;

  resetForMap: () => void;

  refreshAnnotationSetId: string | null;
  requestAnnotationSetRefresh: (setId: string) => void;
  clearAnnotationSetRefresh: () => void;

  toggleMeasurement: () => void;
  addMeasurementPoint: (pt: [number, number]) => void;
  clearMeasurement: () => void;
  clearMeasurementPoints: () => void;

  /** Active annotation set for drawing mode (setId or null). */
  activeAnnotationSetId: string | null;
  /** Selected class within the active annotation draw set. */
  activeAnnotationClassId: string | null;
  startAnnotationDraw: (setId: string) => void;
  setAnnotationDrawClass: (classId: string | null) => void;
  stopAnnotationDraw: () => void;

  /** Fire-and-forget zoom request — consumed by useMapSync. */
  requestZoomToBounds: (bounds: [number, number, number, number]) => void;

  aoiDrawMode: boolean;
  setAoiDrawMode: (active: boolean) => void;
  createAoiLayer: (geometry: GeoJSONGeometry, bbox: [number, number, number, number]) => string;

  /** When true, rectangles drawn on the map are captured as SAM3 bbox prompts
   *  (relayed via `capturedBboxPrompt`) instead of becoming AOIs/annotations. */
  bboxPromptDrawMode: boolean;
  setBboxPromptDrawMode: (active: boolean) => void;
  /** Last rectangle drawn while `bboxPromptDrawMode` is on, as [W,S,E,N] (4326).
   *  AoiInferencePanel consumes this, appends it to its prompt list, then clears. */
  capturedBboxPrompt: [number, number, number, number] | null;
  setCapturedBboxPrompt: (bbox: [number, number, number, number] | null) => void;

  selectedAoiLayerId: string | null;
  aoiSelectedDatasetIds: string[];
  openAoiPanel: (aoiLayerId: string) => void;
  toggleAoiDataset: (datasetId: string) => void;
  setAoiSelectedDatasets: (ids: string[]) => void;

  addAoiBoundedDataset: (
    aoiLayerId: string,
    dataset: { id: string; name: string; stac_collection_id?: string },
    bbox: [number, number, number, number]
  ) => string;
  removeAoiBoundedDataset: (layerId: string) => void;

  // AOI timeline actions (missing ones added)
  addAoiTimelineItems: (
    aoiId: string,
    datasetId: string,
    items: Array<{ datetime: string; itemId: string; stacItemId: string }>,
    collectionId?: string,
  ) => void;
  removeAoiTimelineItems: (aoiId: string, datasetId: string) => void;
  clearAoiTimeline: (aoiId: string) => void;

  aoiTimelineEnabled: boolean;
  aoiTimelineAoiId: string | null;
  aoiTimelineDatasetIds: string[];
  aoiTimelineCollectionMap: Record<string, string>;
  aoiTimelineFrames: AoiTimelineFrame[];
  aoiTimelineIndex: number;
  aoiTimelinePlaying: boolean;
  aoiTimelineSpeed: number;
  aoiTimelineRange: [string, string] | null;
  /** Annotation-set ids of the model series selected to overlay during
   *  playback. Non-empty → per-frame effect restricts overlay to these sets. */
  aoiTimelineAnnotationSetIds: string[];
  /** Raster render mode for playback: 'index' applies a TiTiler expression for
   *  the selected spectral index instead of the RGB band params. */
  aoiTimelineRenderMode: 'rgb' | 'index';
  /** Active spectral index id (see SPECTRAL_INDICES registry); null = RGB. */
  aoiTimelineIndexId: string | null;
  /** Resolved band map for the active index: role ('nir'|'red'|…) → band index. */
  aoiTimelineIndexBands: Record<string, number>;
  /** Lower-bound threshold in the index's value domain; pixels below render
   *  transparent. null = no threshold (full ramp). Held across every frame. */
  aoiTimelineThreshold: number | null;
  /** When false, annotation sets are hidden during playback (raster only). */
  aoiTimelineShowAnnotations: boolean;

  openAoiTimeline: (
    aoiId: string,
    datasetIds: string[],
    collectionMap: Record<string, string>,
    opts?: {
      renderMode?: 'rgb' | 'index';
      indexId?: string | null;
      indexBands?: Record<string, number>;
      threshold?: number | null;
    },
  ) => void;
  closeAoiTimeline: () => void;
  setAoiTimelineFrames: (frames: AoiTimelineFrame[]) => void;
  setAoiTimelineIndex: (index: number) => void;
  stepAoiTimeline: (direction: 'next' | 'prev') => void;
  toggleAoiTimelinePlay: () => void;
  setAoiTimelineSpeed: (ms: number) => void;
  setAoiTimelineRange: (range: [string, string] | null) => void;
  setAoiTimelineAnnotationSetIds: (ids: string[]) => void;
  setAoiTimelineRenderMode: (mode: 'rgb' | 'index') => void;
  /** Set (or clear) the active spectral index + its resolved band map. */
  setAoiTimelineSpectralIndex: (indexId: string | null, bands: Record<string, number>) => void;
  /** Set (or clear) the lower-bound threshold — applies live during playback. */
  setAoiTimelineThreshold: (threshold: number | null) => void;
  setAoiTimelineShowAnnotations: (show: boolean) => void;
  /** Bumped when AOI child layer band/preset changes to trigger sync re-render of current frame */
  aoiRenderVersion: number;
  bumpAoiRenderVersion: () => void;

  timelineEnabled: boolean;
  timelineDatasetId: string | null;
  timelineItems: DatasetItem[];
  timelineIndex: number;
  timelinePlaying: boolean;
  timelineSpeed: number;
  timelineRange: [string, string] | null;
  timelineOriginalTileUrl: string | null;

  openTimeline: (datasetId: string) => void;
  closeTimeline: () => void;
  setTimelineItems: (items: DatasetItem[]) => void;
  setTimelineIndex: (index: number) => void;
  stepTimeline: (direction: 'next' | 'prev') => void;
  toggleTimelinePlay: () => void;
  setTimelineSpeed: (ms: number) => void;
  setTimelineRange: (range: [string, string] | null) => void;
}

export const useMapLayersStore = create<MapLayersState>()(
  subscribeWithSelector((set, get) => ({
    layers: {},
    backendLayerIds: {},
    rightPanelMode: 'none',
    selectedLayerId: null,
    selectedFeature: null,
    selectedDatasetId: null,
    selectedItemsDatasetId: null,
    selectedAnnotationSetId: null,
    measurementActive: false,
    measurementPoints: [],
    currentZoom: 2,
    focusedLayerId: null,
    pendingAnnotation: null,
    autoSaveDirty: false,
    zoomToBounds: null,
    zoomInwardOnly: false,
    refreshAnnotationSetId: null,
    activeAnnotationSetId: null,
    activeAnnotationClassId: null,
    aoiDrawMode: false,
    bboxPromptDrawMode: false,
    capturedBboxPrompt: null,
    selectedAoiLayerId: null,
    aoiSelectedDatasetIds: [],
    aoiTimelineEnabled: false,
    aoiTimelineAoiId: null,
    aoiTimelineDatasetIds: [],
    aoiTimelineCollectionMap: {},
    // aoiAnnotationSetBindings defined below alongside its actions
    aoiTimelineFrames: [],
    aoiTimelineIndex: 0,
    aoiTimelinePlaying: false,
    aoiTimelineSpeed: 2000,
    aoiTimelineRange: null,
    aoiTimelineAnnotationSetIds: [],
    aoiTimelineRenderMode: 'rgb',
    aoiTimelineIndexId: null,
    aoiTimelineIndexBands: {},
    aoiTimelineThreshold: null,
    aoiTimelineShowAnnotations: true,
    aoiRenderVersion: 0,
    timelineEnabled: false,
    timelineDatasetId: null,
    timelineItems: [],
    timelineIndex: 0,
    timelinePlaying: false,
    timelineSpeed: 2000,
    timelineRange: null,
    timelineOriginalTileUrl: null,

    resetForMap: () => {
      clearLocallyRemovedLayers();
      resetZIndex();
      set({
        layers: {},
        backendLayerIds: {},
        rightPanelMode: 'none',
        selectedLayerId: null,
        selectedFeature: null,
        selectedDatasetId: null,
        selectedItemsDatasetId: null,
        selectedAnnotationSetId: null,
        measurementActive: false,
        measurementPoints: [],
        currentZoom: 2,
        focusedLayerId: null,
        pendingAnnotation: null,
        autoSaveDirty: false,
        zoomToBounds: null,
        zoomInwardOnly: false,
        refreshAnnotationSetId: null,
        activeAnnotationSetId: null,
        activeAnnotationClassId: null,
        aoiDrawMode: false,
        selectedAoiLayerId: null,
        aoiSelectedDatasetIds: [],
        aoiAnnotationSetBindings: {},
        aoiTimelineEnabled: false,
        aoiTimelineAoiId: null,
        aoiTimelineDatasetIds: [],
        aoiTimelineFrames: [],
        aoiTimelineIndex: 0,
        aoiTimelinePlaying: false,
        aoiTimelineSpeed: 2000,
        aoiTimelineRange: null,
        aoiTimelineRenderMode: 'rgb',
        aoiTimelineIndexId: null,
        aoiTimelineIndexBands: {},
        aoiTimelineThreshold: null,
        aoiTimelineShowAnnotations: true,
        aoiRenderVersion: 0,
        timelineEnabled: false,
        timelineDatasetId: null,
        timelineItems: [],
        timelineIndex: 0,
        timelinePlaying: false,
        timelineSpeed: 2000,
        timelineRange: null,
        timelineOriginalTileUrl: null,
      });
    },

    requestAnnotationSetRefresh: (setId: string) => set({ refreshAnnotationSetId: setId }),
    clearAnnotationSetRefresh: () => set({ refreshAnnotationSetId: null }),

    setBackendLayerId: (datasetId, layerId) =>
      set((s) => ({ backendLayerIds: { ...s.backendLayerIds, [datasetId]: layerId } })),

    markAutoSaveDirty: () => set({ autoSaveDirty: true }),
    clearAutoSaveDirty: () => set({ autoSaveDirty: false }),

    startAnnotationDraw: (setId: string) =>
      set({ activeAnnotationSetId: setId, activeAnnotationClassId: null, rightPanelMode: 'annotation-draw' }),
    setAnnotationDrawClass: (classId: string | null) => set({ activeAnnotationClassId: classId }),
    stopAnnotationDraw: () =>
      set({ activeAnnotationSetId: null, activeAnnotationClassId: null, rightPanelMode: 'none' }),

    requestZoomToBounds: (bounds: [number, number, number, number]) =>
      set({ zoomToBounds: bounds, zoomInwardOnly: false }),

    setAoiDrawMode: (active: boolean) => set({ aoiDrawMode: active }),

    setBboxPromptDrawMode: (active: boolean) => set({ bboxPromptDrawMode: active }),
    setCapturedBboxPrompt: (bbox) => set({ capturedBboxPrompt: bbox }),

    createAoiLayer: (geometry, bbox) => {
      const state = get();
      const aoiCount = Object.values(state.layers).filter((l) => l.type === 'aoi').length;
      const id = `aoi-${Date.now()}`;
      const name = `AOI ${aoiCount + 1}`;
      const zIndex = getNextZIndex();

      set((s) => ({
        layers: {
          ...s.layers,
          [id]: {
            id,
            name,
            type: 'aoi' as const,
            visible: true,
            opacity: 1,
            style: { ...DEFAULT_AOI_STYLE },
            zIndex,
            bounds: bbox,
            aoiGeometry: geometry,
            aoiBbox: bbox,
          },
        },
        selectedLayerId: id,
        aoiDrawMode: false,
      }));
      return id;
    },

    openAoiPanel: (aoiLayerId) => set({
      rightPanelMode: 'aoi' as const,
      selectedAoiLayerId: aoiLayerId,
      selectedLayerId: aoiLayerId,
      selectedFeature: null,
    }),

    toggleAoiDataset: (datasetId) => set((s) => {
      const ids = s.aoiSelectedDatasetIds;
      return {
        aoiSelectedDatasetIds: ids.includes(datasetId)
          ? ids.filter((id) => id !== datasetId)
          : [...ids, datasetId],
      };
    }),

    setAoiSelectedDatasets: (ids) => set({ aoiSelectedDatasetIds: ids }),

    // ── AOI bounded child layer (with fixes) ─────────────────────────────────
    addAoiBoundedDataset: (aoiLayerId, dataset, bbox) => {
      const state = get();
      const parentAoi = state.layers[aoiLayerId];
      if (!parentAoi) return '';

      const childId = `${aoiLayerId}-ds-${dataset.id}`;
      if (state.layers[childId]) return childId;

      const zIndex = getNextZIndex();

      set((s) => ({
        layers: {
          ...s.layers,
          [childId]: {
            id: childId,
            name: `${dataset.name} (in ${parentAoi.name})`,
            type: 'dataset' as const,
            sourceType: 'dataset' as const,
            visible: true,
            opacity: 1,
            style: { ...DEFAULT_STYLES.dataset },
            zIndex,
            bounds: bbox,
            parentAoiId: aoiLayerId,
            clipBounds: bbox,
            sourceDatasetId: dataset.id,
            stacCollectionId: dataset.stac_collection_id,
            loading: true,
          },
        },
      }));

      const collectionId = dataset.stac_collection_id;
      if (!collectionId) {
        console.warn(`[AOI] Dataset ${dataset.id} has no STAC collection ID`);
        set((s) => s.layers[childId] ? {
          layers: { ...s.layers, [childId]: { ...s.layers[childId], loading: false } }
        } : s);
        return childId;
      }

      Promise.all([
        import('@/lib/api/stac'),
        import('@/lib/api/datasets'),
      ]).then(async ([{ stacApi }, { datasetsApi }]) => {
        try {
          const bboxStr = bbox.join(',');
          console.log(`[AOI] Fetching items for ${dataset.name} in bbox: ${bboxStr}`);
          const itemsResponse = await stacApi.listCollectionItems(collectionId, { bbox: bboxStr, limit: 100 });
          const features = itemsResponse.features ?? [];
          console.log(`[AOI] Found ${features.length} items for ${dataset.name}`);

          if (features.length === 0) {
            console.warn(`[AOI] No STAC items found within AOI for ${dataset.name}`);
            set((s) => s.layers[childId] ? {
              layers: { ...s.layers, [childId]: { ...s.layers[childId], loading: false } }
            } : s);
            return;
          }

          // Populate AOI timeline frames — stacItemId = feature.id (STAC item ID)
          // Use broad datetime detection matching useAoiTimeline (datetime, start_datetime, created, acquired)

          const firstStacItemId = features[0].id;
          console.log(`[AOI] Fetching tile config for item ${firstStacItemId} in dataset ${dataset.id}`);
          const cfg = await datasetsApi.getItemTileConfigByStacId(dataset.id, firstStacItemId);

          if (!cfg.tile_url_template) {
            console.warn(`[AOI] No tile URL for ${firstStacItemId}`);
            set((s) => s.layers[childId] ? {
              layers: { ...s.layers, [childId]: { ...s.layers[childId], loading: false } }
            } : s);
            return;
          }

          // Build tile URL with default preset/bands, then extract RGB for AOI child layer
          const { tileUrl: rawTileUrl } = buildTileUrlFromConfig(cfg);
          
          // For AOI child layers, always default to RGB (not greyscale preset)
          // This ensures band selector in AoiPanel can override rendering
          const rc = cfg.rendering_config;
          let aoiBandSelection: BandSelection | null = null;
          let rIdx = 1, gIdx = 2, bIdx = 3;
          if (rc?.bands && rc.bands.length >= 3) {
            rIdx = rc.bands[0]?.index ?? 1;
            gIdx = rc.bands[1]?.index ?? 2;
            bIdx = rc.bands[2]?.index ?? 3;
            aoiBandSelection = { r: rIdx, g: gIdx, b: bIdx };
          }

          const [tilePath] = rawTileUrl.split('?');
          const tileParams = new URLSearchParams();
          if (aoiBandSelection) {
            tileParams.set('asset_bidx', `data|${rIdx},${gIdx},${bIdx}`);
            const rBand = rc?.bands?.find((b) => b.index === rIdx);
            const gBand = rc?.bands?.find((b) => b.index === gIdx);
            const bBand = rc?.bands?.find((b) => b.index === bIdx);
            if (rBand && gBand && bBand) {
              const p2 = Math.min(rBand.stats.p2, gBand.stats.p2, bBand.stats.p2);
              const p98 = Math.max(rBand.stats.p98, gBand.stats.p98, bBand.stats.p98);
              tileParams.set('rescale', `${Math.round(p2)},${Math.round(p98)}`);
            }
          }
          tileParams.set('bbox', bboxStr);
          const tileUrl = `${tilePath}?${tileParams.toString()}`;

          console.log(`[AOI] Final tile URL: ${tileUrl}`);

          useMapLayersStore.getState().setLayerTileConfig(childId, {
            tileUrl,
            tileBounds: bbox,
          });

          if (cfg.rendering_config) {
            useMapLayersStore.getState().setLayerRenderingConfig(childId, cfg.rendering_config);
          }

          // Store RGB band selection for AOI child layer (no activePreset to avoid greyscale override)
          if (aoiBandSelection) {
            useMapLayersStore.getState().setLayerBandSelection(childId, aoiBandSelection, null);
          }

          set((s) => s.layers[childId] ? {
            layers: { ...s.layers, [childId]: { ...s.layers[childId], loading: false } }
          } : s);
        } catch (err) {
          console.error(`[AOI] Failed to load tiles for ${dataset.name}:`, err);
          set((s) => s.layers[childId] ? {
            layers: { ...s.layers, [childId]: { ...s.layers[childId], loading: false, error: true } }
          } : s);
        }
      });

      return childId;
    },

    removeAoiBoundedDataset: (layerId) => {
      set((s) => {
        const { [layerId]: removed, ...rest } = s.layers;
        return { layers: rest };
      });
    },

    // ── AOI timeline item management actions ────────────────────────────────
    addAoiTimelineItems: (aoiId, datasetId, items, collectionId) => {
      set((state) => {
        const isActive = state.aoiTimelineAoiId === aoiId;
        const prevDatasetIds = isActive ? [...state.aoiTimelineDatasetIds] : [];
        const prevFrames = isActive ? [...state.aoiTimelineFrames] : [];

        // Build updated collection map
        const collectionMap = isActive ? { ...state.aoiTimelineCollectionMap } : {};
        if (collectionId) collectionMap[datasetId] = collectionId;

        // Build flat item list with stacItemId for all existing + new items
        type RawItem = { datetime: string; datasetId: string; itemId: string; stacItemId: string };
        const existingItems: RawItem[] = prevFrames.flatMap(f =>
          f.items.map(i => ({ datetime: f.datetime, datasetId: i.datasetId, itemId: i.itemId, stacItemId: i.stacItemId }))
        );
        const newItems: RawItem[] = items.map(item => ({
          datetime: item.datetime,
          datasetId,
          itemId: item.itemId,
          stacItemId: item.stacItemId,
        }));

        // Merge and group by datetime
        const combined = [...existingItems.filter(i => i.datasetId !== datasetId), ...newItems];
        const grouped = new Map<string, RawItem[]>();
        for (const item of combined) {
          const list = grouped.get(item.datetime) ?? [];
          list.push(item);
          grouped.set(item.datetime, list);
        }

        const frames = Array.from(grouped.entries())
          .filter(([dt]) => !!dt)
          .map(([datetime, frameItems]) => ({
            datetime,
            items: frameItems.map(i => ({ datasetId: i.datasetId, itemId: i.itemId, stacItemId: i.stacItemId })),
            stacItemIds: frameItems.map(i => i.stacItemId),
          }))
          .sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());

        const datasetIds = isActive
          ? (prevDatasetIds.includes(datasetId) ? prevDatasetIds : [...prevDatasetIds, datasetId])
          : [datasetId];

        return {
          aoiTimelineEnabled: true,
          aoiTimelineAoiId: aoiId,
          aoiTimelineDatasetIds: datasetIds,
          aoiTimelineCollectionMap: collectionMap,
          aoiTimelineFrames: frames,
          aoiTimelineIndex: 0,
          aoiTimelinePlaying: false,
        };
      });
    },

    removeAoiTimelineItems: (aoiId, datasetId) => {
      set((state) => {
        if (state.aoiTimelineAoiId !== aoiId) return state;
        const newDatasetIds = state.aoiTimelineDatasetIds.filter(id => id !== datasetId);
        if (newDatasetIds.length === 0) {
          return {
            aoiTimelineEnabled: false,
            aoiTimelineAoiId: null,
            aoiTimelineDatasetIds: [],
            aoiTimelineCollectionMap: {},
            aoiTimelineFrames: [],
            aoiTimelineIndex: 0,
            aoiTimelinePlaying: false,
          };
        }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [datasetId]: _removedEntry, ...newCollectionMap } = state.aoiTimelineCollectionMap;
        const newFrames = state.aoiTimelineFrames
          .map(frame => {
            const items = frame.items.filter(item => item.datasetId !== datasetId);
            return { ...frame, items, stacItemIds: items.map(i => i.stacItemId) };
          })
          .filter(frame => frame.items.length > 0);
        return {
          aoiTimelineDatasetIds: newDatasetIds,
          aoiTimelineCollectionMap: newCollectionMap,
          aoiTimelineFrames: newFrames,
        };
      });
    },

    clearAoiTimeline: (aoiId) => {
      set((state) => {
        if (state.aoiTimelineAoiId !== aoiId) return state;
        return {
          aoiTimelineEnabled: false,
          aoiTimelineAoiId: null,
          aoiTimelineDatasetIds: [],
          aoiTimelineFrames: [],
        };
      });
    },

    // ── Existing AOI timeline actions (unchanged) ───────────────────────────
    openAoiTimeline: (aoiId, datasetIds, collectionMap, opts) => set({
      timelineEnabled: false,
      timelineDatasetId: null,
      timelinePlaying: false,
      aoiTimelineEnabled: true,
      aoiTimelineAoiId: aoiId,
      aoiTimelineDatasetIds: datasetIds,
      aoiTimelineCollectionMap: collectionMap,
      aoiTimelineFrames: [],
      aoiTimelineIndex: 0,
      aoiTimelinePlaying: false,
      aoiTimelineRange: null,
      aoiTimelineAnnotationSetIds: [],
      aoiTimelineRenderMode: opts?.renderMode ?? (opts?.indexId ? 'index' : 'rgb'),
      aoiTimelineIndexId: opts?.indexId ?? null,
      aoiTimelineIndexBands: opts?.indexBands ?? {},
      aoiTimelineThreshold: opts?.threshold ?? null,
    }),

    closeAoiTimeline: () => set({
      aoiTimelineEnabled: false,
      aoiTimelineAoiId: null,
      aoiTimelineDatasetIds: [],
      aoiTimelineCollectionMap: {},
      aoiTimelineFrames: [],
      aoiTimelineIndex: 0,
      aoiTimelinePlaying: false,
      aoiTimelineRange: null,
      aoiTimelineAnnotationSetIds: [],
      aoiTimelineRenderMode: 'rgb',
      aoiTimelineIndexId: null,
      aoiTimelineIndexBands: {},
      aoiTimelineThreshold: null,
    }),

    setAoiTimelineFrames: (frames) => set({ aoiTimelineFrames: frames, aoiTimelineIndex: 0 }),

    setAoiTimelineIndex: (index) => set({ aoiTimelineIndex: index }),

    stepAoiTimeline: (direction) => {
      const { aoiTimelineFrames: frames, aoiTimelineIndex: idx, aoiTimelineRange: range } = get();
      if (frames.length < 2) return;

      const validIndices = range
        ? frames.map((f, i) => ({ f, i })).filter(({ f }) => {
            const d = new Date(f.datetime).getTime();
            const [from, to] = range;
            if (from && d < new Date(from).getTime()) return false;
            if (to && d > new Date(to + 'T23:59:59').getTime()) return false;
            return true;
          }).map(({ i }) => i)
        : frames.map((_, i) => i);

      if (validIndices.length < 2) return;
      const currentPos = validIndices.indexOf(idx);
      let nextPos: number;
      if (direction === 'next') {
        nextPos = currentPos === -1 || currentPos >= validIndices.length - 1 ? 0 : currentPos + 1;
      } else {
        nextPos = currentPos <= 0 ? validIndices.length - 1 : currentPos - 1;
      }
      set({ aoiTimelineIndex: validIndices[nextPos] });
    },

    toggleAoiTimelinePlay: () => set((s) => ({ aoiTimelinePlaying: !s.aoiTimelinePlaying })),
    setAoiTimelineSpeed: (ms) => set({ aoiTimelineSpeed: ms }),
    setAoiTimelineAnnotationSetIds: (ids) => set({ aoiTimelineAnnotationSetIds: ids }),
    setAoiTimelineRange: (range) => set({ aoiTimelineRange: range }),
    setAoiTimelineRenderMode: (mode) => set({ aoiTimelineRenderMode: mode }),
    setAoiTimelineSpectralIndex: (indexId, bands) => set({
      aoiTimelineIndexId: indexId,
      aoiTimelineIndexBands: bands,
      aoiTimelineRenderMode: indexId ? 'index' : 'rgb',
    }),
    setAoiTimelineThreshold: (threshold) => set({ aoiTimelineThreshold: threshold }),
    setAoiTimelineShowAnnotations: (show) => set({ aoiTimelineShowAnnotations: show }),
    bumpAoiRenderVersion: () => set((s) => ({ aoiRenderVersion: s.aoiRenderVersion + 1 })),

    // ── Existing other actions (unchanged) ───────────────────────────────────
    clearZoomToBounds: () => set({ zoomToBounds: null, zoomInwardOnly: false }),
    setCurrentZoom: (zoom: number) => set({ currentZoom: zoom }),

    focusLayer: (layerId) => {
      const layer = get().layers[layerId];
      if (!layer) return;
      const updates: Partial<MapLayersState> = {
        selectedLayerId: layerId,
        focusedLayerId: layerId,
      };
      if (layer.bounds) {
        updates.zoomToBounds = layer.bounds;
        // Click-to-select should only ever zoom IN to frame the layer — never
        // zoom out when the user is already zoomed in past it.
        updates.zoomInwardOnly = true;
      }
      if (layer.type === 'aoi') {
        Object.assign(updates, {
          rightPanelMode: 'aoi' as const,
          selectedAoiLayerId: layerId,
          selectedFeature: null,
        });
      } else if (layer.sourceType === 'annotation_set' && layer.annotationSetId) {
        Object.assign(updates, {
          rightPanelMode: 'annotation-set' as const,
          selectedAnnotationSetId: layer.annotationSetId,
          selectedFeature: null,
        });
      } else if (layer.sourceType === 'dataset') {
        // AOI child layers have a compound layerId (aoi-{ts}-ds-{uuid}); the real
        // dataset UUID is stored in layer.sourceDatasetId. Regular dataset layers
        // use the dataset UUID as their layerId directly.
        const datasetId = layer.sourceDatasetId ?? layerId;
        Object.assign(updates, {
          rightPanelMode: 'dataset' as const,
          selectedDatasetId: datasetId,
          selectedFeature: null,
        });
      } else {
        Object.assign(updates, {
          rightPanelMode: 'style' as const,
          selectedFeature: null,
        });
      }
      set(updates);
    },

    initLayer: (id, type, opts) =>
      set((s) => {
        const existing = s.layers[id];
        if (existing) {
          const updates: Record<string, unknown> = {};
          if (opts?.parentDatasetId && !existing.parentDatasetId) updates.parentDatasetId = opts.parentDatasetId;
          if (opts?.stacItemId && !existing.stacItemId) updates.stacItemId = opts.stacItemId;
          if (opts?.sourceType && !existing.sourceType) updates.sourceType = opts.sourceType;
          if (Object.keys(updates).length === 0) return s;
          return {
            layers: {
              ...s.layers,
              [id]: { ...existing, ...updates },
            },
          };
        }
        const zIndex = opts?.zIndex ?? getNextZIndex();
        const style = type === 'dataset' && opts?.sourceType === 'tile_service'
          ? { ...DEFAULT_TILE_SERVICE_STYLE }
          : { ...DEFAULT_STYLES[type] };
        return {
          layers: {
            ...s.layers,
            [id]: {
              id,
              name: opts?.name,
              type,
              sourceType: opts?.sourceType,
              visible: true,
              opacity: 1,
              style,
              zIndex,
              tileServiceUrl: opts?.tileServiceUrl,
              parentDatasetId: opts?.parentDatasetId,
              stacItemId: opts?.stacItemId,
              annotationSetId: opts?.annotationSetId,
              classStyles: opts?.classStyles,
              tileFormat: opts?.tileFormat,
              mvtLayerName: opts?.mvtLayerName,
              tileUrl: opts?.tileUrl,
            },
          },
        };
      }),

    aoiAnnotationSetBindings: {},
    bindAnnotationSetToStacItem: (stacItemId, setId) =>
      set((s) => {
        const cur = s.aoiAnnotationSetBindings[stacItemId] ?? [];
        if (cur.includes(setId)) return s;
        return {
          aoiAnnotationSetBindings: {
            ...s.aoiAnnotationSetBindings,
            [stacItemId]: [...cur, setId],
          },
        };
      }),
    unbindAnnotationSetFromStacItem: (stacItemId, setId) =>
      set((s) => {
        const cur = s.aoiAnnotationSetBindings[stacItemId];
        if (!cur) return s;
        const next = cur.filter((x) => x !== setId);
        const map = { ...s.aoiAnnotationSetBindings };
        if (next.length) map[stacItemId] = next; else delete map[stacItemId];
        return { aoiAnnotationSetBindings: map };
      }),

    addAnnotationSetLayer: ({ setId, name, classStyles, parentLayerId, stacItemId, datasetId, isRasterMask, tileUrl: rasterTileUrl }) => {
      const id = `annset-${setId}`;
      const state = get();
      if (state.layers[id]) return id;

      // Raster mask layers use a pre-built authenticated tile URL from buildRasterTileUrl.
      // Vector annotation set layers use the MVT tile URL template from the API.
      const tileUrl = isRasterMask
        ? (rasterTileUrl ?? annotationSetsApi.getTileUrlTemplate(setId))
        : annotationSetsApi.getTileUrlTemplate(setId);

      // Z-order: just above parent raster if present, else top.
      let zIndex = getNextZIndex();
      if (parentLayerId && state.layers[parentLayerId]) {
        zIndex = state.layers[parentLayerId].zIndex + 0.5;
      }

      set((s) => ({
        layers: {
          ...s.layers,
          [id]: {
            id,
            name,
            type: 'annotation' as const,
            sourceType: 'annotation_set' as const,
            visible: true,
            opacity: 1,
            style: { ...DEFAULT_ANNOTATION_STYLE },
            zIndex,
            tileFormat: isRasterMask ? ('raster' as const) : ('mvt' as const),
            mvtLayerName: isRasterMask ? undefined : 'annotation_set_mvt',
            tileUrl,
            annotationSetId: setId,
            classStyles,
            isRasterMask: isRasterMask ?? false,
            parentDatasetId: parentLayerId,
            stacItemId,
          },
        },
      }));

      if (stacItemId) get().bindAnnotationSetToStacItem(stacItemId, setId);
      void datasetId; // reserved for dataset-level attachment metadata
      return id;
    },

    removeAnnotationSetLayer: (setId) => {
      const id = `annset-${setId}`;
      const layer = get().layers[id];
      if (layer?.stacItemId) get().unbindAnnotationSetFromStacItem(layer.stacItemId, setId);
      get().removeLayer(id);
    },

    removeLayer: (id) => {
      // Track removal immediately so mapData re-sync effects can't re-add this layer.
      markLayerLocallyRemoved(id);
      set((s) => {
        const removedLayer = s.layers[id];
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [id]: _removedLayer, ...remainingLayers } = s.layers;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [id]: _removedBackend, ...remainingBackendIds } = s.backendLayerIds;

        const updates: Partial<MapLayersState> = {
          backendLayerIds: remainingBackendIds,
        };

        // AOI cascade: remove child layers and clean up AOI-related state
        if (removedLayer?.type === 'aoi') {
          // Remove all child layers that reference this AOI as parent
          const filteredLayers: Record<string, LayerConfig> = {};
          for (const [lid, layer] of Object.entries(remainingLayers)) {
            if (layer.parentAoiId !== id) {
              filteredLayers[lid] = layer;
            }
          }
          updates.layers = filteredLayers;

          // Clean up AOI panel state
          if (s.selectedAoiLayerId === id) {
            updates.rightPanelMode = 'none';
            updates.selectedAoiLayerId = null;
            updates.aoiSelectedDatasetIds = [];
          }
          if (s.selectedLayerId === id) {
            updates.selectedLayerId = null;
          }

          // Close AOI timeline if active for this AOI
          if (s.aoiTimelineAoiId === id) {
            updates.aoiTimelineEnabled = false;
            updates.aoiTimelineAoiId = null;
            updates.aoiTimelineDatasetIds = [];
            updates.aoiTimelineCollectionMap = {};
            updates.aoiTimelineFrames = [];
            updates.aoiTimelineIndex = 0;
            updates.aoiTimelinePlaying = false;
            updates.aoiTimelineRange = null;
            updates.aoiTimelineAnnotationSetIds = [];
          }
        } else {
          updates.layers = remainingLayers;

          // Clean up selection if this layer was selected
          if (s.selectedLayerId === id) {
            updates.selectedLayerId = null;
          }

          // Clean up annotation set state if removing an annotation set
          if (removedLayer?.sourceType === 'annotation_set' && removedLayer?.annotationSetId) {
            if (s.selectedAnnotationSetId === removedLayer.annotationSetId) {
              updates.selectedAnnotationSetId = null;
            }
            if (s.activeAnnotationSetId === removedLayer.annotationSetId) {
              updates.activeAnnotationSetId = null;
              updates.activeAnnotationClassId = null;
              // If in annotation draw mode, close the right panel
              if (s.rightPanelMode === 'annotation-draw') {
                updates.rightPanelMode = 'none';
              }
            }
          }
        }

        return updates;
      });
    },

    setLayerVisible: (id, visible) =>
      set((s) => {
        const layer = s.layers[id];
        // Guard: never create a layer implicitly, and bail when the value is
        // unchanged. Returning the same state is critical — effects in
        // MapEditorShell that depend on `layers` also call setLayerVisible, so
        // emitting a new `layers` reference on a no-op toggle re-fires those
        // effects forever ("Maximum update depth exceeded").
        if (!layer || layer.visible === visible) return s;
        return { layers: { ...s.layers, [id]: { ...layer, visible } } };
      }),

    renameLayer: (id, name) =>
      set((s) => {
        if (!s.layers[id]) return s; // guard: never create a layer implicitly
        return {
          layers: { ...s.layers, [id]: { ...s.layers[id], name } },
          autoSaveDirty: true,
        };
      }),

    setLayerOpacity: (id, opacity) =>
      set((s) => ({
        layers: { ...s.layers, [id]: { ...s.layers[id], opacity } },
        autoSaveDirty: true,
      })),

    setLayerStyle: (id, patch) =>
      set((s) => ({
        layers: {
          ...s.layers,
          [id]: { ...s.layers[id], style: { ...s.layers[id]?.style, ...patch } },
        },
        autoSaveDirty: true,
      })),

    setLayerAnnotationFilter: (id, patch) =>
      set((s) => {
        const layer = s.layers[id];
        if (!layer) return s; // guard: never create a layer implicitly
        return {
          layers: {
            ...s.layers,
            [id]: {
              ...layer,
              annotationFilter: {
                ...DEFAULT_ANNOTATION_FILTER,
                ...layer.annotationFilter,
                ...patch,
              },
            },
          },
        };
      }),

    setLayerTileConfig: (id, config) =>
      set((s) => {
        if (!s.layers[id]) return s; // guard: never create a layer implicitly
        return {
          layers: {
            ...s.layers,
            [id]: {
              ...s.layers[id],
              ...config,
              bounds: config.tileBounds ?? s.layers[id].bounds ?? null,
            },
          },
        };
      }),

    setLayerRenderingConfig: (id, config) =>
      set((s) => {
        if (!s.layers[id]) return s; // guard: never create a layer implicitly
        return {
          layers: {
            ...s.layers,
            [id]: { ...s.layers[id], renderingConfig: config },
          },
        };
      }),

    setLayerParentDatasetId: (id, parentDatasetId) =>
      set((s) => ({
        layers: {
          ...s.layers,
          [id]: { ...s.layers[id], parentDatasetId },
        },
      })),

    setLayerBandSelection: (id, bands, preset) =>
      set((s) => ({
        layers: {
          ...s.layers,
          [id]: {
            ...s.layers[id],
            bandSelection: bands,
            activePreset: preset ?? null,
          },
        },
      })),

    getLayer: (id) => get().layers[id],

    applyReorder: (newOrder) =>
      set((s) => {
        const layers = { ...s.layers };
        for (const [id, zIndex] of Object.entries(newOrder)) {
          if (layers[id]) layers[id] = { ...layers[id], zIndex };
        }
        return { layers };
      }),

    moveLayer: (id, direction) => {
      const state = get();
      const layer = state.layers[id];
      if (!layer) return null;
      const targetZ = direction === 'up' ? layer.zIndex + 1 : layer.zIndex - 1;
      if (targetZ < 0) return null;
      const swapEntry = Object.entries(state.layers).find(([, l]) => l.zIndex === targetZ);
      const newOrder: Record<string, number> = { [id]: targetZ };
      let swapId = id;
      if (swapEntry) {
        const [otherId] = swapEntry;
        newOrder[otherId] = layer.zIndex;
        swapId = otherId;
      }
      set((s) => {
        const layers = { ...s.layers };
        for (const [lid, zIndex] of Object.entries(newOrder)) {
          if (layers[lid]) layers[lid] = { ...layers[lid], zIndex };
        }
        return { layers };
      });
      return [id, swapId];
    },

    openDatasetPanel: (datasetId) =>
      set({ rightPanelMode: 'dataset', selectedDatasetId: datasetId, selectedFeature: null, selectedLayerId: null }),
    openItemsPanel: (datasetId) =>
      set({ rightPanelMode: 'items', selectedItemsDatasetId: datasetId, selectedFeature: null, selectedLayerId: null }),
    openAnnotationSetPanel: (annotationSetId) =>
      set({ rightPanelMode: 'annotation-set', selectedAnnotationSetId: annotationSetId, selectedFeature: null, selectedLayerId: null }),
    openAnnotationPanel: () =>
      set({
        rightPanelMode: 'new-annotation',
        selectedFeature: null,
        selectedLayerId: null,
        pendingAnnotation: {
          label: '',
          description: '',
          style: { ...DEFAULT_STYLES.annotation },
          attributes: [],
        },
      }),
    setPendingAnnotationField: (patch) =>
      set((s) => s.pendingAnnotation ? { pendingAnnotation: { ...s.pendingAnnotation, ...patch } } : s),
    setPendingAnnotationStyle: (patch) =>
      set((s) => s.pendingAnnotation ? { pendingAnnotation: { ...s.pendingAnnotation, style: { ...s.pendingAnnotation.style, ...patch } } } : s),
    addPendingAnnotationAttribute: () =>
      set((s) => s.pendingAnnotation ? { pendingAnnotation: { ...s.pendingAnnotation, attributes: [...s.pendingAnnotation.attributes, { key: '', value: '' }] } } : s),
    updatePendingAnnotationAttribute: (idx, key, value) =>
      set((s) => {
        if (!s.pendingAnnotation) return s;
        const attrs = [...s.pendingAnnotation.attributes];
        attrs[idx] = { key, value };
        return { pendingAnnotation: { ...s.pendingAnnotation, attributes: attrs } };
      }),
    removePendingAnnotationAttribute: (idx) =>
      set((s) => s.pendingAnnotation ? { pendingAnnotation: { ...s.pendingAnnotation, attributes: s.pendingAnnotation.attributes.filter((_, i) => i !== idx) } } : s),
    clearPendingAnnotation: () => set({ pendingAnnotation: null, rightPanelMode: 'none' }),

    openFeaturePanel: (feature) => set({ rightPanelMode: 'feature', selectedFeature: feature, selectedLayerId: feature.layerId ?? null }),
    openStylePanel: (layerId) => set({ rightPanelMode: 'style', selectedLayerId: layerId, selectedFeature: null }),
    openMeasurementPanel: () => set({ rightPanelMode: 'measurement', selectedFeature: null, selectedLayerId: null }),
    showAnnotationPanel: () => set((s) => s.pendingAnnotation ? { rightPanelMode: 'new-annotation' } : s),
    closeRightPanel: () => set({ rightPanelMode: 'none', selectedLayerId: null, selectedFeature: null, selectedDatasetId: null, selectedItemsDatasetId: null, selectedAnnotationSetId: null }),
    layerOnMapClick: (layerId) => set({ selectedLayerId: layerId, rightPanelMode: 'style', selectedFeature: null }),
    toggleMeasurement: () =>
      set((s) => {
        const newActive = !s.measurementActive;
        return {
          measurementActive: newActive,
          measurementPoints: [],
          rightPanelMode: newActive ? 'measurement' : s.rightPanelMode === 'measurement' ? 'none' : s.rightPanelMode,
        };
      }),
    addMeasurementPoint: (pt) => set((s) => ({ measurementPoints: [...s.measurementPoints, pt] })),
    clearMeasurement: () => set((s) => ({ measurementPoints: [], measurementActive: false, rightPanelMode: s.rightPanelMode === 'measurement' ? 'none' : s.rightPanelMode })),
    clearMeasurementPoints: () => set({ measurementPoints: [] }),

    openTimeline: (datasetId) => {
      const layer = get().layers[datasetId];
      const originalUrl = layer?.tileUrl ?? null;
      set({
        aoiTimelineEnabled: false,
        aoiTimelineAoiId: null,
        aoiTimelinePlaying: false,
        timelineEnabled: true,
        timelineDatasetId: datasetId,
        timelineItems: [],
        timelineIndex: 0,
        timelinePlaying: false,
        timelineRange: null,
        timelineOriginalTileUrl: originalUrl,
      });
    },
    closeTimeline: () => set({ timelineEnabled: false, timelineDatasetId: null, timelineItems: [], timelineIndex: 0, timelinePlaying: false, timelineRange: null }),
    setTimelineItems: (items) => set({ timelineItems: items }),
    setTimelineIndex: (index) => set({ timelineIndex: index, timelinePlaying: false }),
    stepTimeline: (direction) =>
      set((s) => {
        if (s.timelineItems.length === 0) return s;
        const filtered = s.timelineRange
          ? s.timelineItems.filter((item) => {
              if (!item.datetime) return true;
              const d = new Date(item.datetime).getTime();
              const [from, to] = s.timelineRange!;
              if (from && d < new Date(from).getTime()) return false;
              if (to && d > new Date(to + 'T23:59:59').getTime()) return false;
              return true;
            })
          : s.timelineItems;
        if (filtered.length === 0) return s;
        const currentItem = s.timelineItems[s.timelineIndex];
        let filteredIdx = filtered.findIndex((it) => it.id === currentItem?.id);
        if (filteredIdx === -1) filteredIdx = 0;
        let nextFilteredIdx: number;
        if (direction === 'next') nextFilteredIdx = (filteredIdx + 1) % filtered.length;
        else nextFilteredIdx = (filteredIdx - 1 + filtered.length) % filtered.length;
        const nextItem = filtered[nextFilteredIdx];
        const newIndex = s.timelineItems.findIndex((it) => it.id === nextItem.id);
        return { timelineIndex: newIndex >= 0 ? newIndex : 0 };
      }),
    toggleTimelinePlay: () => set((s) => ({ timelinePlaying: !s.timelinePlaying })),
    setTimelineSpeed: (ms) => set({ timelineSpeed: ms }),
    setTimelineRange: (range) => set({ timelineRange: range }),
  }))
);