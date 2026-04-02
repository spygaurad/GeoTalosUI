import { create } from 'zustand';
import type { GeoJSONGeometry } from '@/types/geo';

type SelectedFeatureType =
  | 'dataset_item'
  | 'annotation'
  | 'tracked_object'
  | 'alert'
  | null;

type DrawMode = 'off' | 'polygon' | 'rectangle' | 'point';

interface MapState {
  // Viewport
  center: [number, number]; // [lat, lng]
  zoom: number;

  // Layers
  visibleLayers: string[];
  activeBasemapId: string | null;

  // Selection
  selectedFeatureId: string | null;
  selectedFeatureType: SelectedFeatureType;

  // Draw
  drawMode: DrawMode;
  drawnGeometry: GeoJSONGeometry | null;

  // Actions
  setCenter: (center: [number, number], zoom?: number) => void;
  toggleLayer: (layerId: string) => void;
  setActiveBasemap: (id: string | null) => void;
  selectFeature: (id: string, type: SelectedFeatureType) => void;
  clearSelection: () => void;
  setDrawMode: (mode: DrawMode) => void;
  setDrawnGeometry: (geom: GeoJSONGeometry | null) => void;
}

const DEFAULT_CENTER: [number, number] = [
  parseFloat(process.env.NEXT_PUBLIC_MAP_DEFAULT_CENTER_LAT ?? '-3.4653'),
  parseFloat(process.env.NEXT_PUBLIC_MAP_DEFAULT_CENTER_LNG ?? '-62.2159'),
];
const DEFAULT_ZOOM = parseInt(process.env.NEXT_PUBLIC_MAP_DEFAULT_ZOOM ?? '5');

export const useMapStore = create<MapState>((set) => ({
  center: DEFAULT_CENTER,
  zoom: DEFAULT_ZOOM,
  visibleLayers: [],
  activeBasemapId: null,
  selectedFeatureId: null,
  selectedFeatureType: null,
  drawMode: 'off',
  drawnGeometry: null,

  setCenter: (center, zoom) =>
    set((s) => ({ center, zoom: zoom ?? s.zoom })),

  toggleLayer: (layerId) =>
    set((s) => ({
      visibleLayers: s.visibleLayers.includes(layerId)
        ? s.visibleLayers.filter((id) => id !== layerId)
        : [...s.visibleLayers, layerId],
    })),

  setActiveBasemap: (id) => set({ activeBasemapId: id }),

  selectFeature: (id, type) =>
    set({ selectedFeatureId: id, selectedFeatureType: type }),

  clearSelection: () =>
    set({ selectedFeatureId: null, selectedFeatureType: null }),

  setDrawMode: (mode) => set({ drawMode: mode }),

  setDrawnGeometry: (geom) => set({ drawnGeometry: geom }),
}));
