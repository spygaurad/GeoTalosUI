import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { GeoJSONGeometry } from '@/types/geo';
import type L from 'leaflet';

export type BasemapId = 'osm' | 'satellite' | 'light' | 'dark';
export type DrawTool = 'point' | 'polyline' | 'polygon' | 'rectangle' | 'circle';

interface MapState {
  center: [number, number];
  zoom: number;
  activeBasemapId: BasemapId;
  activeDrawTool: DrawTool | null;
  cursorLatLng: [number, number] | null;
  drawnGeometry: GeoJSONGeometry | null;
  // Shape type and extra data from the last Geoman pm:create event
  drawnShapeType: DrawTool | null;
  drawnCircleRadius: number | null; // metres, only when drawnShapeType === 'circle'
  /**
   * Reactive flag — true once LeafletMap mounts and setMapInstance() is called.
   * Components that need the L.Map instance (e.g. DatasetFootprintLayer) subscribe
   * to this so their effects re-run if Leaflet initialises after TileJSON resolves.
   * NOTE: the actual L.Map object is intentionally NOT stored here — see CLAUDE.md.
   */
  mapReady: boolean;
  setCenter: (center: [number, number], zoom?: number) => void;
  setActiveBasemapId: (id: BasemapId) => void;
  setActiveDrawTool: (tool: DrawTool | null) => void;
  setCursorLatLng: (latlng: [number, number] | null) => void;
  setDrawnGeometry: (geo: GeoJSONGeometry | null) => void;
  setDrawnShapeInfo: (type: DrawTool, circleRadius?: number) => void;
}

export const useMapStore = create<MapState>()(
  subscribeWithSelector((set) => ({
    center: [0, 20],
    zoom: 3,
    activeBasemapId: 'osm',
    activeDrawTool: null,
    cursorLatLng: null,
    drawnGeometry: null,
    drawnShapeType: null,
    drawnCircleRadius: null,
    mapReady: false,

    setCenter: (center, zoom) =>
      set((s) => ({ center, zoom: zoom !== undefined ? zoom : s.zoom })),
    setActiveBasemapId: (activeBasemapId) => set({ activeBasemapId }),
    setActiveDrawTool: (activeDrawTool) => set({ activeDrawTool }),
    setCursorLatLng: (cursorLatLng) => set({ cursorLatLng }),
    setDrawnGeometry: (drawnGeometry) =>
      set((_s) => ({
        drawnGeometry,
        // Clear shape info when geometry is cleared
        ...(drawnGeometry === null
          ? { drawnShapeType: null, drawnCircleRadius: null }
          : {}),
      })),
    setDrawnShapeInfo: (type, circleRadius) =>
      set({ drawnShapeType: type, drawnCircleRadius: circleRadius ?? null }),
  }))
);

// Non-reactive map instance — never store L.Map as Zustand state (CLAUDE.md)
let _mapInstance: L.Map | null = null;
export function setMapInstance(m: L.Map | null): void {
  _mapInstance = m;
  // Update the reactive `mapReady` flag so components subscribed to it
  // re-run their effects when Leaflet initialises (or tears down).
  useMapStore.setState({ mapReady: !!m });
}
export function getMapInstance(): L.Map | null {
  return _mapInstance;
}
