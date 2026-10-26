/**
 * Annotation module sync hook.
 *
 * Owns reactive side-effects for annotation state changes:
 * - Resolving raster vs. vector (MVT) when a new annotation-set layer is added
 * - Reloading an annotation set's tiles after an edit
 *
 * Called by core/useMapSync as part of the composed sync pipeline.
 * Logic migrated from hooks/useMapSync.ts (annotation-specific useEffect blocks).
 */
'use client';

import { useEffect } from 'react';
import { useMapLayersStore } from '@/stores/mapLayersStore';
import { annotationSetsApi, buildRasterTileUrl } from '@/lib/api/annotation-sets';
import { annotationSchemasApi } from '@/lib/api/annotation-schemas';
import { buildClassStyles } from '@/features/maps/utils/annotationStyles';
import { getMapManager } from '@/features/maps/MapManager';

/**
 * Fill in class colors for layers added without them (e.g. a verified set
 * created during the session). MVT layers have no feature list in the
 * browser, so colors come from the set's schema classes; useMapSync rebuilds
 * the MVT layer when classStyles change.
 */
async function hydrateClassStylesFromSchema(layerId: string, setId: string): Promise<void> {
  if (useMapLayersStore.getState().layers[layerId]?.classStyles) return;
  const annotationSet = await annotationSetsApi.get(setId);
  if (!annotationSet.schema_id) return;
  const { items } = await annotationSchemasApi.getClasses(annotationSet.schema_id);
  const classStyles = buildClassStyles(items);
  if (!classStyles) return;
  useMapLayersStore.setState((s) => {
    const cur = s.layers[layerId];
    if (!cur || cur.classStyles) return {};
    return { layers: { ...s.layers, [layerId]: { ...cur, classStyles } } };
  });
}

/**
 * Vector annotation sets render from MVT tiles. Layers restored from a saved
 * map arrive via initLayer() without tile settings, so set them here; the
 * tileUrl change makes useMapSync build the VectorGrid layer.
 */
function loadVectorAnnotationSet(id: string, setId: string): void {
  useMapLayersStore.setState((s) => {
    const cur = s.layers[id];
    if (!cur || cur.tileFormat === 'mvt') return {};
    return {
      layers: {
        ...s.layers,
        [id]: {
          ...cur,
          tileFormat: 'mvt' as const,
          mvtLayerName: 'annotation_set_mvt',
          tileUrl: annotationSetsApi.getTileUrlTemplate(setId),
        },
      },
    };
  });
  void hydrateClassStylesFromSchema(id, setId).catch(() => {});
}

export function useAnnotationSync(): void {
  // ── Fetch data when a new annotation-set layer is added ───────────────────
  // For raster masks: fetch raster config → build TiTiler tile URL.
  // For vector sets: mark the layer as MVT so it loads tiles for the viewport.
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

  // ── Reload annotation-set tiles after an edit (new tile_version → new URL) ─
  useEffect(() => {
    const unsub = useMapLayersStore.subscribe(
      (s) => s.refreshAnnotationSetId,
      (setId) => {
        if (!setId) return;
        void useMapLayersStore.getState().refreshAnnotationSetTiles(setId).catch(() => {});
        useMapLayersStore.getState().clearAnnotationSetRefresh();
      },
    );
    return unsub;
  }, []);
}
