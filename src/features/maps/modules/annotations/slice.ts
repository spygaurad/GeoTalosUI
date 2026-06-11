/**
 * Annotations Slice
 *
 * Manages pending annotation state, annotation drawing mode,
 * annotation set layers, annotation-set refresh signals,
 * and AOI-to-annotation-set bindings.
 */

import type { PendingAnnotation, LayerStyle } from '@/features/maps/types';
import {
  DEFAULT_ANNOTATION_STYLE,
} from '@/features/maps/types';
import { annotationSetsApi } from '@/lib/api/annotation-sets';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createAnnotationSlice(set: any, get: any) {
  return {
    // ── State ──────────────────────────────────────────────────────────────
    pendingAnnotation: null as PendingAnnotation | null,
    activeAnnotationSetId: null as string | null,
    activeAnnotationClassId: null as string | null,
    refreshAnnotationSetId: null as string | null,
    aoiAnnotationSetBindings: {} as Record<string, string[]>,

    // ── Pending annotation actions ─────────────────────────────────────────
    openAnnotationPanel: () =>
      set({
        rightPanelMode: 'new-annotation',
        selectedFeature: null,
        selectedLayerId: null,
        pendingAnnotation: {
          label: '',
          description: '',
          style: { ...DEFAULT_ANNOTATION_STYLE },
          attributes: [],
        },
      }),

    setPendingAnnotationField: (patch: Partial<Omit<PendingAnnotation, 'attributes' | 'style'>>) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      set((s: any) =>
        s.pendingAnnotation ? { pendingAnnotation: { ...s.pendingAnnotation, ...patch } } : s,
      ),

    setPendingAnnotationStyle: (patch: Partial<LayerStyle>) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      set((s: any) =>
        s.pendingAnnotation
          ? { pendingAnnotation: { ...s.pendingAnnotation, style: { ...s.pendingAnnotation.style, ...patch } } }
          : s,
      ),

    addPendingAnnotationAttribute: () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      set((s: any) =>
        s.pendingAnnotation
          ? { pendingAnnotation: { ...s.pendingAnnotation, attributes: [...s.pendingAnnotation.attributes, { key: '', value: '' }] } }
          : s,
      ),

    updatePendingAnnotationAttribute: (idx: number, key: string, value: string) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      set((s: any) => {
        if (!s.pendingAnnotation) return s;
        const attrs = [...s.pendingAnnotation.attributes];
        attrs[idx] = { key, value };
        return { pendingAnnotation: { ...s.pendingAnnotation, attributes: attrs } };
      }),

    removePendingAnnotationAttribute: (idx: number) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      set((s: any) =>
        s.pendingAnnotation
          ? { pendingAnnotation: { ...s.pendingAnnotation, attributes: s.pendingAnnotation.attributes.filter((_: unknown, i: number) => i !== idx) } }
          : s,
      ),

    clearPendingAnnotation: () =>
      set({ pendingAnnotation: null, rightPanelMode: 'none' }),

    // ── Annotation draw mode ───────────────────────────────────────────────
    startAnnotationDraw: (setId: string) =>
      set({
        activeAnnotationSetId: setId,
        activeAnnotationClassId: null,
        rightPanelMode: 'annotation-draw',
      }),

    setAnnotationDrawClass: (classId: string | null) =>
      set({ activeAnnotationClassId: classId }),

    stopAnnotationDraw: () =>
      set({
        activeAnnotationSetId: null,
        activeAnnotationClassId: null,
        rightPanelMode: 'none',
      }),

    // ── Annotation set refresh ─────────────────────────────────────────────
    requestAnnotationSetRefresh: (setId: string) =>
      set({ refreshAnnotationSetId: setId }),

    clearAnnotationSetRefresh: () =>
      set({ refreshAnnotationSetId: null }),

    // ── AOI annotation-set bindings ────────────────────────────────────────
    bindAnnotationSetToStacItem: (stacItemId: string, setId: string) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      set((s: any) => {
        const cur = s.aoiAnnotationSetBindings[stacItemId] ?? [];
        if (cur.includes(setId)) return s;
        return {
          aoiAnnotationSetBindings: {
            ...s.aoiAnnotationSetBindings,
            [stacItemId]: [...cur, setId],
          },
        };
      }),

    unbindAnnotationSetFromStacItem: (stacItemId: string, setId: string) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      set((s: any) => {
        const cur = s.aoiAnnotationSetBindings[stacItemId];
        if (!cur) return s;
        const next = cur.filter((x: string) => x !== setId);
        const map = { ...s.aoiAnnotationSetBindings };
        if (next.length) map[stacItemId] = next;
        else delete map[stacItemId];
        return { aoiAnnotationSetBindings: map };
      }),

    // ── Annotation set layer management ────────────────────────────────────
    addAnnotationSetLayer: ({
      setId,
      name,
      classStyles,
      parentLayerId,
      stacItemId,
      datasetId,
    }: {
      setId: string;
      name: string;
      classStyles?: Record<string, { fillColor: string; strokeColor: string; strokeWidth: number; fillOpacity: number }>;
      parentLayerId?: string;
      stacItemId?: string;
      datasetId?: string;
    }): string => {
      const id = `annset-${setId}`;
      const state = get();
      if (state.layers[id]) return id;

      const tileUrl = annotationSetsApi.getTileUrlTemplate(setId);

      // Z-order: just above parent raster if present, else use timestamp-based index
      let zIndex = Date.now() % 100000;
      if (parentLayerId && state.layers[parentLayerId]) {
        zIndex = state.layers[parentLayerId].zIndex + 0.5;
      }

      set((s: any) => ({
        layers: {
          ...s.layers,
          [id]: {
            id,
            name,
            type: 'annotation' as const,
            sourceType: 'annotation_set' as const,
            visible: true,
            opacity: 1,
            style: { ...DEFAULT_ANNOTATION_STYLE },
            zIndex,
            tileFormat: 'mvt' as const,
            mvtLayerName: 'annotation_set_mvt',
            tileUrl,
            annotationSetId: setId,
            classStyles,
            parentDatasetId: parentLayerId,
            stacItemId,
          },
        },
      }));

      if (stacItemId) get().bindAnnotationSetToStacItem(stacItemId, setId);
      void datasetId; // reserved for dataset-level attachment metadata
      return id;
    },

    removeAnnotationSetLayer: (setId: string) => {
      const id = `annset-${setId}`;
      const layer = get().layers[id];
      if (layer?.stacItemId) get().unbindAnnotationSetFromStacItem(layer.stacItemId, setId);
      get().removeLayer(id);
    },
  };
}
