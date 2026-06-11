/**
 * AOI (Area of Interest) Slice
 *
 * Manages AOI draw mode, AOI layer creation, AOI-bounded dataset layers
 * (with async STAC item fetching and tile config), and AOI multi-dataset
 * temporal timeline state.
 */

import type { AoiTimelineFrame } from '@/features/maps/types';
import {
  DEFAULT_AOI_STYLE,
  DEFAULT_DATASET_STYLE,
} from '@/features/maps/types';
import type { GeoJSONGeometry } from '@/types/geo';
import { buildTileUrlFromConfig } from '@/features/maps/utils/datasetItemLayer';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createAoiSlice(set: any, get: any) {
  return {
    // ── State ──────────────────────────────────────────────────────────────
    aoiDrawMode: false,
    selectedAoiLayerId: null as string | null,
    aoiSelectedDatasetIds: [] as string[],

    // AOI timeline
    aoiTimelineEnabled: false,
    aoiTimelineAoiId: null as string | null,
    aoiTimelineDatasetIds: [] as string[],
    aoiTimelineCollectionMap: {} as Record<string, string>,
    aoiTimelineFrames: [] as AoiTimelineFrame[],
    aoiTimelineIndex: 0,
    aoiTimelinePlaying: false,
    aoiTimelineSpeed: 2000,
    aoiTimelineRange: null as [string, string] | null,
    // Annotation-set ids of the model series selected to overlay during
    // playback. When non-empty, the per-frame visibility effect restricts the
    // overlay to exactly these sets (the chosen temporal collection); when
    // empty it falls back to toggling all AOI-dataset sets by frame.
    aoiTimelineAnnotationSetIds: [] as string[],
    // Raster render mode for playback frames. 'ndvi' replaces the RGB band
    // params with a TiTiler expression computed from the chosen NIR/Red bands.
    aoiTimelineRenderMode: 'rgb' as 'rgb' | 'ndvi',
    aoiTimelineNdviBands: null as { nir: number; red: number } | null,
    // When false, annotation sets are hidden during playback (raster only).
    aoiTimelineShowAnnotations: true,

    // ── AOI draw mode ──────────────────────────────────────────────────────
    setAoiDrawMode: (active: boolean) => set({ aoiDrawMode: active }),

    // ── AOI layer creation ─────────────────────────────────────────────────
    createAoiLayer: (geometry: GeoJSONGeometry, bbox: [number, number, number, number]): string => {
      const state = get();
      const aoiCount = Object.values(state.layers).filter((l: any) => l.type === 'aoi').length;
      const id = `aoi-${Date.now()}`;
      const name = `AOI ${aoiCount + 1}`;
      const zIndex = Date.now() % 100000;

      set((s: any) => ({
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

    // ── AOI panel ──────────────────────────────────────────────────────────
    openAoiPanel: (aoiLayerId: string) =>
      set({
        rightPanelMode: 'aoi' as const,
        selectedAoiLayerId: aoiLayerId,
        selectedLayerId: aoiLayerId,
        selectedFeature: null,
      }),

    toggleAoiDataset: (datasetId: string) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      set((s: any) => {
        const ids = s.aoiSelectedDatasetIds;
        return {
          aoiSelectedDatasetIds: ids.includes(datasetId)
            ? ids.filter((id: string) => id !== datasetId)
            : [...ids, datasetId],
        };
      }),

    setAoiSelectedDatasets: (ids: string[]) =>
      set({ aoiSelectedDatasetIds: ids }),

    // ── AOI bounded child layer ────────────────────────────────────────────
    addAoiBoundedDataset: (
      aoiLayerId: string,
      dataset: { id: string; name: string; stac_collection_id?: string },
      bbox: [number, number, number, number],
    ): string => {
      const state = get();
      const parentAoi = state.layers[aoiLayerId];
      if (!parentAoi) return '';

      const childId = `${aoiLayerId}-ds-${dataset.id}`;
      if (state.layers[childId]) return childId;

      const zIndex = Date.now() % 100000;

      set((s: any) => ({
        layers: {
          ...s.layers,
          [childId]: {
            id: childId,
            name: `${dataset.name} (in ${parentAoi.name})`,
            type: 'dataset' as const,
            sourceType: 'dataset' as const,
            visible: true,
            opacity: 1,
            style: { ...DEFAULT_DATASET_STYLE },
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
        set((s: any) =>
          s.layers[childId]
            ? { layers: { ...s.layers, [childId]: { ...s.layers[childId], loading: false } } }
            : s,
        );
        return childId;
      }

      // Async: fetch STAC items and tile config for the first item
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
            set((s: any) =>
              s.layers[childId]
                ? { layers: { ...s.layers, [childId]: { ...s.layers[childId], loading: false } } }
                : s,
            );
            return;
          }

          // Populate AOI timeline frames
          const timelineItems = features
            .map((feature: any) => {
              const dt =
                feature.properties?.datetime ||
                feature.properties?.start_datetime ||
                feature.properties?.created ||
                feature.properties?.acquired;
              if (!dt || typeof dt !== 'string') return null;
              return {
                datetime: dt as string,
                itemId: feature.id as string,
                stacItemId: feature.id as string,
              };
            })
            .filter((item: any): item is { datetime: string; itemId: string; stacItemId: string } => item !== null);

          // Cross-slice call: addAoiTimelineItems lives on the same composed store
          get().addAoiTimelineItems(aoiLayerId, dataset.id, timelineItems, collectionId);

          const firstStacItemId = features[0].id;
          console.log(`[AOI] Fetching tile config for item ${firstStacItemId} in dataset ${dataset.id}`);
          const cfg = await datasetsApi.getItemTileConfigByStacId(dataset.id, firstStacItemId);

          if (!cfg.tile_url_template) {
            console.warn(`[AOI] No tile URL for ${firstStacItemId}`);
            set((s: any) =>
              s.layers[childId]
                ? { layers: { ...s.layers, [childId]: { ...s.layers[childId], loading: false } } }
                : s,
            );
            return;
          }

          // Build tile URL with preset or bands, then append bbox for AOI spatial clip
          const { tileUrl: rawTileUrl, activePreset, bandSelection } = buildTileUrlFromConfig(cfg);
          const [tilePath, existingQs] = rawTileUrl.split('?');
          const tileParams = new URLSearchParams(existingQs ?? '');
          tileParams.set('bbox', bboxStr);
          const tileUrl = `${tilePath}?${tileParams.toString()}`;

          console.log(`[AOI] Final tile URL: ${tileUrl}`);

          // Cross-slice calls via composed store
          get().setLayerTileConfig(childId, { tileUrl, tileBounds: bbox });

          if (cfg.rendering_config) {
            get().setLayerRenderingConfig(childId, cfg.rendering_config);
          }

          if (bandSelection) {
            get().setLayerBandSelection(childId, bandSelection, activePreset ?? null);
          }

          set((s: any) =>
            s.layers[childId]
              ? { layers: { ...s.layers, [childId]: { ...s.layers[childId], loading: false } } }
              : s,
          );
        } catch (err) {
          console.error(`[AOI] Failed to load tiles for ${dataset.name}:`, err);
          set((s: any) =>
            s.layers[childId]
              ? { layers: { ...s.layers, [childId]: { ...s.layers[childId], loading: false, error: true } } }
              : s,
          );
        }
      });

      return childId;
    },

    removeAoiBoundedDataset: (layerId: string) => {
      set((s: any) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [layerId]: removed, ...rest } = s.layers;
        return { layers: rest };
      });
    },

    // ── AOI timeline item management ───────────────────────────────────────
    addAoiTimelineItems: (
      aoiId: string,
      datasetId: string,
      items: Array<{ datetime: string; itemId: string; stacItemId: string }>,
      collectionId?: string,
    ) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      set((state: any) => {
        const isActive = state.aoiTimelineAoiId === aoiId;
        const prevDatasetIds = isActive ? [...state.aoiTimelineDatasetIds] : [];
        const prevFrames: AoiTimelineFrame[] = isActive ? [...state.aoiTimelineFrames] : [];

        // Build updated collection map
        const collectionMap = isActive ? { ...state.aoiTimelineCollectionMap } : {};
        if (collectionId) collectionMap[datasetId] = collectionId;

        // Build flat item list with stacItemId for all existing + new items
        type RawItem = { datetime: string; datasetId: string; itemId: string; stacItemId: string };
        const existingItems: RawItem[] = prevFrames.flatMap((f: AoiTimelineFrame) =>
          f.items.map((i) => ({ datetime: f.datetime, datasetId: i.datasetId, itemId: i.itemId, stacItemId: i.stacItemId })),
        );
        const newItems: RawItem[] = items.map((item) => ({
          datetime: item.datetime,
          datasetId,
          itemId: item.itemId,
          stacItemId: item.stacItemId,
        }));

        // Merge and group by datetime
        const combined = [...existingItems.filter((i) => i.datasetId !== datasetId), ...newItems];
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
            items: frameItems.map((i) => ({ datasetId: i.datasetId, itemId: i.itemId, stacItemId: i.stacItemId })),
            stacItemIds: frameItems.map((i) => i.stacItemId),
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

    removeAoiTimelineItems: (aoiId: string, datasetId: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      set((state: any) => {
        if (state.aoiTimelineAoiId !== aoiId) return state;
        const newDatasetIds = state.aoiTimelineDatasetIds.filter((id: string) => id !== datasetId);
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
          .map((frame: AoiTimelineFrame) => {
            const items = frame.items.filter((item: any) => item.datasetId !== datasetId);
            return { ...frame, items, stacItemIds: items.map((i: any) => i.stacItemId) };
          })
          .filter((frame: AoiTimelineFrame) => frame.items.length > 0);
        return {
          aoiTimelineDatasetIds: newDatasetIds,
          aoiTimelineCollectionMap: newCollectionMap,
          aoiTimelineFrames: newFrames,
        };
      });
    },

    clearAoiTimeline: (aoiId: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      set((state: any) => {
        if (state.aoiTimelineAoiId !== aoiId) return state;
        return {
          aoiTimelineEnabled: false,
          aoiTimelineAoiId: null,
          aoiTimelineDatasetIds: [],
          aoiTimelineFrames: [],
        };
      });
    },

    // ── AOI timeline transport ─────────────────────────────────────────────
    openAoiTimeline: (
      aoiId: string,
      datasetIds: string[],
      collectionMap: Record<string, string>,
      opts?: { renderMode?: 'rgb' | 'ndvi'; ndviBands?: { nir: number; red: number } | null },
    ) =>
      set({
        // Close single-dataset timeline
        timelineEnabled: false,
        timelineDatasetId: null,
        timelinePlaying: false,
        // Open AOI timeline
        aoiTimelineEnabled: true,
        aoiTimelineAoiId: aoiId,
        aoiTimelineDatasetIds: datasetIds,
        aoiTimelineCollectionMap: collectionMap,
        aoiTimelineFrames: [],
        aoiTimelineIndex: 0,
        aoiTimelinePlaying: false,
        aoiTimelineRange: null,
        aoiTimelineAnnotationSetIds: [],
        aoiTimelineRenderMode: opts?.renderMode ?? 'rgb',
        aoiTimelineNdviBands: opts?.ndviBands ?? null,
      }),

    closeAoiTimeline: () =>
      set({
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
        aoiTimelineNdviBands: null,
      }),

    setAoiTimelineFrames: (frames: AoiTimelineFrame[]) =>
      set({ aoiTimelineFrames: frames, aoiTimelineIndex: 0 }),

    setAoiTimelineIndex: (index: number) =>
      set({ aoiTimelineIndex: index }),

    stepAoiTimeline: (direction: 'next' | 'prev') => {
      const { aoiTimelineFrames: frames, aoiTimelineIndex: idx, aoiTimelineRange: range } = get();
      if (frames.length < 2) return;

      const validIndices = range
        ? frames
            .map((f: AoiTimelineFrame, i: number) => ({ f, i }))
            .filter(({ f }: { f: AoiTimelineFrame }) => {
              const d = new Date(f.datetime).getTime();
              const [from, to] = range;
              if (from && d < new Date(from).getTime()) return false;
              if (to && d > new Date(to + 'T23:59:59').getTime()) return false;
              return true;
            })
            .map(({ i }: { i: number }) => i)
        : frames.map((_: AoiTimelineFrame, i: number) => i);

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

    toggleAoiTimelinePlay: () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      set((s: any) => ({ aoiTimelinePlaying: !s.aoiTimelinePlaying })),

    setAoiTimelineSpeed: (ms: number) =>
      set({ aoiTimelineSpeed: ms }),

    setAoiTimelineRange: (range: [string, string] | null) =>
      set({ aoiTimelineRange: range }),

    setAoiTimelineAnnotationSetIds: (ids: string[]) =>
      set({ aoiTimelineAnnotationSetIds: ids }),

    setAoiTimelineRenderMode: (mode: 'rgb' | 'ndvi') =>
      set({ aoiTimelineRenderMode: mode }),

    setAoiTimelineNdviBands: (bands: { nir: number; red: number } | null) =>
      set({ aoiTimelineNdviBands: bands }),

    setAoiTimelineShowAnnotations: (show: boolean) =>
      set({ aoiTimelineShowAnnotations: show }),
  };
}
