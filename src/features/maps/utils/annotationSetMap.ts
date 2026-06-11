/**
 * Shared helpers for annotation-set map operations.
 * Used by both LeftPanel and LibraryPanel.
 */
import { annotationSetsApi } from '@/lib/api/annotation-sets';
import { useMapLayersStore } from '@/stores/mapLayersStore';

/**
 * Fetch the WGS-84 bounding box for an annotation set, attach it as
 * `tileBounds` on the layer (enables the pointer marker), and fly the
 * map to the annotation area.
 *
 * Silently no-ops when the set has no annotations yet.
 */
export async function flyToAnnotationSet(layerId: string, setId: string): Promise<void> {
  try {
    const { bounds } = await annotationSetsApi.getBounds(setId);
    if (!bounds) return;
    const tb: [number, number, number, number] = [
      bounds.west, bounds.south, bounds.east, bounds.north,
    ];
    const store = useMapLayersStore.getState();
    const layer = store.layers[layerId];
    if (layer?.tileUrl) {
      store.setLayerTileConfig(layerId, { tileUrl: layer.tileUrl, tileBounds: tb });
    }
    store.requestZoomToBounds(tb);
  } catch {
    // Non-fatal — bounds fetch may fail for empty/new sets
  }
}
