import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AnnotationStatus, AnnotationSource } from '@/types/api';

interface AnnotationFilters {
  label: string;
  status: AnnotationStatus | '';
  source: AnnotationSource | '';
  datasetItemId: string;
  bboxFilter: [number, number, number, number] | null; // [minLng, minLat, maxLng, maxLat]
}

interface FilterState {
  annotations: AnnotationFilters;
  setAnnotationFilter: <K extends keyof AnnotationFilters>(
    key: K,
    value: AnnotationFilters[K]
  ) => void;
  resetAnnotationFilters: () => void;
}

const DEFAULT_ANNOTATION_FILTERS: AnnotationFilters = {
  label: '',
  status: '',
  source: '',
  datasetItemId: '',
  bboxFilter: null,
};

export const useFilterStore = create<FilterState>()(
  persist(
    (set) => ({
      annotations: DEFAULT_ANNOTATION_FILTERS,

      setAnnotationFilter: (key, value) =>
        set((s) => ({
          annotations: { ...s.annotations, [key]: value },
        })),

      resetAnnotationFilters: () =>
        set({ annotations: DEFAULT_ANNOTATION_FILTERS }),
    }),
    {
      name: 'awakeforest-filters',
      partialize: (s) => ({ annotations: s.annotations }),
    }
  )
);
