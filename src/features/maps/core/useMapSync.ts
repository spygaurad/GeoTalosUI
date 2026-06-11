/**
 * useMapSync — Composed reactive bridge from Zustand to MapManager.
 *
 * This is the composition root for all module sync hooks.
 * Each module owns its own sync logic in a separate file.
 * This hook calls them all in sequence.
 *
 * Usage: mount once inside LeafletMap (or MapEditorShell).
 * Import from '@/features/maps/core/useMapSync' in new code.
 * The original '@/features/maps/hooks/useMapSync' re-exports from here
 * for backward compatibility.
 */
'use client';

import { useEffect, useRef } from 'react';
import { useMapLayersStore } from '@/stores/mapLayersStore';
import { useMapStore } from '@/stores/mapStore';
import { getMapManager } from '@/features/maps/MapManager';
import type { LayerConfig } from '../types';

// Module sync hooks
import { useAnnotationSync } from '../modules/annotations/sync';
import { useTimelineSync } from '../modules/timeline/sync';
import { useAoiTimelineSync } from '../modules/aoi/sync';

export function useMapSync(): void {
  const prevLayersRef = useRef<Record<string, LayerConfig>>({});
  const initialSyncDone = useRef(false);

  // ── Initial sync: push all existing layers when map becomes ready ─────────
  const mapReady = useMapStore((s) => s.mapReady);
  useEffect(() => {
    if (!mapReady || initialSyncDone.current) return;
    initialSyncDone.current = true;
    const mm = getMapManager();
    if (!mm.getMap()) return;
    const layers = useMapLayersStore.getState().layers;
    for (const config of Object.values(layers)) {
      if (!mm.hasLayer(config.id)) {
        if (config.tileUrl) mm.rebuildTileLayer(config.id, config);
        else mm.addLayer(config);
      }
    }
    prevLayersRef.current = layers;
  }, [mapReady]);

  // ── Layer CRUD sync: add/remove/update layers ─────────────────────────────
  useEffect(() => {
    const unsub = useMapLayersStore.subscribe(
      (s) => s.layers,
      (current, prev) => {
        const mm = getMapManager();
        if (!mm.getMap()) return;

        const currentIds = new Set(Object.keys(current));
        const prevIds = new Set(Object.keys(prev));

        // Added layers
        for (const id of currentIds) {
          if (!prevIds.has(id)) mm.addLayer(current[id]);
        }

        // Removed layers
        for (const id of prevIds) {
          if (!currentIds.has(id)) mm.removeLayer(id);
        }

        // Changed layers
        for (const id of currentIds) {
          if (!prevIds.has(id)) continue;
          const curr = current[id];
          const old = prev[id];
          if (curr === old) continue;

          // Rebuild layer if aoiGeometry was added (common on page reload)
          if (curr.aoiGeometry && !old.aoiGeometry) {
            mm.removeLayer(id);
            mm.addLayer(curr);
            continue;
          }

          if (curr.visible !== old.visible) mm.setLayerVisible(id, curr.visible);
          if (curr.opacity !== old.opacity) mm.setLayerOpacity(id, curr.opacity);
          if (curr.style !== old.style) mm.setLayerStyle(id, curr.style, curr);
          if (curr.annotationFilter !== old.annotationFilter) {
            // MVT layers capture their config in a style closure at creation,
            // so they must be rebuilt; GeoJSON layers can be restyled in place.
            if (curr.tileFormat === 'mvt') {
              mm.removeLayer(id);
              mm.addLayer(curr);
            } else {
              mm.restyleAnnotationLayer(id, curr);
            }
          }
          if (curr.zIndex !== old.zIndex) mm.setLayerZIndex(id, curr.zIndex);

          if (curr.tileUrl !== old.tileUrl) {
            if (curr.parentAoiId && mm.hasLayer(id) && curr.tileUrl) {
              // AOI child layers always carry a double buffer (for timeline
              // crossfades). A store tileUrl change here is a user-driven
              // re-render (band/preset/item) — not a frame advance — so apply
              // it directly to both buffers instead of dropping it.
              if (mm.hasAoiDoubleBuffer(id)) {
                mm.setAoiDoubleBufferUrl(id, curr.tileUrl);
              } else {
                mm.setTileLayerUrl(id, curr.tileUrl);
              }
            } else {
              mm.rebuildTileLayer(id, curr);
            }
          } else if (curr.tileBounds !== old.tileBounds && curr.tileBounds) {
            mm.updateLayerBounds(id, curr.tileBounds, curr);
          }
        }

        prevLayersRef.current = current;
      },
    );
    return unsub;
  }, []);

  // ── View: zoom to bounds requests ─────────────────────────────────────────
  useEffect(() => {
    const unsub = useMapLayersStore.subscribe(
      (s) => s.zoomToBounds,
      (bounds) => {
        if (!bounds) return;
        const mm = getMapManager();
        if (useMapLayersStore.getState().zoomInwardOnly) {
          mm.fitBoundsInward(bounds);
        } else {
          mm.fitBounds(bounds);
        }
        useMapLayersStore.getState().clearZoomToBounds();
      },
    );
    return unsub;
  }, []);

  // ── View: zoom-level pointer visibility ───────────────────────────────────
  useEffect(() => {
    const unsub = useMapLayersStore.subscribe(
      (s) => s.currentZoom,
      (zoom) => getMapManager().updatePointersForZoom(zoom),
    );
    return unsub;
  }, []);

  // ── View: layer focus ─────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = useMapLayersStore.subscribe(
      (s) => s.focusedLayerId,
      (layerId) => {
        if (!layerId) return;
        getMapManager().focusLayer(layerId);
      },
    );
    return unsub;
  }, []);

  // ── Module sync hooks ─────────────────────────────────────────────────────
  useAnnotationSync();
  useTimelineSync();
  useAoiTimelineSync();
}
