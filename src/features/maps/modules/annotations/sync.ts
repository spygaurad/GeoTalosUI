/**
 * Annotation module sync hook.
 *
 * Owns reactive side-effects for annotation state changes:
 * - Fetching GeoJSON features when a new annotation-set layer is added
 * - Refreshing annotation-set GeoJSON after a new annotation is drawn
 *
 * Called by core/useMapSync as part of the composed sync pipeline.
 * Logic migrated from hooks/useMapSync.ts (annotation-specific useEffect blocks).
 */
'use client';

import { useEffect } from 'react';
import { useMapLayersStore } from '@/stores/mapLayersStore';
import { annotationSetsApi, buildRasterTileUrl } from '@/lib/api/annotation-sets';
import { annotationClassesApi } from '@/lib/api/annotation-classes';
import { getMapManager } from '@/features/maps/MapManager';
import { buildClassStyles, extractClassIdFromProperties } from '@/features/maps/utils/annotationStyles';
import type { GeoJSONFeatureCollection } from '@/lib/api/annotation-sets';

const CLASS_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function hydrateClassStylesFromFeatures(
  layerId: string,
  fc: GeoJSONFeatureCollection,
): Promise<void> {
  const state = useMapLayersStore.getState();
  const layer = state.layers[layerId];
  if (!layer || layer.sourceType !== 'annotation_set') return;

  const existing = layer.classStyles ?? {};
  const classIds = new Set<string>();
  for (const feature of fc.features ?? []) {
    const classRef = extractClassIdFromProperties(
      feature.properties as Record<string, unknown> | undefined,
    );
    if (classRef && CLASS_ID_RE.test(classRef)) classIds.add(classRef);
  }

  const missingClassIds = [...classIds].filter((id) => !existing[id]);
  if (missingClassIds.length === 0) return;

  const responses = await Promise.allSettled(
    missingClassIds.map((classId) => annotationClassesApi.get(classId)),
  );

  const merged = { ...existing };
  let changed = false;
  for (const response of responses) {
    if (response.status !== 'fulfilled') continue;
    const mapped = buildClassStyles([response.value]);
    if (!mapped) continue;
    for (const [key, value] of Object.entries(mapped)) {
      if (!merged[key]) {
        merged[key] = value;
        changed = true;
      }
    }
  }
  if (!changed) return;

  useMapLayersStore.setState((s) => {
    const current = s.layers[layerId];
    if (!current) return {};
    return {
      layers: {
        ...s.layers,
        [layerId]: { ...current, classStyles: merged },
      },
    };
  });

  getMapManager().setLayerData(layerId, fc);
}

/** Load a vector GeoJSON annotation-set layer (the normal path). */
function loadVectorAnnotationSet(id: string, setId: string): void {
  annotationSetsApi
    .getFeatures(setId)
    .then((fc) => {
      void hydrateClassStylesFromFeatures(id, fc);
      getMapManager().setLayerData(id, fc);
    })
    .catch(() => {});
}

export function useAnnotationSync(): void {
  // ── Fetch data when a new annotation-set layer is added ───────────────────
  // For raster masks: fetch raster config → build TiTiler tile URL.
  // For vector sets: fetch GeoJSON features as usual.
  useEffect(() => {
    const unsub = useMapLayersStore.subscribe(
      (s) => s.layers,
      (current, prev) => {
        for (const [id, layer] of Object.entries(current)) {
          if (prev[id]) continue; // existed before
          if (layer.sourceType !== 'annotation_set' || !layer.annotationSetId) continue;
          const setId = layer.annotationSetId;

          // If the layer was already created with isRasterMask: true and a tileUrl
          // (e.g. via addAnnotationSetLayer from LeftPanel picker), skip the async check —
          // the tile layer is already correctly configured by MapManager.createLayer.
          if (layer.isRasterMask && layer.tileUrl) continue;

          // Check for raster config first; fall back to vector if none.
          annotationSetsApi
            .getRasterConfig(setId)
            .then((rasterConfig) => {
              if (rasterConfig?.tile_url_template) {
                // Raster mask — inject tile URL + flag into layer config and rebuild
                const tileUrl = buildRasterTileUrl(rasterConfig);
                useMapLayersStore.setState((s) => {
                  const cur = s.layers[id];
                  if (!cur) return {};
                  return { layers: { ...s.layers, [id]: { ...cur, tileUrl, isRasterMask: true } } };
                });
                const updated = useMapLayersStore.getState().layers[id];
                if (updated) getMapManager().rebuildTileLayer(id, updated);
              } else {
                // Vector annotation set
                loadVectorAnnotationSet(id, setId);
              }
            })
            .catch(() => {
              // getRasterConfig returns null on 404, but if anything else throws,
              // fall back to vector path
              loadVectorAnnotationSet(id, setId);
            });
        }
      },
    );
    return unsub;
  }, []);

  // ── Refresh annotation-set GeoJSON after a new annotation is drawn ────────
  useEffect(() => {
    const unsub = useMapLayersStore.subscribe(
      (s) => s.refreshAnnotationSetId,
      (setId) => {
        if (!setId) return;
        const layerId = `annset-${setId}`;
        annotationSetsApi
          .getFeatures(setId)
          .then((fc) => {
            void hydrateClassStylesFromFeatures(layerId, fc);
            getMapManager().setLayerData(layerId, fc);
          })
          .catch(() => {});
        useMapLayersStore.getState().clearAnnotationSetRefresh();
      },
    );
    return unsub;
  }, []);
}
