/**
 * useMapSync — Reactive bridge from Zustand stores to MapManager.
 *
 * Subscribes to mapLayersStore and dispatches imperative calls to MapManager
 * whenever layer configs change. This is the ONLY place that reads store
 * changes and translates them into Leaflet mutations.
 */

import { useEffect, useRef } from 'react';
import { useMapLayersStore } from '@/stores/mapLayersStore';
import { useMapStore } from '@/stores/mapStore';
import { datasetsApi } from '@/lib/api/datasets';
import { getMapManager } from '../MapManager';
import type { LayerConfig } from '../types';

export function useMapSync(): void {
  const prevLayersRef = useRef<Record<string, LayerConfig>>({});
  const initialSyncDone = useRef(false);

  // ── Initial sync: push all existing layers to MapManager when map becomes ready ──
  const mapReady = useMapStore((s) => s.mapReady);
  useEffect(() => {
    if (!mapReady || initialSyncDone.current) return;
    initialSyncDone.current = true;
    const mm = getMapManager();
    if (!mm.getMap()) return;
    const layers = useMapLayersStore.getState().layers;
    for (const config of Object.values(layers)) {
      if (!mm.hasLayer(config.id)) {
        if (config.tileUrl) {
          mm.rebuildTileLayer(config.id, config);
        } else {
          mm.addLayer(config);
        }
      }
    }
    prevLayersRef.current = layers;
  }, [mapReady]);

  useEffect(() => {
    const unsub = useMapLayersStore.subscribe(
      (s) => s.layers,
      (current, prev) => {
        const mm = getMapManager();
        if (!mm.getMap()) return;

        const currentIds = new Set(Object.keys(current));
        const prevIds = new Set(Object.keys(prev));

        // ── Added layers ──────────────────────────────────────
        for (const id of currentIds) {
          if (!prevIds.has(id)) {
            mm.addLayer(current[id]);
          }
        }

        // ── Removed layers ────────────────────────────────────
        for (const id of prevIds) {
          if (!currentIds.has(id)) {
            mm.removeLayer(id);
          }
        }

        // ── Changed layers ────────────────────────────────────
        for (const id of currentIds) {
          if (!prevIds.has(id)) continue; // already handled as added
          const curr = current[id];
          const old = prev[id];
          if (curr === old) continue;

          // Visibility changed
          if (curr.visible !== old.visible) {
            mm.setLayerVisible(id, curr.visible);
          }

          // Opacity changed
          if (curr.opacity !== old.opacity) {
            mm.setLayerOpacity(id, curr.opacity);
          }

          // Style changed
          if (curr.style !== old.style) {
            mm.setLayerStyle(id, curr.style, curr);
          }

          // TileUrl changed — need to rebuild the tile layer (also handles bounds)
          if (curr.tileUrl !== old.tileUrl) {
            mm.rebuildTileLayer(id, curr);
          } else if (curr.tileBounds !== old.tileBounds && curr.tileBounds) {
            // TileBounds changed independently — create/update pointer marker
            mm.updateLayerBounds(id, curr.tileBounds, curr);
          }
        }

        prevLayersRef.current = current;
      }
    );

    return unsub;
  }, []);

  // ── Handle zoomToBounds requests ────────────────────────────────────────────
  useEffect(() => {
    const unsub = useMapLayersStore.subscribe(
      (s) => s.zoomToBounds,
      (bounds) => {
        if (!bounds) return;
        const mm = getMapManager();
        mm.fitBounds(bounds);
        // Clear after handling
        useMapLayersStore.getState().clearZoomToBounds();
      }
    );
    return unsub;
  }, []);

  // ── Handle zoom level changes for pointer visibility ────────────────────────
  useEffect(() => {
    const unsub = useMapLayersStore.subscribe(
      (s) => s.currentZoom,
      (zoom) => {
        const mm = getMapManager();
        mm.updatePointersForZoom(zoom);
      }
    );
    return unsub;
  }, []);

  // ── Handle layer focus changes ─────────────────────────────────────────────
  useEffect(() => {
    const unsub = useMapLayersStore.subscribe(
      (s) => s.focusedLayerId,
      (layerId) => {
        if (!layerId) return;
        const mm = getMapManager();
        mm.focusLayer(layerId);
      }
    );
    return unsub;
  }, []);

  // ── Timeline: swap tile layer when index changes ──────────────────────────
  // IMPORTANT: Preserve band selection when switching frames.
  // Also prefetch next N frames for smooth playback.
  const timelineFetchRef = useRef(0); // sequence counter to ignore stale fetches
  const tileCacheRef = useRef<Map<string, string>>(new Map()); // itemId -> tileUrl
  const PREFETCH_COUNT = 3; // Number of frames to prefetch ahead

  // Helper: Apply band selection to a tile URL template
  const applyBandSelection = (baseUrl: string, dsId: string): string => {
    const layer = useMapLayersStore.getState().layers[dsId];
    if (!layer?.bandSelection) return baseUrl;

    // Build query string manually to avoid URL() encoding {z}/{x}/{y} placeholders
    const params = new URLSearchParams();
    const bands = layer.bandSelection;
    const assetBidx = `data|${bands.r},${bands.g},${bands.b}`;
    params.set('asset_bidx', assetBidx);

    if (layer.renderingConfig?.bands) {
      const rBand = layer.renderingConfig.bands.find(b => b.index === bands.r);
      const gBand = layer.renderingConfig.bands.find(b => b.index === bands.g);
      const bBand = layer.renderingConfig.bands.find(b => b.index === bands.b);
      if (rBand && gBand && bBand) {
        const rescale = [
          `${rBand.stats.p2},${rBand.stats.p98}`,
          `${gBand.stats.p2},${gBand.stats.p98}`,
          `${bBand.stats.p2},${bBand.stats.p98}`,
        ].join('&rescale=');
        params.set('rescale', rescale);
      }
    }
    const basePath = baseUrl.split('?')[0];
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  // Helper: Prefetch tile configs for upcoming frames
  const prefetchFrames = async (dsId: string, items: { id: string }[], startIdx: number) => {
    const endIdx = Math.min(startIdx + PREFETCH_COUNT, items.length);
    for (let i = startIdx + 1; i < endIdx; i++) {
      const item = items[i];
      if (!item || tileCacheRef.current.has(item.id)) continue;
      
      // Fire and forget - don't await, just start the fetch
      datasetsApi.getItemTileConfig(dsId, item.id)
        .then(cfg => {
          if (cfg.tile_url_template) {
            tileCacheRef.current.set(item.id, cfg.tile_url_template);
          }
        })
        .catch(() => { /* ignore prefetch failures */ });
    }
  };

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
          // Check cache first for instant frame changes
          let baseUrl = tileCacheRef.current.get(item.id);
          
          if (!baseUrl) {
            // Cache miss - fetch from API
            const cfg = await datasetsApi.getItemTileConfig(dsId, item.id);
            if (timelineFetchRef.current !== seq) return; // stale
            baseUrl = cfg.tile_url_template;
            if (baseUrl) {
              tileCacheRef.current.set(item.id, baseUrl);
            }
          }

          if (baseUrl) {
            // Apply band selection
            const finalUrl = applyBandSelection(baseUrl, dsId);

            // Compute bbox from item geometry if available
            let tileBounds: [number, number, number, number] | undefined;
            if (item.geometry && 'coordinates' in item.geometry) {
              try {
                tileBounds = geojsonBbox(item.geometry);
              } catch { /* ignore */ }
            }

            useMapLayersStore.getState().setLayerTileConfig(dsId, {
              tileUrl: finalUrl,
              ...(tileBounds ? { tileBounds } : {}),
            });

            // Prefetch next frames in background
            prefetchFrames(dsId, items, idx);
          }
        } catch {
          // Tile config fetch failed — keep showing current frame
        }
      },
      { equalityFn: (a, b) => a.idx === b.idx && a.dsId === b.dsId && a.enabled === b.enabled }
    );

    // Clear cache when timeline closes
    const unsubClose = useMapLayersStore.subscribe(
      (s) => s.timelineEnabled,
      (enabled) => {
        if (!enabled) {
          tileCacheRef.current.clear();
        }
      }
    );

    return () => {
      unsub();
      unsubClose();
    };
  }, []);

  // ── Timeline: restore collection mosaic when timeline closes ──────────────
  useEffect(() => {
    const unsub = useMapLayersStore.subscribe(
      (s) => ({ dsId: s.timelineDatasetId, originalUrl: s.timelineOriginalTileUrl }),
      async ({ dsId, originalUrl }, prev) => {
        // Timeline just closed: dsId went from non-null to null
        if (prev.dsId && !dsId && prev.originalUrl) {
          try {
            // Restore the collection-level TileJSON
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
            // If TileJSON fetch fails, at least restore the stashed URL
            if (prev.originalUrl) {
              useMapLayersStore.getState().setLayerTileConfig(prev.dsId, {
                tileUrl: prev.originalUrl,
              });
            }
          }
        }
      }
    );
    return unsub;
  }, []);
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
    if (lng < w) w = lng; if (lng > e) e = lng;
    if (lat < s) s = lat; if (lat > n) n = lat;
  }
  return [w, s, e, n];
}
