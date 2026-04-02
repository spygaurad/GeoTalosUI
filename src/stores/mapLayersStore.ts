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
} from '@/features/maps/types';
import type { RenderingConfig } from '@/types/api';
import type { DatasetItem } from '@/types/api';

// ── Feature-click tracking (module-level) ──────────────────────────────────────
// Used by map click handler to distinguish empty-map clicks from feature clicks.
let _featureClickTime = 0;
export function markFeatureClick() { _featureClickTime = Date.now(); }
export function wasFeatureJustClicked() { return Date.now() - _featureClickTime < 100; }
import {
  DEFAULT_ANNOTATION_STYLE,
  DEFAULT_DATASET_STYLE,
  DEFAULT_TRACKING_STYLE,
  DEFAULT_ALERT_STYLE,
  DEFAULT_TILE_SERVICE_STYLE,
} from '@/features/maps/types';

const DEFAULT_STYLES: Record<LayerType, LayerStyle> = {
  annotation: DEFAULT_ANNOTATION_STYLE,
  dataset: DEFAULT_DATASET_STYLE,
  tracking: DEFAULT_TRACKING_STYLE,
  alert: DEFAULT_ALERT_STYLE,
};

/** Next z_index — incremented each time a layer is added. */
let _nextZIndex = 0;

interface MapLayersState {
  layers: Record<string, LayerConfig>; // keyed by id
  rightPanelMode: RightPanelMode;
  selectedLayerId: string | null;
  selectedFeature: SelectedFeature | null;
  measurementActive: boolean;
  measurementPoints: [number, number][];
  currentZoom: number;
  focusedLayerId: string | null;

  /** Set by focusLayer, consumed by useMapSync → MapManager.fitBounds */
  zoomToBounds: [number, number, number, number] | null;
  clearZoomToBounds: () => void;
  /** Select + zoom + open panel for a layer */
  focusLayer: (layerId: string) => void;
  setCurrentZoom: (zoom: number) => void;

  // pending annotation (drawn but not yet saved)
  pendingAnnotation: PendingAnnotation | null;
  openAnnotationPanel: () => void;
  setPendingAnnotationField: (patch: Partial<Omit<PendingAnnotation, 'attributes' | 'style'>>) => void;
  setPendingAnnotationStyle: (patch: Partial<LayerStyle>) => void;
  addPendingAnnotationAttribute: () => void;
  updatePendingAnnotationAttribute: (idx: number, key: string, value: string) => void;
  removePendingAnnotationAttribute: (idx: number) => void;
  clearPendingAnnotation: () => void;

  // Maps dataset id → backend map layer id (for PATCH/DELETE persistence)
  backendLayerIds: Record<string, string>;
  setBackendLayerId: (datasetId: string, layerId: string) => void;

  // Auto-save dirty tracking — true when opacity/style changed since last flush
  autoSaveDirty: boolean;
  markAutoSaveDirty: () => void;
  clearAutoSaveDirty: () => void;

  // layer config actions
  initLayer: (id: string, type: LayerType, opts?: {
    name?: string;
    sourceType?: LayerSourceType;
    zIndex?: number;
    tileServiceUrl?: string;
    parentDatasetId?: string;
    stacItemId?: string;
    annotationSetId?: string;
    classStyles?: Record<string, { fillColor: string; strokeColor: string; strokeWidth: number; fillOpacity: number }>;
  }) => void;
  removeLayer: (id: string) => void;
  setLayerVisible: (id: string, visible: boolean) => void;
  setLayerOpacity: (id: string, opacity: number) => void;
  setLayerStyle: (id: string, patch: Partial<LayerStyle>) => void;
  setLayerTileConfig: (
    id: string,
    config: { tileUrl: string; tileBounds?: [number, number, number, number]; tileMinZoom?: number; tileMaxZoom?: number }
  ) => void;
  setLayerRenderingConfig: (id: string, config: RenderingConfig) => void;
  setLayerParentDatasetId: (id: string, parentDatasetId: string) => void;
  setLayerBandSelection: (id: string, bands: BandSelection | null, preset?: string | null) => void;
  getLayer: (id: string) => LayerConfig | undefined;

  /** Set z_index values after a reorder operation. Keyed by layer id → new z_index. */
  applyReorder: (newOrder: Record<string, number>) => void;
  /** Move a layer up (+1) or down (-1) in z_index. Returns the two swapped layer IDs. */
  moveLayer: (id: string, direction: 'up' | 'down') => [string, string] | null;

  // dataset panel
  selectedDatasetId: string | null;
  openDatasetPanel: (datasetId: string) => void;

  // items panel (browse STAC items within a dataset)
  selectedItemsDatasetId: string | null;
  openItemsPanel: (datasetId: string) => void;

  // annotation set panel
  selectedAnnotationSetId: string | null;
  openAnnotationSetPanel: (annotationSetId: string) => void;

  // right panel
  openFeaturePanel: (feature: SelectedFeature) => void;
  openStylePanel: (layerId: string) => void;
  openMeasurementPanel: () => void;
  showAnnotationPanel: () => void; // re-show panel without resetting pendingAnnotation
  closeRightPanel: () => void;

  /** Select layer + open appropriate right panel when clicking on a layer in the map (no zoom) */
  layerOnMapClick: (layerId: string) => void;

  /** Reset all layer state — must be called when switching between maps. */
  resetForMap: () => void;

  // Signal MapEditorShell to re-fetch features for a specific annotation set
  refreshAnnotationSetId: string | null;
  requestAnnotationSetRefresh: (setId: string) => void;
  clearAnnotationSetRefresh: () => void;

  // measurement
  toggleMeasurement: () => void;
  addMeasurementPoint: (pt: [number, number]) => void;
  clearMeasurement: () => void;
  clearMeasurementPoints: () => void; // clear points but keep measuring active

  // ── Timeline / temporal playback ─────────────────────────────────────────────
  timelineEnabled: boolean;
  timelineDatasetId: string | null;
  timelineItems: DatasetItem[];
  timelineIndex: number;
  timelinePlaying: boolean;
  timelineSpeed: number; // ms between frames (default 2000)
  timelineRange: [string, string] | null; // [from, to] ISO date filter
  /** Stashed collection tile URL — restored when timeline closes */
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
    refreshAnnotationSetId: null,
    timelineEnabled: false,
    timelineDatasetId: null,
    timelineItems: [],
    timelineIndex: 0,
    timelinePlaying: false,
    timelineSpeed: 2000,
    timelineRange: null,
    timelineOriginalTileUrl: null,
    resetForMap: () => {
      _nextZIndex = 0;
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
        refreshAnnotationSetId: null,
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

    clearZoomToBounds: () => set({ zoomToBounds: null }),

    setCurrentZoom: (zoom: number) => set({ currentZoom: zoom }),

    focusLayer: (layerId) => {
      const layer = get().layers[layerId];
      if (!layer) return;
      const updates: Partial<MapLayersState> = {
        selectedLayerId: layerId,
        focusedLayerId: layerId, // Trigger map focus + pointer highlight
      };

      if (layer.bounds) {
        updates.zoomToBounds = layer.bounds;
      }

      // Auto-open appropriate right panel
      if (layer.sourceType === 'annotation_set' && layer.annotationSetId) {
        Object.assign(updates, {
          rightPanelMode: 'annotation-set' as const,
          selectedAnnotationSetId: layer.annotationSetId,
          selectedFeature: null,
        });
      } else if (layer.sourceType === 'dataset') {
        // Dataset = collection → show collection metadata panel
        Object.assign(updates, {
          rightPanelMode: 'dataset' as const,
          selectedDatasetId: layerId,
          selectedFeature: null,
        });
      } else {
        // stac_item, tile_service, etc. → style panel (has band selector for raster items)
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
          // Merge missing fields into existing layer (e.g. parentDatasetId from left panel)
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
        const zIndex = opts?.zIndex ?? _nextZIndex++;
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
            },
          },
        };
      }),

    removeLayer: (id) =>
      set((s) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [id]: _removedLayer, ...layers } = s.layers;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [id]: _removedBackend, ...backendLayerIds } = s.backendLayerIds;
        return { layers, backendLayerIds };
      }),

    setLayerVisible: (id, visible) =>
      set((s) => ({
        layers: { ...s.layers, [id]: { ...s.layers[id], visible } },
      })),

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

    setLayerTileConfig: (id, config) =>
      set((s) => ({
        layers: {
          ...s.layers,
          [id]: {
            ...s.layers[id],
            ...config,
            // Auto-populate bounds from tileBounds for zoom-to-layer
            bounds: config.tileBounds ?? s.layers[id]?.bounds ?? null,
          },
        },
      })),

    setLayerRenderingConfig: (id, config) =>
      set((s) => ({
        layers: {
          ...s.layers,
          [id]: { ...s.layers[id], renderingConfig: config },
        },
      })),

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
          if (layers[id]) {
            layers[id] = { ...layers[id], zIndex };
          }
        }
        return { layers };
      }),

    moveLayer: (id, direction) => {
      const state = get();
      const layer = state.layers[id];
      if (!layer) return null;

      const targetZ = direction === 'up' ? layer.zIndex + 1 : layer.zIndex - 1;
      if (targetZ < 0) return null;

      // Find the layer currently at the target z_index
      const swapEntry = Object.entries(state.layers).find(
        ([, l]) => l.zIndex === targetZ
      );

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
          if (layers[lid]) {
            layers[lid] = { ...layers[lid], zIndex };
          }
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
      set((s) =>
        s.pendingAnnotation
          ? { pendingAnnotation: { ...s.pendingAnnotation, ...patch } }
          : s
      ),

    setPendingAnnotationStyle: (patch) =>
      set((s) =>
        s.pendingAnnotation
          ? {
              pendingAnnotation: {
                ...s.pendingAnnotation,
                style: { ...s.pendingAnnotation.style, ...patch },
              },
            }
          : s
      ),

    addPendingAnnotationAttribute: () =>
      set((s) =>
        s.pendingAnnotation
          ? {
              pendingAnnotation: {
                ...s.pendingAnnotation,
                attributes: [...s.pendingAnnotation.attributes, { key: '', value: '' }],
              },
            }
          : s
      ),

    updatePendingAnnotationAttribute: (idx, key, value) =>
      set((s) => {
        if (!s.pendingAnnotation) return s;
        const attrs = [...s.pendingAnnotation.attributes];
        attrs[idx] = { key, value };
        return { pendingAnnotation: { ...s.pendingAnnotation, attributes: attrs } };
      }),

    removePendingAnnotationAttribute: (idx) =>
      set((s) => {
        if (!s.pendingAnnotation) return s;
        return {
          pendingAnnotation: {
            ...s.pendingAnnotation,
            attributes: s.pendingAnnotation.attributes.filter((_, i) => i !== idx),
          },
        };
      }),

    clearPendingAnnotation: () =>
      set({ pendingAnnotation: null, rightPanelMode: 'none' }),

    openFeaturePanel: (feature) =>
      set({
        rightPanelMode: 'feature',
        selectedFeature: feature,
        selectedLayerId: feature.layerId ?? null,
      }),

    openStylePanel: (layerId) =>
      set({ rightPanelMode: 'style', selectedLayerId: layerId, selectedFeature: null }),

    openMeasurementPanel: () =>
      set({ rightPanelMode: 'measurement', selectedFeature: null, selectedLayerId: null }),

    showAnnotationPanel: () =>
      set((s) => s.pendingAnnotation ? { rightPanelMode: 'new-annotation' } : s),

    closeRightPanel: () =>
      set({ rightPanelMode: 'none', selectedLayerId: null, selectedFeature: null, selectedDatasetId: null, selectedItemsDatasetId: null, selectedAnnotationSetId: null }),

    layerOnMapClick: (layerId) => {
      const layer = get().layers[layerId];
      if (!layer) return;
      // Always show style panel when clicking on a layer on the map
      set({
        selectedLayerId: layerId,
        rightPanelMode: 'style',
        selectedFeature: null,
      });
    },

    toggleMeasurement: () =>
      set((s) => {
        const newActive = !s.measurementActive;
        return {
          measurementActive: newActive,
          measurementPoints: [],
          // Automatically open/close measurement panel
          rightPanelMode: newActive
            ? 'measurement'
            : s.rightPanelMode === 'measurement' ? 'none' : s.rightPanelMode,
        };
      }),

    addMeasurementPoint: (pt) =>
      set((s) => ({ measurementPoints: [...s.measurementPoints, pt] })),

    clearMeasurement: () =>
      set((s) => ({
        measurementPoints: [],
        measurementActive: false,
        rightPanelMode: s.rightPanelMode === 'measurement' ? 'none' : s.rightPanelMode,
      })),

    clearMeasurementPoints: () => set({ measurementPoints: [] }),

    // ── Timeline / temporal playback ──────────────────────────────────────────

    openTimeline: (datasetId) => {
      const layer = get().layers[datasetId];
      // Stash the current collection tile URL so we can restore it on close
      const originalUrl = layer?.tileUrl ?? null;
      set({
        timelineEnabled: true,
        timelineDatasetId: datasetId,
        timelineItems: [],
        timelineIndex: 0,
        timelinePlaying: false,
        timelineRange: null,
        timelineOriginalTileUrl: originalUrl,
      });
    },

    closeTimeline: () =>
      set({
        timelineEnabled: false,
        timelineDatasetId: null,
        timelineItems: [],
        timelineIndex: 0,
        timelinePlaying: false,
        timelineRange: null,
        // timelineOriginalTileUrl cleared after restore in useMapSync
      }),

    setTimelineItems: (items) => set({ timelineItems: items }),

    setTimelineIndex: (index) => set({ timelineIndex: index, timelinePlaying: false }),

    stepTimeline: (direction) =>
      set((s) => {
        if (s.timelineItems.length === 0) return s;

        // Filter items by date range if set
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

        // Map current index back to filtered list position
        const currentItem = s.timelineItems[s.timelineIndex];
        let filteredIdx = filtered.findIndex((it) => it.id === currentItem?.id);
        if (filteredIdx === -1) filteredIdx = 0;

        let nextFilteredIdx: number;
        if (direction === 'next') {
          nextFilteredIdx = (filteredIdx + 1) % filtered.length;
        } else {
          nextFilteredIdx = (filteredIdx - 1 + filtered.length) % filtered.length;
        }

        // Map back to original items array index
        const nextItem = filtered[nextFilteredIdx];
        const newIndex = s.timelineItems.findIndex((it) => it.id === nextItem.id);

        return { timelineIndex: newIndex >= 0 ? newIndex : 0 };
      }),

    toggleTimelinePlay: () =>
      set((s) => ({ timelinePlaying: !s.timelinePlaying })),

    setTimelineSpeed: (ms) => set({ timelineSpeed: ms }),

    setTimelineRange: (range) => set({ timelineRange: range }),
  }))
);
