/**
 * Timeline module sync hook.
 *
 * Owns reactive side-effects for single-dataset temporal playback:
 * - Swapping tile layer URL when timeline index changes (with band selection)
 * - Prefetching upcoming frame tile configs for smooth playback
 * - Restoring the collection-level tile URL when the timeline closes
 *
 * Called by core/useMapSync as part of the composed sync pipeline.
 * Logic migrated from hooks/useMapSync.ts (timeline-specific useEffect blocks).
 */
'use client';

import { useEffect, useRef } from 'react';
import { useMapLayersStore } from '@/stores/mapLayersStore';
import { datasetsApi } from '@/lib/api/datasets';
import { getMapManager } from '@/features/maps/MapManager';

const PREFETCH_COUNT = 3;

/** Apply band selection to a tile URL template for a given dataset layer. */
function applyBandSelection(baseUrl: string, dsId: string): string {
  const layer = useMapLayersStore.getState().layers[dsId];
  if (!layer?.bandSelection) return baseUrl;

  const params = new URLSearchParams();
  const bands = layer.bandSelection;
  params.set('asset_bidx', `data|${bands.r},${bands.g},${bands.b}`);

  if (layer.renderingConfig?.bands) {
    const rBand = layer.renderingConfig.bands.find((b) => b.index === bands.r);
    const gBand = layer.renderingConfig.bands.find((b) => b.index === bands.g);
    const bBand = layer.renderingConfig.bands.find((b) => b.index === bands.b);
    if (rBand && gBand && bBand) {
      params.set('rescale', [
        `${rBand.stats.p2},${rBand.stats.p98}`,
        `${gBand.stats.p2},${gBand.stats.p98}`,
        `${bBand.stats.p2},${bBand.stats.p98}`,
      ].join('&rescale='));
    }
  }

  const basePath = baseUrl.split('?')[0];
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/** Compute [west, south, east, north] bbox from a GeoJSON geometry. */
function geojsonBbox(geom: Record<string, unknown>): [number, number, number, number] {
  const coords: number[][] = [];
  function walk(val: unknown): void {
    if (Array.isArray(val)) {
      if (val.length >= 2 && typeof val[0] === 'number' && typeof val[1] === 'number') {
        coords.push(val as number[]);
      } else {
        val.forEach(walk);
      }
    }
  }
  walk((geom as { coordinates?: unknown }).coordinates);
  if (coords.length === 0) throw new Error('no coordinates');
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [lng, lat] of coords) {
    if (lng < w) w = lng;
    if (lat < s) s = lat;
    if (lng > e) e = lng;
    if (lat > n) n = lat;
  }
  return [w, s, e, n];
}

export function useTimelineSync(): void {
  const timelineFetchRef = useRef(0);
  const tileCacheRef = useRef<Map<string, string>>(new Map());

  const prefetchFrames = async (
    dsId: string,
    items: { id: string }[],
    startIdx: number,
  ): Promise<void> => {
    const endIdx = Math.min(startIdx + PREFETCH_COUNT, items.length);
    for (let i = startIdx + 1; i < endIdx; i++) {
      const item = items[i];
      if (!item || tileCacheRef.current.has(item.id)) continue;
      datasetsApi
        .getItemTileConfig(dsId, item.id)
        .then((cfg) => {
          if (cfg.tile_url_template) {
            tileCacheRef.current.set(item.id, cfg.tile_url_template);
          }
        })
        .catch(() => {});
    }
  };

  // ── Swap tile URL when index changes ─────────────────────────────────────
  useEffect(() => {
    const unsub = useMapLayersStore.subscribe(
      (s) => ({
        idx: s.timelineIndex,
        dsId: s.timelineDatasetId,
        items: s.timelineItems,
        enabled: s.timelineEnabled,
      }),
      async ({ idx, dsId, items, enabled }) => {
        if (!enabled || !dsId || items.length === 0) return;
        const item = items[idx];
        if (!item) return;

        const seq = ++timelineFetchRef.current;

        try {
          let baseUrl = tileCacheRef.current.get(item.id);

          if (!baseUrl) {
            const cfg = await datasetsApi.getItemTileConfig(dsId, item.id);
            if (timelineFetchRef.current !== seq) return;
            baseUrl = cfg.tile_url_template;
            if (baseUrl) tileCacheRef.current.set(item.id, baseUrl);
          }

          if (baseUrl) {
            const finalUrl = applyBandSelection(baseUrl, dsId);

            let tileBounds: [number, number, number, number] | undefined;
            if (item.geometry && 'coordinates' in item.geometry) {
              try {
                tileBounds = geojsonBbox(item.geometry as Record<string, unknown>);
              } catch {
                /* ignore */
              }
            }

            useMapLayersStore.getState().setLayerTileConfig(dsId, {
              tileUrl: finalUrl,
              ...(tileBounds ? { tileBounds } : {}),
            });

            prefetchFrames(dsId, items, idx);
          }
        } catch {
          // Keep showing current frame on fetch failure
        }
      },
      { equalityFn: (a, b) => a.idx === b.idx && a.dsId === b.dsId && a.enabled === b.enabled },
    );

    const unsubClose = useMapLayersStore.subscribe(
      (s) => s.timelineEnabled,
      (enabled) => {
        if (!enabled) tileCacheRef.current.clear();
      },
    );

    return () => {
      unsub();
      unsubClose();
    };
  }, []);

  // ── Restore collection tile URL when timeline closes ──────────────────────
  useEffect(() => {
    const unsub = useMapLayersStore.subscribe(
      (s) => ({ dsId: s.timelineDatasetId, originalUrl: s.timelineOriginalTileUrl }),
      async (_current, prev) => {
        const currentDsId = useMapLayersStore.getState().timelineDatasetId;
        if (prev.dsId && !currentDsId && prev.originalUrl) {
          try {
            const tj = await datasetsApi.getTileJson(prev.dsId);
            if (tj.tiles?.[0]) {
              useMapLayersStore.getState().setLayerTileConfig(prev.dsId, {
                tileUrl: tj.tiles[0],
                tileBounds: tj.bounds,
                tileMinZoom: tj.minzoom,
                tileMaxZoom: tj.maxzoom,
              });
            }
          } catch {
            if (prev.originalUrl) {
              useMapLayersStore.getState().setLayerTileConfig(prev.dsId, {
                tileUrl: prev.originalUrl,
              });
            }
          }
        }
      },
    );
    return unsub;
  }, []);
}
