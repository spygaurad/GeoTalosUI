/**
 * AOI module sync hook.
 *
 * Owns reactive side-effects for AOI multi-dataset temporal playback:
 * - Swapping tile layers when AOI timeline frame index changes
 * - Double-buffer preloading for immediate next-frame commits
 * - Prefetching all frame tile configs when frames first populate
 * - Restoring collection mosaics when AOI timeline closes
 * - Managing annotation-set visibility based on per-frame STAC item bindings
 *
 * Called by core/useMapSync as part of the composed sync pipeline.
 * Logic migrated from hooks/useMapSync.ts (AOI timeline useEffect blocks).
 */
'use client';

import { useEffect, useRef } from 'react';
import { useMapLayersStore } from '@/stores/mapLayersStore';
import { datasetsApi } from '@/lib/api/datasets';
import { getMapManager } from '@/features/maps/MapManager';
import {
  getIndexDef,
  buildThresholdColormap,
  type IndexRole,
} from '@/features/maps/modules/timeline/indices';

const AOI_PREFETCH = 3;

/**
 * Apply rendering config + bbox clip to a tile URL for an AOI child layer.
 * Mirrors the logic in addAoiBoundedDataset so every frame renders consistently.
 */
function applyAoiChildRendering(baseUrl: string, childLayerId: string): string {
  const store = useMapLayersStore.getState();
  const layer = store.layers[childLayerId];
  if (!layer) return baseUrl;

  let tileUrl = baseUrl;

  // ── Spectral index render mode ────────────────────────────────────────────
  // Replace the RGB band params with a TiTiler expression for the selected
  // index (NDVI, NDMI, NDWI, …). The data is a single multi-band `data` asset,
  // so bands are referenced as `data_b{N}` (1-based) with an explicit
  // `assets=data` — NOT `asset_as_band` (that requires single-band assets and
  // 400s here). `assets` must be set explicitly: the tile proxy only auto-adds
  // it when no `expression` is present. Verified against titiler on a 6-band item.
  //
  // A lower-bound threshold (held in the store, so it persists across every
  // frame) is rendered as an interval `colormap` JSON whose below-threshold
  // segment is transparent — revealing the basemap for "show only X above T".
  const indexDef =
    store.aoiTimelineRenderMode === 'index' ? getIndexDef(store.aoiTimelineIndexId) : null;
  const indexBands = store.aoiTimelineIndexBands as Record<IndexRole, number>;
  const rolesResolved =
    indexDef != null && indexDef.roles.every((r) => indexBands[r] != null);

  if (indexDef && rolesResolved) {
    const params = new URLSearchParams();
    params.set('assets', 'data');
    params.set('expression', indexDef.expr(indexBands));
    const threshold = store.aoiTimelineThreshold;
    if (threshold != null) {
      params.set('colormap', buildThresholdColormap(indexDef, threshold));
    } else {
      params.set('rescale', indexDef.domain.join(','));
      params.set('colormap_name', indexDef.colormap);
    }
    if (layer.clipBounds) params.set('bbox', layer.clipBounds.join(','));
    return `${baseUrl.split('?')[0]}?${params.toString()}`;
  }

  if (layer.bandSelection) {
    const params = new URLSearchParams();
    const bands = layer.bandSelection;
    params.set('asset_bidx', `data|${bands.r},${bands.g},${bands.b}`);
    if (layer.renderingConfig?.bands) {
      const rBand = layer.renderingConfig.bands.find((b) => b.index === bands.r);
      const gBand = layer.renderingConfig.bands.find((b) => b.index === bands.g);
      const bBand = layer.renderingConfig.bands.find((b) => b.index === bands.b);
      if (rBand && gBand && bBand) {
        // TiTiler expects one `rescale=` param per band — use `append` so
        // URLSearchParams emits three separate query pairs rather than
        // url-encoding a single concatenated string.
        params.append('rescale', `${rBand.stats.p2},${rBand.stats.p98}`);
        params.append('rescale', `${gBand.stats.p2},${gBand.stats.p98}`);
        params.append('rescale', `${bBand.stats.p2},${bBand.stats.p98}`);
      }
    }
    tileUrl = `${baseUrl.split('?')[0]}?${params.toString()}`;
  } else if (layer.activePreset && layer.renderingConfig?.presets) {
    const presetConfig = layer.renderingConfig.presets[layer.activePreset];
    if (presetConfig?.params) {
      const params = new URLSearchParams();
      Object.entries(presetConfig.params).forEach(([key, value]) => {
        if (value) params.set(key, String(value));
      });
      const qs = params.toString();
      tileUrl = qs ? `${baseUrl.split('?')[0]}?${qs}` : baseUrl;
    }
  } else if (layer.renderingConfig?.default_preset && layer.renderingConfig.presets) {
    const presetConfig = layer.renderingConfig.presets[layer.renderingConfig.default_preset];
    if (presetConfig?.params) {
      const params = new URLSearchParams();
      Object.entries(presetConfig.params).forEach(([key, value]) => {
        if (value) params.set(key, String(value));
      });
      const qs = params.toString();
      tileUrl = qs ? `${baseUrl.split('?')[0]}?${qs}` : baseUrl;
    }
  } else if (layer.renderingConfig?.bands && layer.renderingConfig.bands.length >= 3) {
    const bands = layer.renderingConfig.bands;
    const r = bands[0]?.index ?? 1;
    const g = bands[1]?.index ?? 2;
    const b = bands[2]?.index ?? 3;
    const params = new URLSearchParams();
    params.set('asset_bidx', `data|${r},${g},${b}`);
    const p2Vals = [bands[0]?.stats?.p2, bands[1]?.stats?.p2, bands[2]?.stats?.p2].filter(
      (v) => v != null,
    ) as number[];
    const p98Vals = [bands[0]?.stats?.p98, bands[1]?.stats?.p98, bands[2]?.stats?.p98].filter(
      (v) => v != null,
    ) as number[];
    if (p2Vals.length === 3 && p98Vals.length === 3) {
      params.set(
        'rescale',
        `${Math.round(Math.min(...p2Vals))},${Math.round(Math.max(...p98Vals))}`,
      );
    }
    tileUrl = `${baseUrl.split('?')[0]}?${params.toString()}`;
  }

  if (layer.clipBounds) {
    const [tilePath, existingQs] = tileUrl.split('?');
    const tileParams = new URLSearchParams(existingQs ?? '');
    tileParams.set('bbox', layer.clipBounds.join(','));
    tileUrl = `${tilePath}?${tileParams.toString()}`;
  }

  return tileUrl;
}

export function useAoiTimelineSync(): void {
  const aoiFetchRef = useRef(0);
  const aoiTileCacheRef = useRef<Map<string, string>>(new Map());
  // Tracks the last rendered frame index so a render-PARAM change (index, band
  // map, threshold) re-renders the CURRENT frame directly instead of committing
  // the double-buffered NEXT frame (which was preloaded with stale params).
  const lastIdxRef = useRef<number>(-1);

  // ── Swap tile layers when AOI frame index changes (or band selection changes) ──
  useEffect(() => {
    const unsub = useMapLayersStore.subscribe(
      (s) => ({
        idx: s.aoiTimelineIndex,
        frames: s.aoiTimelineFrames,
        enabled: s.aoiTimelineEnabled,
        datasetIds: s.aoiTimelineDatasetIds,
        aoiId: s.aoiTimelineAoiId,
        version: s.aoiRenderVersion,
        framesLen: s.aoiTimelineFrames.length,
        renderMode: s.aoiTimelineRenderMode,
        indexId: s.aoiTimelineIndexId,
        indexBands: s.aoiTimelineIndexBands,
        threshold: s.aoiTimelineThreshold,
      }),
      async ({ idx, frames, enabled, datasetIds, aoiId }) => {
        if (!enabled || frames.length === 0 || datasetIds.length === 0) return;
        const frame = frames[idx];
        if (!frame || frame.items.length === 0) return;

        // Did the frame index advance, or only the render params change?
        const idxChanged = idx !== lastIdxRef.current;
        lastIdxRef.current = idx;

        const seq = ++aoiFetchRef.current;
        const mm = getMapManager();
        const store = useMapLayersStore.getState();

        const aoiChildLayerByDatasetId = new Map<string, string>();
        for (const [layerId, layer] of Object.entries(store.layers)) {
          if (aoiId && layer.parentAoiId === aoiId && layer.sourceDatasetId) {
            aoiChildLayerByDatasetId.set(layer.sourceDatasetId, layerId);
          }
        }
        const layerIdForDataset = (dsId: string) =>
          aoiChildLayerByDatasetId.get(dsId) ?? dsId;

        try {
          if (frame.items.length === 1) {
            const { datasetId, stacItemId } = frame.items[0];
            const cacheKey = `${datasetId}:${stacItemId}`;
            let baseUrl = aoiTileCacheRef.current.get(cacheKey);

            if (!baseUrl) {
              const cfg = await datasetsApi.getItemTileConfigByStacId(datasetId, stacItemId);
              if (aoiFetchRef.current !== seq) return;
              baseUrl = cfg.tile_url_template;
              if (baseUrl) aoiTileCacheRef.current.set(cacheKey, baseUrl);
            }

            if (baseUrl) {
              const childLayerId = layerIdForDataset(datasetId);
              const finalUrl = applyAoiChildRendering(baseUrl, childLayerId);

              if (idxChanged && mm.hasAoiDoubleBuffer(childLayerId)) {
                // commitAoiFrame handles all cases:
                // true  → fade started, OR tiles loading (pending-commit, auto-fades on load)
                // false → crossfade in progress; skip this advance to avoid interrupting it
                mm.commitAoiFrame(childLayerId);
              } else {
                // Frame unchanged (render-param edit) or no buffer → re-render
                // the current frame in place with the new params.
                mm.setTileLayerUrl(childLayerId, finalUrl);
              }
            }

            for (const dsId of datasetIds) {
              const targetLayerId = layerIdForDataset(dsId);
              if (dsId !== datasetId && store.layers[targetLayerId]?.visible) {
                store.setLayerVisible(targetLayerId, false);
              } else if (dsId === datasetId && !store.layers[targetLayerId]?.visible) {
                store.setLayerVisible(targetLayerId, true);
              }
            }
          } else {
            const cacheKey = frame.items
              .map((it) => it.stacItemId)
              .sort()
              .join(',');
            let mosaicUrl = aoiTileCacheRef.current.get(cacheKey);

            if (!mosaicUrl) {
              const stacItemIds = frame.items.map((it) => it.stacItemId);
              const mosaic = await datasetsApi.getMultiItemTileJson(stacItemIds);
              if (aoiFetchRef.current !== seq) return;
              mosaicUrl = mosaic.tiles?.[0];
              if (mosaicUrl) aoiTileCacheRef.current.set(cacheKey, mosaicUrl);
            }

            if (mosaicUrl) {
              const primaryDsId = frame.items[0].datasetId;
              const primaryLayerId = layerIdForDataset(primaryDsId);
              const finalMosaicUrl = applyAoiChildRendering(mosaicUrl, primaryLayerId);

              if (idxChanged && mm.hasAoiDoubleBuffer(primaryLayerId)) {
                mm.commitAoiFrame(primaryLayerId);
              } else {
                mm.setTileLayerUrl(primaryLayerId, finalMosaicUrl);
              }

              for (const dsId of datasetIds) {
                const targetLayerId = layerIdForDataset(dsId);
                if (dsId !== primaryDsId && store.layers[targetLayerId]?.visible) {
                  store.setLayerVisible(targetLayerId, false);
                } else if (dsId === primaryDsId && !store.layers[targetLayerId]?.visible) {
                  store.setLayerVisible(targetLayerId, true);
                }
              }
            }
          }

          // ── Annotation-set visibility: show sets bound to this frame's STAC items ──
          {
            const currentStacIds = new Set(
              frame.stacItemIds ?? frame.items.map((it) => it.stacItemId),
            );
            const bindings = store.aoiAnnotationSetBindings;
            const shouldBeVisible = new Set<string>();
            for (const sid of currentStacIds) {
              const bound = bindings[sid];
              if (bound) for (const setId of bound) shouldBeVisible.add(setId);
            }
            const allBoundSetIds = new Set<string>();
            for (const list of Object.values(bindings)) {
              for (const setId of list) allBoundSetIds.add(setId);
            }
            // Raster-only mode: keep every bound set hidden.
            const showAnnotations = store.aoiTimelineShowAnnotations;
            for (const setId of allBoundSetIds) {
              const layerId = `annset-${setId}`;
              const layer = store.layers[layerId];
              if (!layer) continue;
              const wantVisible = showAnnotations && shouldBeVisible.has(setId);
              if (layer.visible !== wantVisible) store.setLayerVisible(layerId, wantVisible);
            }
          }

          // ── Prefetch next N frames ─────────────────────────────────────────
          for (let i = idx + 1; i <= Math.min(idx + AOI_PREFETCH, frames.length - 1); i++) {
            const nextFrame = frames[i];
            if (!nextFrame) continue;
            const isNextImmediate = i === idx + 1;

            if (nextFrame.items.length === 1) {
              const { datasetId, stacItemId } = nextFrame.items[0];
              const ck = `${datasetId}:${stacItemId}`;
              const childLayerId = aoiChildLayerByDatasetId.get(datasetId);
              if (!aoiTileCacheRef.current.has(ck)) {
                datasetsApi
                  .getItemTileConfigByStacId(datasetId, stacItemId)
                  .then((cfg) => {
                    if (cfg.tile_url_template) {
                      aoiTileCacheRef.current.set(ck, cfg.tile_url_template);
                      if (isNextImmediate && childLayerId && mm.hasAoiDoubleBuffer(childLayerId)) {
                        const nextUrl = applyAoiChildRendering(cfg.tile_url_template, childLayerId);
                        mm.preloadNextAoiFrame(childLayerId, nextUrl);
                      }
                    }
                  })
                  .catch(() => {});
              } else if (isNextImmediate && childLayerId && mm.hasAoiDoubleBuffer(childLayerId)) {
                const cachedUrl = aoiTileCacheRef.current.get(ck);
                if (cachedUrl) {
                  mm.preloadNextAoiFrame(childLayerId, applyAoiChildRendering(cachedUrl, childLayerId));
                }
              }
            } else {
              const ck = nextFrame.items.map((it) => it.stacItemId).sort().join(',');
              const primaryDsId = nextFrame.items[0].datasetId;
              const childLayerId = aoiChildLayerByDatasetId.get(primaryDsId);
              if (!aoiTileCacheRef.current.has(ck)) {
                datasetsApi
                  .getMultiItemTileJson(nextFrame.items.map((it) => it.stacItemId))
                  .then((m) => {
                    if (m.tiles?.[0]) {
                      aoiTileCacheRef.current.set(ck, m.tiles[0]);
                      if (isNextImmediate && childLayerId && mm.hasAoiDoubleBuffer(childLayerId)) {
                        mm.preloadNextAoiFrame(childLayerId, applyAoiChildRendering(m.tiles[0], childLayerId));
                      }
                    }
                  })
                  .catch(() => {});
              } else if (isNextImmediate && childLayerId && mm.hasAoiDoubleBuffer(childLayerId)) {
                const cachedUrl = aoiTileCacheRef.current.get(ck);
                if (cachedUrl) {
                  mm.preloadNextAoiFrame(childLayerId, applyAoiChildRendering(cachedUrl, childLayerId));
                }
              }
            }
          }
        } catch {
          // Keep showing current frame on error
        }
      },
      {
        equalityFn: (a, b) =>
          a.idx === b.idx &&
          a.enabled === b.enabled &&
          a.aoiId === b.aoiId &&
          a.version === b.version &&
          a.framesLen === b.framesLen &&
          a.renderMode === b.renderMode &&
          a.indexId === b.indexId &&
          a.indexBands === b.indexBands &&
          a.threshold === b.threshold,
      },
    );

    const unsubClose = useMapLayersStore.subscribe(
      (s) => s.aoiTimelineEnabled,
      (enabled) => {
        if (!enabled) {
          aoiTileCacheRef.current.clear();
          lastIdxRef.current = -1;
        }
      },
    );

    return () => {
      unsub();
      unsubClose();
    };
  }, []);

  // ── Prefetch ALL frame tile configs on first frame population ────────────
  useEffect(() => {
    const mm = getMapManager();
    const unsub = useMapLayersStore.subscribe(
      (s) => s.aoiTimelineFrames,
      (frames, prev) => {
        if (prev.length > 0 || frames.length === 0) return;

        const aoiId = useMapLayersStore.getState().aoiTimelineAoiId;
        const layerState = useMapLayersStore.getState().layers;
        const aoiChildLayerByDatasetId = new Map<string, string>();
        for (const [layerId, layer] of Object.entries(layerState)) {
          if (aoiId && layer.parentAoiId === aoiId && layer.sourceDatasetId) {
            aoiChildLayerByDatasetId.set(layer.sourceDatasetId, layerId);
          }
        }

        for (let frameIdx = 0; frameIdx < frames.length; frameIdx++) {
          const frame = frames[frameIdx];
          const isSecondFrame = frameIdx === 1;

          if (frame.items.length === 1) {
            const { datasetId, stacItemId } = frame.items[0];
            const ck = `${datasetId}:${stacItemId}`;
            if (!aoiTileCacheRef.current.has(ck)) {
              datasetsApi
                .getItemTileConfigByStacId(datasetId, stacItemId)
                .then((cfg) => {
                  if (cfg.tile_url_template) {
                    aoiTileCacheRef.current.set(ck, cfg.tile_url_template);
                    if (isSecondFrame) {
                      const childLayerId = aoiChildLayerByDatasetId.get(datasetId);
                      if (childLayerId && mm.hasAoiDoubleBuffer(childLayerId)) {
                        mm.preloadNextAoiFrame(
                          childLayerId,
                          applyAoiChildRendering(cfg.tile_url_template, childLayerId),
                        );
                      }
                    }
                  }
                })
                .catch(() => {});
            } else if (isSecondFrame) {
              const childLayerId = aoiChildLayerByDatasetId.get(datasetId);
              if (childLayerId && mm.hasAoiDoubleBuffer(childLayerId)) {
                const cachedUrl = aoiTileCacheRef.current.get(ck);
                if (cachedUrl) {
                  mm.preloadNextAoiFrame(childLayerId, applyAoiChildRendering(cachedUrl, childLayerId));
                }
              }
            }
          } else if (frame.items.length > 1) {
            const ck = frame.items.map((it) => it.stacItemId).sort().join(',');
            if (!aoiTileCacheRef.current.has(ck)) {
              datasetsApi
                .getMultiItemTileJson(frame.items.map((it) => it.stacItemId))
                .then((m) => {
                  if (m.tiles?.[0]) {
                    aoiTileCacheRef.current.set(ck, m.tiles[0]);
                    if (isSecondFrame) {
                      const primaryDsId = frame.items[0].datasetId;
                      const childLayerId = aoiChildLayerByDatasetId.get(primaryDsId);
                      if (childLayerId && mm.hasAoiDoubleBuffer(childLayerId)) {
                        mm.preloadNextAoiFrame(
                          childLayerId,
                          applyAoiChildRendering(m.tiles[0], childLayerId),
                        );
                      }
                    }
                  }
                })
                .catch(() => {});
            } else if (isSecondFrame) {
              const primaryDsId = frame.items[0].datasetId;
              const childLayerId = aoiChildLayerByDatasetId.get(primaryDsId);
              if (childLayerId && mm.hasAoiDoubleBuffer(childLayerId)) {
                const cachedUrl = aoiTileCacheRef.current.get(ck);
                if (cachedUrl) {
                  mm.preloadNextAoiFrame(childLayerId, applyAoiChildRendering(cachedUrl, childLayerId));
                }
              }
            }
          }
        }
      },
    );
    return unsub;
  }, []);

  // ── Restore collection mosaics when AOI timeline closes ───────────────────
  useEffect(() => {
    const unsub = useMapLayersStore.subscribe(
      (s) => ({ enabled: s.aoiTimelineEnabled, datasetIds: s.aoiTimelineDatasetIds }),
      async ({ enabled }, prev) => {
        if (prev.enabled && !enabled && prev.datasetIds.length > 0) {
          for (const dsId of prev.datasetIds) {
            try {
              const tj = await datasetsApi.getTileJson(dsId);
              if (tj.tiles?.[0]) {
                useMapLayersStore.getState().setLayerTileConfig(dsId, {
                  tileUrl: tj.tiles[0],
                  tileBounds: tj.bounds,
                  tileMinZoom: tj.minzoom,
                  tileMaxZoom: tj.maxzoom,
                });
              }
              useMapLayersStore.getState().setLayerVisible(dsId, true);
            } catch {
              useMapLayersStore.getState().setLayerVisible(dsId, true);
            }
          }
        }
      },
    );
    return unsub;
  }, []);
}
