/**
 * AnnotationLayerIntegration
 * 
 * Helper utilities for integrating annotation layer updates into MapManager.
 * This handles:
 * - Refreshing annotation layer data after create/update/delete
 * - Syncing store state with map rendering
 * - Invalidating queries when annotations change
 */

import { useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/query-keys';

/**
 * Hook to refresh an annotation layer after data mutations.
 * Call this in useEffect to set up listeners for annotation store changes.
 */
export function useAnnotationLayerRefresh(annotationSetId: string | null) {
  const queryClient = useQueryClient();

  const refreshLayer = () => {
    if (!annotationSetId) return;

    // Invalidate the features query to trigger a refetch
    queryClient.invalidateQueries({
      queryKey: qk.annotationSets.features(annotationSetId),
    });

    // Also invalidate the annotation set detail in case counts changed
    queryClient.invalidateQueries({
      queryKey: qk.annotationSets.detail(annotationSetId),
    });
  };

  return { refreshLayer };
}

/**
 * Integration pattern for MapManager to handle annotation drawing.
 * Add this to your MapManager class or useMapSync hook:
 * 
 * Example in MapManager:
 * ```ts
 * setupAnnotationDrawing() {
 *   // When user draws on map, store geometry in annotationStore
 *   if (this.map.pm) {
 *     this.map.pm.setPathOptions({ color: 'blue', fillColor: 'lightblue' });
 *     this.map.on('pm:create', (e) => {
 *       const geo = e.layer.toGeoJSON().geometry;
 *       useAnnotationStore.setState({ 
 *         pendingAnnotation: { ...useAnnotationStore.getState().pendingAnnotation, geometry: geo }
 *       });
 *     });
 *   }
 * }
 * ```
 * 
 * Example in component that renders annotation set:
 * ```tsx
 * const { refreshLayer } = useAnnotationLayerRefresh(annotationSetId);
 * const createMutation = useCreateAnnotation();
 * 
 * // After successful save
 * useEffect(() => {
 *   if (createMutation.isSuccess) {
 *     refreshLayer();
 *   }
 * }, [createMutation.isSuccess]);
 * ```
 */

/**
 * After MapManager has drawn a geometry, store it in the annotation store.
 * This is called from Leaflet's pm:create event.
 */
export function handleAnnotationGeometryDrawn(
  geoJsonGeometry: GeoJSON.Geometry,
) {
  // Import at runtime to avoid circular deps
  const { useAnnotationStore } = require('@/stores/annotationStore');
  useAnnotationStore.setState({
    pendingAnnotation: (state: any) => ({
      ...state,
      geometry: geoJsonGeometry,
    }),
  });
}

/**
 * Invalidate all annotation-related queries after a change.
 * Useful for bulk operations or when you want to fully refresh.
 */
export function invalidateAllAnnotationQueries(queryClient: any) {
  queryClient.invalidateQueries({
    queryKey: ['annotation-sets'],
  });
  queryClient.invalidateQueries({
    queryKey: ['annotation-schemas'],
  });
}
