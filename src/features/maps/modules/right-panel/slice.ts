/**
 * Right Panel Slice
 *
 * Manages the right panel mode, selected layer/feature/dataset state,
 * and all panel-opening/closing actions.
 */

import type { RightPanelMode, SelectedFeature } from '@/features/maps/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createRightPanelSlice(set: any, _get: any) {
  return {
    // ── State ──────────────────────────────────────────────────────────────
    rightPanelMode: 'none' as RightPanelMode,
    selectedLayerId: null as string | null,
    selectedFeature: null as SelectedFeature | null,
    selectedDatasetId: null as string | null,
    selectedItemsDatasetId: null as string | null,
    selectedAnnotationSetId: null as string | null,

    // ── Actions ────────────────────────────────────────────────────────────
    openDatasetPanel: (datasetId: string) =>
      set({
        rightPanelMode: 'dataset',
        selectedDatasetId: datasetId,
        selectedFeature: null,
        selectedLayerId: null,
      }),

    openItemsPanel: (datasetId: string) =>
      set({
        rightPanelMode: 'items',
        selectedItemsDatasetId: datasetId,
        selectedFeature: null,
        selectedLayerId: null,
      }),

    openAnnotationSetPanel: (annotationSetId: string) =>
      set({
        rightPanelMode: 'annotation-set',
        selectedAnnotationSetId: annotationSetId,
        selectedFeature: null,
        selectedLayerId: null,
      }),

    openFeaturePanel: (feature: SelectedFeature) =>
      set({
        rightPanelMode: 'feature',
        selectedFeature: feature,
        selectedLayerId: feature.layerId ?? null,
      }),

    openStylePanel: (layerId: string) =>
      set({
        rightPanelMode: 'style',
        selectedLayerId: layerId,
        selectedFeature: null,
      }),

    openMeasurementPanel: () =>
      set({
        rightPanelMode: 'measurement',
        selectedFeature: null,
        selectedLayerId: null,
      }),

    showAnnotationPanel: () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      set((s: any) => (s.pendingAnnotation ? { rightPanelMode: 'new-annotation' } : s)),

    closeRightPanel: () =>
      set({
        rightPanelMode: 'none',
        selectedLayerId: null,
        selectedFeature: null,
        selectedDatasetId: null,
        selectedItemsDatasetId: null,
        selectedAnnotationSetId: null,
      }),

    layerOnMapClick: (layerId: string) =>
      set({
        selectedLayerId: layerId,
        rightPanelMode: 'style',
        selectedFeature: null,
      }),
  };
}
