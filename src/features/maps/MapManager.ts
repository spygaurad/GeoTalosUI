/**
 * MapManager — Imperative singleton bridge between Zustand state and Leaflet.
 *
 * Rules:
 * - This is NOT Zustand state. It's a module-level singleton.
 * - All Leaflet layer instances live here — never in React state or Zustand.
 * - React components call MapManager methods via useMapSync or direct access.
 * - MapManager never triggers React re-renders — it only mutates Leaflet.
 */

import type L from 'leaflet';
import type { LayerConfig, LayerStyle } from './types';
import type { Annotation, TrackedObject, Alert } from '@/types/api';
import type { GeoJSONGeometry } from '@/types/geo';
import type { GeoJSONFeatureCollection } from '@/lib/api/annotation-sets';
import { useMapLayersStore, markFeatureClick } from '@/stores/mapLayersStore';
import { getAuthToken } from '@/lib/api/client';
import { PRIORITY_COLORS, ALERT_STATUS_COLORS } from './mapColors';
import { computeGeoStats, fmtCoord } from './utils/geoStats';
import {
  extractClassIdFromProperties,
  resolveClassStyle,
  extractConfidence,
  confidenceColor,
} from './utils/annotationStyles';
import { DEFAULT_ANNOTATION_FILTER } from './types';
import { areaM2 } from '@/lib/geo';
import {
  createPointerMarker,
  getPointerType,
  isPointerVisibleAtZoom,
  POINTER_CONFIGS,
  highlightPointer,
  unhighlightPointer,
  updatePointerColor,
} from './mapPointers';

// ── Singleton ────────────────────────────────────────────────────────────────

let _instance: MapManager | null = null;

export function getMapManager(): MapManager {
  if (!_instance) _instance = new MapManager();
  return _instance;
}

// ── Alert helpers (ported from AlertMarkers.tsx) ─────────────────────────────

const SEVERITY_SIZES: Record<string, number> = {
  critical: 14,
  warning: 11,
  info: 8,
};

function makePinSvg(color: string, size: number): string {
  const h = size * 1.6;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size * 2}" height="${h}" viewBox="0 0 ${size * 2} ${h}">
    <circle cx="${size}" cy="${size}" r="${size - 1}" fill="${color}" stroke="rgba(0,0,0,0.4)" stroke-width="1.5"/>
    <line x1="${size}" y1="${size * 2 - 1}" x2="${size}" y2="${h}" stroke="${color}" stroke-width="2"/>
  </svg>`;
}

// ── Geometry helpers ─────────────────────────────────────────────────────────

/** Ray-casting point-in-ring test. Coordinates are [lng, lat]. */
function ringContains(ring: number[][], lng: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect =
      ((yi > lat) !== (yj > lat)) &&
      (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Point-in-polygon test (Polygon / MultiPolygon), honoring interior rings (holes).
 * Coordinates are [lng, lat]. Non-polygon geometries return false.
 */
function pointInGeometry(lng: number, lat: number, geom: GeoJSONGeometry): boolean {
  const pointInPolygon = (rings: number[][][]): boolean => {
    if (!rings[0] || !ringContains(rings[0], lng, lat)) return false;
    // Inside the exterior ring — exclude points that fall inside a hole.
    for (let i = 1; i < rings.length; i++) {
      if (ringContains(rings[i], lng, lat)) return false;
    }
    return true;
  };

  if (geom.type === 'Polygon') {
    return pointInPolygon(geom.coordinates as number[][][]);
  }
  if (geom.type === 'MultiPolygon') {
    return (geom.coordinates as number[][][][]).some(pointInPolygon);
  }
  return false;
}

function extractLatLng(geom: GeoJSONGeometry | null): [number, number] | null {
  if (!geom) return null;
  if (geom.type === 'Point') {
    const [lng, lat] = geom.coordinates;
    return [lat, lng];
  }
  if (geom.type === 'Polygon' && geom.coordinates[0]?.length > 0) {
    const ring = geom.coordinates[0];
    const lat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
    const lng = ring.reduce((s, c) => s + c[0], 0) / ring.length;
    return [lat, lng];
  }
  return null;
}

/** Average a flat list of [lng, lat] coords into a [lat, lng] centroid. */
function avgLatLng(pts: number[][]): [number, number] | null {
  if (!pts.length) return null;
  let lat = 0, lng = 0;
  for (const p of pts) { lng += p[0]; lat += p[1]; }
  return [lat / pts.length, lng / pts.length];
}

/**
 * A representative [lat, lng] point for clustering. Handles every common
 * annotation geometry type (Point, Line, Polygon, and their Multi variants),
 * unlike {@link extractLatLng} which only covers Point/Polygon.
 */
function geometryCentroid(geom: GeoJSONGeometry | null): [number, number] | null {
  if (!geom) return null;
  switch (geom.type) {
    case 'Point': {
      const [lng, lat] = geom.coordinates;
      return [lat, lng];
    }
    case 'LineString':
      return avgLatLng(geom.coordinates as number[][]);
    case 'Polygon':
      return avgLatLng((geom.coordinates as number[][][])[0] ?? []);
    case 'MultiPolygon':
      return avgLatLng((geom.coordinates as number[][][][])[0]?.[0] ?? []);
    default:
      return null;
  }
}

/** Zoom level below which annotation sets render as clusters instead of geometry. */
const ANNOTATION_CLUSTER_ZOOM = 16;

/**
 * Minimum on-screen size (px), measured at {@link ANNOTATION_CLUSTER_ZOOM}, for
 * an annotation to count as a real area that always renders as geometry instead
 * of collapsing into a cluster bubble. Sub-threshold features (points and tiny
 * sub-pixel masks) stay cluster-eligible below the zoom threshold. This is a
 * fast area proxy — it uses the feature's bbox span rather than computing true
 * polygon area (which is far costlier over thousands of features).
 */
const ANNOTATION_MIN_GEOMETRY_PX = 8;

/** Web-Mercator pixels per degree of longitude at a given zoom (256px tiles). */
function mercatorPxPerDegree(zoom: number): number {
  return (256 * 2 ** zoom) / 360;
}

/**
 * Largest bbox span (degrees) of a geometry — max of its lng and lat extent.
 * O(coords), no turf. Used as a cheap stand-in for "how big is this feature"
 * when deciding whether it should cluster or render as geometry. Points return
 * 0; the caller treats point-like geometries as always cluster-eligible.
 */
function geometryBboxSpanDeg(geom: GeoJSONGeometry | null): number {
  if (!geom) return 0;
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  const visit = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') {
      const [lng, lat] = c as [number, number];
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    } else if (Array.isArray(c)) {
      for (const sub of c) visit(sub);
    }
  };
  visit((geom as { coordinates?: unknown }).coordinates);
  if (minLng === Infinity) return 0;
  return Math.max(maxLng - minLng, maxLat - minLat);
}

/** Radius (px) for annotation point markers — small dot, not a large circle. */
const ANNOTATION_POINT_RADIUS = 4;

// ── AOI Double-buffer interface ──────────────────────────────────────────────
interface AoiDoubleBuffer {
  front: L.TileLayer;
  back: L.TileLayer;
  backHasUrl: boolean;
  backReady: boolean;       // true when all back buffer tiles are loaded
  transitioning: boolean;   // true during an active CSS crossfade
  pendingCommit: boolean;   // true when commit requested but tiles not yet ready
  loadGen: number;          // increments each preload call — prevents stale events
}

// ── MapManager class ─────────────────────────────────────────────────────────

export class MapManager {
  private map: L.Map | null = null;
  private leafletLayers = new Map<string, L.Layer>();
  /** Raw data for GeoJSON-type layers (annotations, tracking, alerts, footprints) */
  private dataStore = new Map<string, unknown>();
  /** Tracks which layers are currently added to the map (vs hidden) */
  private onMap = new Set<string>();
  /** Reference to Leaflet module (loaded once in init) */
  private L: typeof import('leaflet') | null = null;
  /** Pointer markers for dataset layers */
  private pointerLayers = new Map<string, L.Marker>();
  /** LayerGroup that owns each pointer (for add/remove within the group) */
  private pointerParentGroups = new Map<string, L.LayerGroup>();
  /** Tracks which pointers are currently visible (zoom-based) */
  private visiblePointers = new Set<string>();
  /** Currently selected/highlighted layer ID */
  private selectedLayerId: string | null = null;
  /** Handler for the on-map verify/delete actions shown in the annotation
   *  action popup. Registered by MapEditorShell so the API calls run in React
   *  (react-query + toast), keeping MapManager free of data-layer concerns. */
  private annotationActionHandler:
    | ((
        action: 'verify' | 'delete',
        ctx: {
          annotationSetId?: string;
          annotationId?: string;
          properties?: Record<string, unknown>;
          layerId: string;
        },
      ) => void)
    | null = null;
  /** AOI clip-path update functions — keyed by layer ID, cleaned up on removeLayer */
  private aoiClipListeners = new Map<string, () => void>();
  /** Double-buffered tile layers for smooth AOI temporal animations */
  private aoiDoubleBuffers = new Map<string, AoiDoubleBuffer>();
  /** AbortControllers for in-flight authenticated tile fetches, keyed by layer ID */
  private tileAbortControllers = new Map<string, Set<AbortController>>();

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  init(map: L.Map): void {
    this.map = map;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    this.L = require('leaflet') as typeof import('leaflet');
    
    // Create custom panes with explicit z-indices
    // awakeforest-basemap (z: 0) ← always behind data
    // awakeforest-data (z: 100) ← dataset raster/vector tiles
    // awakeforest-annotations (z: 150) ← annotation layers (always above datasets)
    // awakeforest-pointers (z: 200) ← layer pointer markers
    try {
      if (!map.getPane('awakeforest-basemap')) {
        const pane = map.createPane('awakeforest-basemap');
        (pane as HTMLElement).style.zIndex = '0';
      }
      if (!map.getPane('awakeforest-data')) {
        const pane = map.createPane('awakeforest-data');
        (pane as HTMLElement).style.zIndex = '100';
      }
      if (!map.getPane('awakeforest-annotations')) {
        const pane = map.createPane('awakeforest-annotations');
        (pane as HTMLElement).style.zIndex = '150';
      }
      if (!map.getPane('awakeforest-pointers')) {
        const pane = map.createPane('awakeforest-pointers');
        (pane as HTMLElement).style.zIndex = '200';
      }
    } catch (e) {
      // Pane creation might fail during early initialization
    }
  }

  destroy(): void {
    // Remove all managed layers
    for (const [id] of this.leafletLayers) {
      this.removeLayer(id);
    }
    this.leafletLayers.clear();
    this.dataStore.clear();
    this.onMap.clear();
    this.aoiDoubleBuffers.clear();
    this.aoiClipListeners.clear();
    this.tileAbortControllers.clear();
    this.map = null;
    this.L = null;
  }

  getMap(): L.Map | null {
    return this.map;
  }

  // ── Stub methods for features not yet implemented ────────────────────────────

  hasError(_id: string): boolean {
    // TODO: implement error tracking
    return false;
  }

  retryLayer(_id: string): void {
    // TODO: implement layer retry
  }

  get online(): boolean {
    // TODO: implement online status tracking
    return true;
  }

  registerViewportCallback(_id: string, _callback: () => void): void {
    // TODO: implement viewport change callbacks
  }

  // ── Layer lifecycle ────────────────────────────────────────────────────────

  /**
   * Add or replace a layer. Called by useMapSync when a new LayerConfig appears.
   * For tile layers, this creates the Leaflet tile layer immediately.
   * For data layers (annotation/tracking/alert), this creates the layer only
   * if data has already been pushed via setLayerData.
   */
  addLayer(config: LayerConfig): void {
    if (!this.map || !this.L) return;

    // Remove existing layer with this id first
    if (this.leafletLayers.has(config.id)) {
      this.removeLayerFromMap(config.id);
    }

    const layer = this.createLayer(config);
    if (!layer) return;

    this.leafletLayers.set(config.id, layer);

    if (config.visible) {
      layer.addTo(this.map);
      this.onMap.add(config.id);
    }
  }

  removeLayer(id: string): void {
    // Abort all in-flight authenticated tile fetches for this layer immediately.
    // This is the primary fix for ghost tile requests after layer removal.
    const controllers = this.tileAbortControllers.get(id);
    if (controllers) {
      for (const ctrl of controllers) ctrl.abort();
      this.tileAbortControllers.delete(id);
    }

    this.cleanupAoiClip(id);

    // Clean up double buffer if this is an AOI child layer
    const buf = this.aoiDoubleBuffers.get(id);
    if (buf && this.map) {
      if (this.map.hasLayer(buf.back)) {
        this.map.removeLayer(buf.back);
      }
    }
    this.aoiDoubleBuffers.delete(id);

    // If removing an AOI layer, also remove any child layers that reference it
    const layer = this.leafletLayers.get(id);
    if (layer) {
      const config = useMapLayersStore.getState().layers[id];
      if (config?.type === 'aoi') {
        // Find all child layers that have this AOI as parent
        const layerState = useMapLayersStore.getState().layers;
        for (const [childId, childConfig] of Object.entries(layerState)) {
          if (childConfig.parentAoiId === id) {
            this.removeLayerFromMap(childId);
            this.leafletLayers.delete(childId);
            this.dataStore.delete(childId);
          }
        }
      }
    }

    this.removeLayerFromMap(id);
    this.leafletLayers.delete(id);
    this.dataStore.delete(id);
  }

  // ── Layer property updates ─────────────────────────────────────────────────

  setLayerVisible(id: string, visible: boolean): void {
    if (!this.map) return;
    const layer = this.leafletLayers.get(id);
    if (!layer) return;

    // Also manage back buffer visibility for double-buffered AOI child layers
    const buf = this.aoiDoubleBuffers.get(id);

    if (visible && !this.onMap.has(id)) {
      layer.addTo(this.map);
      this.onMap.add(id);
      if (buf && !this.map.hasLayer(buf.back)) {
        buf.back.addTo(this.map);
      }
    } else if (!visible && this.onMap.has(id)) {
      // Ensure complete removal from map
      if (this.map.hasLayer(layer)) {
        this.map.removeLayer(layer);
      }
      if (buf && this.map.hasLayer(buf.back)) {
        this.map.removeLayer(buf.back);
      }
      this.onMap.delete(id);

      // Force DOM cleanup for tile layers
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyLayer = layer as any;

      // Remove main container
      if (anyLayer._container) {
        const container = anyLayer._container;
        if (container.parentNode) {
          container.parentNode.removeChild(container);
        }
        // Also clear display
        container.style.display = 'none';
        container.style.visibility = 'hidden';
      }

      // For double buffer, also clean back container
      if (buf) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const backLayer = buf.back as any;
        if (backLayer._container) {
          const container = backLayer._container;
          if (container.parentNode) {
            try {
              container.parentNode.removeChild(container);
            } catch {
              // ignore
            }
          }
          container.style.display = 'none';
          container.style.visibility = 'hidden';
        }
      }

      // For LayerGroup, remove sublayer containers
      if (typeof anyLayer.eachLayer === 'function') {
        anyLayer.eachLayer((sublayer: any) => {
          if (sublayer._container) {
            const subContainer = sublayer._container;
            if (subContainer.parentNode) {
              try {
                subContainer.parentNode.removeChild(subContainer);
              } catch {
                // ignore
              }
            }
            subContainer.style.display = 'none';
            subContainer.style.visibility = 'hidden';
          }
        });
      }
    }
  }

  /**
   * Update the visual stacking order of a layer to match its zIndex.
   * For tile layers, calls setZIndex(). For vector (GeoJSON/SVG) layers,
   * re-orders all visible vector layers by their current zIndex values.
   */
  setLayerZIndex(id: string, zIndex: number): void {
    const layer = this.leafletLayers.get(id);
    if (!layer) return;

    // TileLayer has setZIndex for within-pane stacking
    if ('setZIndex' in layer && typeof (layer as L.TileLayer).setZIndex === 'function') {
      (layer as L.TileLayer).setZIndex(zIndex);
      return;
    }

    // LayerGroup wrapping a TileLayer (e.g. tile + pointer marker)
    if ('eachLayer' in layer && typeof (layer as L.LayerGroup).eachLayer === 'function') {
      let hasTile = false;
      (layer as L.LayerGroup).eachLayer((child) => {
        if ('setZIndex' in child && typeof (child as L.TileLayer).setZIndex === 'function') {
          (child as L.TileLayer).setZIndex(zIndex);
          hasTile = true;
        }
      });
      if (hasTile) return;
    }

    // GeoJSON/SVG layers: re-order all vector layers by zIndex
    this.reorderVectorLayers();
  }

  /**
   * Re-order all GeoJSON/SVG layers on the map by their Zustand zIndex.
   * Lower zIndex layers are brought forward first so higher-index layers
   * end up on top (bringToFront called in ascending zIndex order).
   */
  private reorderVectorLayers(): void {
    if (!this.map) return;
    const state = useMapLayersStore.getState().layers;
    const vectorEntries: Array<{ layer: L.Layer; zIndex: number }> = [];
    for (const [id, layer] of this.leafletLayers) {
      if (!this.onMap.has(id)) continue;
      if ('bringToFront' in layer && typeof (layer as L.GeoJSON).bringToFront === 'function') {
        vectorEntries.push({ layer, zIndex: state[id]?.zIndex ?? 0 });
      }
    }
    // Sort ascending so we bringToFront from lowest → highest, leaving highest on top
    vectorEntries.sort((a, b) => a.zIndex - b.zIndex);
    for (const { layer } of vectorEntries) {
      (layer as L.GeoJSON).bringToFront();
    }
  }

  setLayerOpacity(id: string, opacity: number): void {
    const layer = this.leafletLayers.get(id);
    if (!layer) return;

    // TileLayer has setOpacity
    if ('setOpacity' in layer && typeof (layer as L.TileLayer).setOpacity === 'function') {
      (layer as L.TileLayer).setOpacity(opacity);
      return;
    }

    // GeoJSON / LayerGroup — recompute BOTH stroke and fill opacity on every
    // child so the slider is actually visible (the old path left fillOpacity
    // untouched, so filled polygons/points never changed). Annotation sets
    // restyle per class via the live store config; other vector layers fall
    // back to a uniform opacity.
    const config = useMapLayersStore.getState().layers[id] ?? null;
    this.applyVectorOpacity(layer, config, opacity);
  }

  /** Recursively apply an opacity update across a vector layer tree. */
  private applyVectorOpacity(
    layer: L.Layer,
    config: LayerConfig | null,
    opacity: number,
  ): void {
    // Recurse into groups first (the GeoJSON layer and any pointer group) so we
    // never call setStyle on the container itself.
    if ('eachLayer' in layer && typeof (layer as L.LayerGroup).eachLayer === 'function') {
      (layer as L.LayerGroup).eachLayer((child) =>
        this.applyVectorOpacity(child, config, opacity),
      );
      return;
    }

    const isAnnotation = config?.sourceType === 'annotation_set';
    const props = (layer as { feature?: { properties?: Record<string, unknown> } })
      .feature?.properties;

    // Point markers — keep solid fill.
    if (this.L && layer instanceof this.L.CircleMarker) {
      const s = isAnnotation
        ? this.annotationPointStyle(config!, props)
        : { opacity, fillOpacity: opacity };
      (layer as L.CircleMarker).setStyle(s);
      return;
    }

    // Polygons / lines.
    if ('setStyle' in layer && typeof (layer as L.Path).setStyle === 'function') {
      const s = isAnnotation
        ? this.resolveAnnotationStyle(config!, props)
        : { opacity, fillOpacity: opacity };
      (layer as L.Path).setStyle(s);
      return;
    }

    // Icon markers (e.g. pointer) — only have setOpacity.
    if ('setOpacity' in layer && typeof (layer as L.Marker).setOpacity === 'function') {
      (layer as L.Marker).setOpacity(opacity);
    }
  }

  setLayerStyle(id: string, style: LayerStyle, config?: LayerConfig): void {
    const layer = this.leafletLayers.get(id);
    if (!layer) return;

    const opacity = config?.opacity ?? 1;

    // GeoJSON layers — update style
    if ('setStyle' in layer && typeof (layer as L.GeoJSON).setStyle === 'function') {
      (layer as L.GeoJSON).setStyle({
        color: style.color,
        fillColor: style.fillColor,
        fillOpacity: style.fillOpacity * opacity,
        weight: style.weight,
        dashArray: style.dashArray,
      });
    }

    // Update pointer color if it exists
    const pointer = this.pointerLayers.get(id);
    if (pointer && style.color) {
      updatePointerColor(pointer, style.color);
    }
  }

  /**
   * Re-apply per-feature annotation styling to an existing annotation_set
   * layer. Used when the visualization filter (confidence threshold, area,
   * color mode) changes so the change is reflected on the map without
   * rebuilding the whole GeoJSON layer.
   */
  restyleAnnotationLayer(id: string, config: LayerConfig): void {
    const layer = this.leafletLayers.get(id);
    if (!layer) return;
    this.restyleAnnotationChildren(layer, config);
  }

  private restyleAnnotationChildren(layer: L.Layer, config: LayerConfig): void {
    if ('eachLayer' in layer && typeof (layer as L.LayerGroup).eachLayer === 'function') {
      (layer as L.LayerGroup).eachLayer((child) =>
        this.restyleAnnotationChildren(child, config),
      );
      return;
    }

    const feature = (layer as { feature?: GeoJSON.Feature }).feature;
    const props = feature?.properties as Record<string, unknown> | undefined;
    const geometry = feature?.geometry as GeoJSONGeometry | undefined;

    if (this.L && layer instanceof this.L.CircleMarker) {
      (layer as L.CircleMarker).setStyle(
        this.annotationPointStyle(config, props, geometry),
      );
      return;
    }
    if ('setStyle' in layer && typeof (layer as L.Path).setStyle === 'function') {
      (layer as L.Path).setStyle(
        this.resolveAnnotationStyle(config, props, false, geometry),
      );
    }
  }

  // ── Data layer updates ─────────────────────────────────────────────────────

  /**
   * Push feature data for a layer. Used for annotation, tracking, alert,
   * and dataset footprint layers. Rebuilds the Leaflet layer with new data.
   */
  setLayerData(id: string, data: unknown): void {
    this.dataStore.set(id, data);

    // Only rebuild if we have a config for this layer
    const config = useMapLayersStore.getState().layers[id];
    if (!config) return;

    this.rebuildDataLayer(id, config);
  }

  /**
   * Rebuild a tile layer when tileUrl or tile config changes.
   */
  rebuildTileLayer(id: string, config: LayerConfig): void {
    if (!this.map || !this.L) return;

    this.cleanupAoiClip(id);
    this.removeLayerFromMap(id);

    const layer = config.parentAoiId
      ? this.createAoiChildTileLayer(config)
      : this.createTileLayer(config);
    if (!layer) return;

    this.leafletLayers.set(id, layer);
    if (config.visible) {
      layer.addTo(this.map);
      this.onMap.add(id);
    }
  }

  /**
   * Update a tile layer's URL in-place without destroying and recreating it.
   * Used for smooth AOI temporal animation — avoids tile flicker from layer rebuild.
   */
  setTileLayerUrl(id: string, url: string): void {
    const layer = this.leafletLayers.get(id);
    if (!layer) return;
    let tileLayer: L.TileLayer | null = null;
    if (typeof (layer as L.TileLayer).setUrl === 'function') {
      tileLayer = layer as L.TileLayer;
    } else if (typeof (layer as L.LayerGroup).eachLayer === 'function') {
      (layer as L.LayerGroup).eachLayer((child) => {
        if (typeof (child as L.TileLayer).setUrl === 'function') {
          tileLayer = child as L.TileLayer;
        }
      });
    }
    if (tileLayer) tileLayer.setUrl(url, false);
  }

  // ── AOI Double-Buffer: smooth temporal animation ────────────────────────────

  /**
   * Check if a layer has a double-buffer (for AOI timeline animations).
   */
  hasAoiDoubleBuffer(id: string): boolean {
    return this.aoiDoubleBuffers.has(id);
  }

  private static readonly FADE_MS = 600;

  /**
   * Preload the next frame's tiles into the back buffer invisibly.
   *
   * Uses the tile layer's `load` event for accurate readiness detection.
   * A generation counter (`loadGen`) prevents stale events from older preloads
   * triggering a commit after a newer URL has been set.
   *
   * If a `pendingCommit` was set (caller requested the frame before tiles were
   * ready), the commit fires automatically when tiles finish loading.
   */
  preloadNextAoiFrame(id: string, url: string): void {
    const buf = this.aoiDoubleBuffers.get(id);
    if (!buf) return;

    // Cancel any pending commit from the previous preload
    buf.pendingCommit = false;
    buf.backHasUrl = true;
    buf.backReady = false;
    const gen = ++buf.loadGen;

    buf.back.setUrl(url, false); // triggers tile loading at opacity 0

    const markReady = () => {
      const current = this.aoiDoubleBuffers.get(id);
      if (!current || current.loadGen !== gen || current.backReady) return;
      current.backReady = true;
      if (current.pendingCommit && !current.transitioning) {
        current.pendingCommit = false;
        this._doCommitFade(id);
      }
    };

    buf.back.once('load', markReady);
    // Fallback: guarantee commit eventually even if load event is slow/missing
    setTimeout(markReady, 900);
  }

  /**
   * Commit the next frame.
   *
   * Returns true in two cases:
   *   1. Back buffer is ready → starts CSS crossfade immediately.
   *   2. Back buffer still loading → sets pendingCommit so fade fires automatically
   *      when the `load` event arrives (no visual reload artifact).
   *
   * Returns false only when a crossfade is already in progress.
   * Caller should NOT call setTileLayerUrl in any case — this method owns the
   * double-buffer transition completely.
   */
  commitAoiFrame(id: string): boolean {
    const buf = this.aoiDoubleBuffers.get(id);
    if (!buf || buf.transitioning) return false;

    if (!buf.backReady) {
      // Tiles still loading — request a deferred commit via load event
      buf.pendingCommit = true;
      return true; // handled; caller must NOT fall back to setTileLayerUrl
    }

    buf.pendingCommit = false;
    this._doCommitFade(id);
    return true;
  }

  /**
   * Execute the crossfade from back → front using CSS opacity transition.
   * Uses double-rAF to ensure the transition property is computed by the
   * browser before the opacity value changes (avoids instant-snap bug).
   */
  private _doCommitFade(id: string): void {
    const buf = this.aoiDoubleBuffers.get(id);
    if (!buf || buf.transitioning) return;

    buf.transitioning = true;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const frontEl = (buf.front as any)._container as HTMLElement | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const backEl = (buf.back as any)._container as HTMLElement | undefined;

    // First rAF: apply transition property
    requestAnimationFrame(() => {
      const current = this.aoiDoubleBuffers.get(id);
      if (!current || !current.transitioning) return;
      if (frontEl) frontEl.style.transition = `opacity ${MapManager.FADE_MS}ms ease-in-out`;
      if (backEl) backEl.style.transition = `opacity ${MapManager.FADE_MS}ms ease-in-out`;

      // Second rAF: browser has computed transition — now change opacity to animate
      requestAnimationFrame(() => {
        const c = this.aoiDoubleBuffers.get(id);
        if (!c || !c.transitioning) return;
        c.back.setOpacity(1);
        c.front.setOpacity(0);
      });
    });

    const { front, back } = buf;

    setTimeout(() => {
      const current = this.aoiDoubleBuffers.get(id);
      if (!current) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (frontEl) frontEl.style.transition = '';
      if (backEl) backEl.style.transition = '';
      current.front = back;
      current.back = front;
      current.backHasUrl = false;
      current.backReady = false;
      current.transitioning = false;
    }, MapManager.FADE_MS + 100);
  }

  /**
   * Returns true if a crossfade is currently in progress for this layer.
   * Callers should skip frame advances while transitioning to avoid interrupting the fade.
   */
  isAoiTransitioning(id: string): boolean {
    return this.aoiDoubleBuffers.get(id)?.transitioning ?? false;
  }

  /**
   * Immediately apply a new tile URL to a double-buffered AOI child layer
   * without a crossfade. Used for user-driven re-renders (band selection,
   * preset, item switch) — which change `tileUrl` in the store but are NOT
   * timeline frame advances, so they must not go through the fade pipeline.
   *
   * Updates both front (visible) and back (preload) buffers so a subsequent
   * timeline crossfade starts from the correct rendering.
   */
  setAoiDoubleBufferUrl(id: string, url: string): void {
    const buf = this.aoiDoubleBuffers.get(id);
    if (!buf) return;
    buf.front.setUrl(url, false);
    buf.back.setUrl(url, false);
    buf.backHasUrl = false;
    buf.backReady = false;
  }

  // ── View controls ──────────────────────────────────────────────────────────

  fitBounds(bounds: [number, number, number, number], options?: L.FitBoundsOptions): void {
    if (!this.map) return;
    const [west, south, east, north] = bounds;
    this.map.fitBounds(
      [[south, west], [north, east]],
      { padding: [40, 40], maxZoom: 16, ...options }
    );
  }

  /**
   * Like {@link fitBounds}, but only ever zooms IN — never out. Used for
   * click-to-select focus: if the current view is already zoomed in tighter
   * than the bounds' fit-zoom, the view is left untouched (the caller still
   * selects the layer). Otherwise it frames the bounds (maxZoom 16).
   */
  fitBoundsInward(bounds: [number, number, number, number], options?: L.FitBoundsOptions): void {
    if (!this.map || !this.L) return;
    const [west, south, east, north] = bounds;
    const llb = this.L.latLngBounds([[south, west], [north, east]]);
    const fitMaxZoom = (options?.maxZoom as number | undefined) ?? 16;
    // getBoundsZoom is clamped to the map's maxZoom (22), not our fit cap, so a
    // small AOI can report a zoom well above 16. The zoom fitBounds would
    // actually apply is min(boundsZoom, fitMaxZoom) — compare against THAT so we
    // never zoom out to the cap when already zoomed in past it.
    const boundsZoom = this.map.getBoundsZoom(llb, false, this.L.point(40, 40));
    const effectiveZoom = Math.min(boundsZoom, fitMaxZoom);
    if (effectiveZoom <= this.map.getZoom()) return;
    this.map.fitBounds(llb, { padding: [40, 40], maxZoom: fitMaxZoom, ...options });
  }

  flyTo(center: [number, number], zoom?: number): void {
    if (!this.map) return;
    this.map.flyTo(center, zoom ?? this.map.getZoom());
  }

  // ── Has layer check ────────────────────────────────────────────────────────

  hasLayer(id: string): boolean {
    return this.leafletLayers.has(id);
  }

  // ── Internal: layer creation ───────────────────────────────────────────────

  private createLayer(config: LayerConfig): L.Layer | null {
    // AOI boundary layers — dashed polygon outline
    if (config.type === 'aoi' && config.aoiGeometry) {
      return this.createAoiLayer(config);
    }

    // Raster mask annotation-set layers render via TiTiler (authenticated tile layer).
    // They do NOT use the GeoJSON/MVT path — the server applies the colormap and
    // returns PNG tiles directly from the /tiles/raster-masks/{id}/... endpoint.
    if (config.sourceType === 'annotation_set' && config.isRasterMask && config.tileUrl) {
      const tileLayer = this.createAuthTileLayer(config.tileUrl, config, 'awakeforest-annotations');
      if (config.tileBounds) {
        return this.createLayerWithPointer(tileLayer, config);
      }
      return tileLayer;
    }

    // Vector annotation-set layers always use GeoJSON rendering (L.geoJSON) regardless
    // of whether a tileUrl is present. The tileUrl is kept in the config only for
    // the pointer/bounds mechanism; actual vector rendering goes through the
    // GeoJSON path which works reliably with Leaflet's standard SVG renderer.
    if (config.sourceType === 'annotation_set') {
      const data = this.dataStore.get(config.id) as GeoJSONFeatureCollection | undefined;
      if (!data) return null;
      // No felt-pin pointer wrapping here: the cluster layer built inside
      // createAnnotationSetLayer is the low-zoom (< ANNOTATION_CLUSTER_ZOOM)
      // representation, so a single bounds pin would be redundant with the
      // count bubbles. Raster-mask sets still go through the tile path above.
      return this.createAnnotationSetLayer(config, data);
    }

    // AOI-bounded child dataset layers — use dedicated clipped pane
    if (config.parentAoiId && config.tileUrl) {
      return this.createAoiChildTileLayer(config);
    }

    // Regular tile-based layers
    if (config.tileUrl) {
      return this.createTileLayer(config);
    }

    // Data-backed layers — check if data has been pushed
    const data = this.dataStore.get(config.id);
    if (!data) return null;

    return this.createDataLayer(config, data);
  }

  private createTileLayer(config: LayerConfig): L.Layer | null {
    if (!this.L || !config.tileUrl) return null;

    // MVT vector tiles (annotation sets) take a separate path — rendered via
    // leaflet.vectorgrid on the annotations pane with per-class styling.
    if (config.tileFormat === 'mvt') {
      return this.createMvtLayer(config);
    }

    const needsAuth = config.sourceType === 'dataset' || config.sourceType === 'stac_item';
    const leafletBounds = this.getLeafletTileBounds(config);

    const tileLayer = needsAuth
      ? this.createAuthTileLayer(config.tileUrl, config)
      : this.L.tileLayer(config.tileUrl, {
          pane: 'awakeforest-data',
          opacity: config.opacity,
          minZoom: config.tileMinZoom ?? 0,
          maxZoom: config.tileMaxZoom ?? 24,
          tileSize: 256,
          ...(leafletBounds ? { bounds: leafletBounds } : {}),
        });

    // If layer has bounds, wrap in LayerGroup with pointer marker
    if (config.tileBounds) {
      return this.createLayerWithPointer(tileLayer, config);
    }

    return tileLayer;
  }

  private createAuthTileLayer(url: string, config: LayerConfig, paneName = 'awakeforest-data'): L.TileLayer {
    const L = this.L!;
    const leafletBounds = this.getLeafletTileBounds(config);

    // Register an AbortController set for this layer so in-flight fetches can be
    // cancelled immediately when the layer is removed (prevents ghost tile requests).
    const layerId = config.id;
    if (!this.tileAbortControllers.has(layerId)) {
      this.tileAbortControllers.set(layerId, new Set());
    }
    const layerControllers = this.tileAbortControllers.get(layerId)!;

    type TileLayerCtor = new (url: string, opts?: L.TileLayerOptions) => L.TileLayer;

    // Subclass TileLayer to inject Clerk JWT via fetch + blob URL
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const AuthTileLayer = (L.TileLayer as any).extend({
      createTile(coords: L.Coords, done: L.DoneCallback) {
        const img = L.DomUtil.create('img', 'leaflet-tile') as HTMLImageElement;
        img.alt = '';

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tileUrl = (this as any).getTileUrl(coords) as string;

        const controller = new AbortController();
        layerControllers.add(controller);

        getAuthToken()
          .then((token) => {
            const init: RequestInit = { signal: controller.signal };
            if (token) init.headers = { Authorization: `Bearer ${token}` };
            return fetch(tileUrl, init);
          })
          .then((r) => {
            if (!r.ok) throw new Error(`Tile ${r.status}`);
            return r.blob();
          })
          .then((blob) => {
            layerControllers.delete(controller);
            const objUrl = URL.createObjectURL(blob);
            img.onload = () => { URL.revokeObjectURL(objUrl); done(undefined, img); };
            img.onerror = () => { URL.revokeObjectURL(objUrl); done(new Error('tile load'), img); };
            img.src = objUrl;
          })
          .catch((e) => {
            layerControllers.delete(controller);
            if ((e as Error).name === 'AbortError') return; // layer removed — silently drop
            done(e as Error, img);
          });

        return img;
      },
    }) as TileLayerCtor;

    return new AuthTileLayer(url, {
      pane: paneName,
      opacity: config.opacity,
      minZoom: config.tileMinZoom ?? 0,
      maxZoom: config.tileMaxZoom ?? 24,
      tileSize: 256,
      ...(leafletBounds ? { bounds: leafletBounds } : {}),
    });
  }

  // ── Annotation set: MVT vector tile layer ───────────────────────────────────

  /**
   * Create a Leaflet.VectorGrid.Protobuf layer for an annotation-set MVT
   * endpoint. Uses the `awakeforest-annotations` pane (z:150) so it draws on
   * top of raster tiles. Fetches tiles through a Clerk-authed subclass that
   * mirrors the pattern in `createAuthTileLayer`.
   */
  private createMvtLayer(config: LayerConfig): L.Layer | null {
    if (!this.L || !config.tileUrl || !config.mvtLayerName) return null;
    const L = this.L;
    // leaflet.vectorgrid is a UMD bundle that expects a global `L` at
    // eval time. Expose Leaflet on window, then require the plugin lazily
    // (first call only). Subsequent calls reuse L.vectorGrid.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof window !== 'undefined' && !(window as any).L) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).L = L;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!(L as any).vectorGrid) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('leaflet.vectorgrid');
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Failed to load leaflet.vectorgrid', err);
        return null;
      }
    }
    const layerName = config.mvtLayerName;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vectorGrid: any = (L as any).vectorGrid;
    if (!vectorGrid?.protobuf) {
      // eslint-disable-next-line no-console
      console.error('leaflet.vectorgrid is not loaded');
      return null;
    }

    // Inject the Clerk Bearer token into annotation tile requests by wrapping
    // window.fetch once. This is simpler and more reliable than subclassing
    // L.VectorGrid.Protobuf, and avoids rendering failures from prototype
    // extension issues in minified builds.
    // The interceptor only adds the header for our annotation tile URLs;
    // all other requests pass through unchanged.
    if (typeof window !== 'undefined' && !(window as any).__awfAnnotationFetchWrapped) {
      const _origFetch = window.fetch.bind(window);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
        const url = typeof input === 'string' ? input
          : input instanceof URL ? input.toString()
          : (input as Request).url;
        if (url.includes('/annotation-sets/') && url.includes('/tiles/')) {
          const token = await getAuthToken();
          if (token) {
            const headers = new Headers((init as RequestInit | undefined)?.headers);
            headers.set('Authorization', `Bearer ${token}`);
            init = { ...(init ?? {}), headers };
          }
        }
        return _origFetch(input, init);
      };
      (window as any).__awfAnnotationFetchWrapped = true;
    }

    const vg = vectorGrid.protobuf(config.tileUrl, {
      pane: 'awakeforest-annotations',
      interactive: true,
      maxNativeZoom: config.tileMaxZoom ?? 22,
      minZoom: config.tileMinZoom ?? 0,
      vectorTileLayerStyles: {
        [layerName]: (properties: Record<string, unknown>) => {
          return this.resolveAnnotationStyle(config, properties, true);
        },
      },
    }) as L.Layer;

    // Wire click → right panel. VectorGrid fires `click` with `layer.properties`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (vg as any).on('click', (e: any) => {
      L.DomEvent.stopPropagation(e);
      markFeatureClick();
      const props = (e.layer?.properties ?? {}) as Record<string, unknown>;
      const annotationId = (props.id ?? '') as string;
      const classId = extractClassIdFromProperties(props);
      useMapLayersStore.getState().openFeaturePanel({
        layerType: 'annotation',
        featureType: 'annotation-mvt',
        featureId: annotationId || config.id,
        properties: {
          ...props,
          _annotation_set_id: config.annotationSetId,
          _annotation_id: annotationId || undefined,
          _class_id: classId,
          // Signal to the right panel that full feature data must be fetched
          // via annotationsApi.getById(annotationId) when entering edit mode.
          _mvt: true,
        },
        latlng: [e.latlng.lat, e.latlng.lng],
        layerRef: e.layer,
        layerId: config.id,
      });

      const label = (props.class_name ?? props.label ?? 'Annotation') as string;
      const subHtml = props.confidence != null
        ? `<div class="af-popup-sub">Confidence: ${(Number(props.confidence) * 100).toFixed(0)}%</div>`
        : '';
      this.openAnnotationActionPopup(e.latlng, label, subHtml, {
        annotationSetId: config.annotationSetId,
        annotationId: annotationId || undefined,
        properties: props,
        layerId: config.id,
      });
    });

    // Wrap in a LayerGroup with a pointer marker when bounds are known.
    if (config.tileBounds) {
      return this.createLayerWithPointer(vg as unknown as L.Layer, config);
    }
    return vg;
  }

  // ── AOI child layer: dedicated clip pane ────────────────────────────────────

  /**
   * Create a double-buffered raster tile layer for an AOI-bounded child dataset.
   * Uses a dedicated Leaflet pane so CSS clip-path applies to both buffers.
   * The clip polygon follows the parent AOI's exact geometry — sharp boundary.
   *
   * Double-buffering: front layer (opacity 1) + back layer (opacity 0).
   * Back layer silently preloads the next frame's tiles while front is displayed.
   * On frame advance: CSS crossfade swaps opacities, then refs are swapped.
   */
  private createAoiChildTileLayer(config: LayerConfig): L.Layer | null {
    if (!this.L || !config.tileUrl) return null;

    // Get parent AOI geometry for clipping
    const parentAoi = useMapLayersStore.getState().layers[config.parentAoiId!];
    const aoiGeometry = parentAoi?.aoiGeometry;

    // Dedicated pane between data (100) and annotations (150)
    const paneName = `aoi-clip-${config.id}`;
    if (!this.map!.getPane(paneName)) {
      const pane = this.map!.createPane(paneName);
      (pane as HTMLElement).style.zIndex = '105';
    }

    // Create FRONT layer (visible, current frame)
    const frontLayer = this.createAuthTileLayer(config.tileUrl, config, paneName);

    // Create BACK layer (invisible, preloading next frame)
    const backLayer = this.createAuthTileLayer(config.tileUrl, config, paneName);
    backLayer.setOpacity(0);

    // Store double buffer
    this.aoiDoubleBuffers.set(config.id, {
      front: frontLayer,
      back: backLayer,
      backHasUrl: false,
      backReady: false,
      transitioning: false,
      pendingCommit: false,
      loadGen: 0,
    });

    // Add back layer to map immediately (for silent preloading)
    if (this.map) {
      backLayer.addTo(this.map);
    }

    // Apply CSS clip-path matching the AOI polygon (applies to both front and back)
    if (aoiGeometry) {
      this.setupAoiClipPath(config.id, paneName, aoiGeometry);
    }

    // Wrap front layer with pointer marker if bounds are available
    if (config.tileBounds) {
      return this.createLayerWithPointer(frontLayer, config);
    }
    return frontLayer;
  }

  /**
   * Set (and maintain) a CSS clip-path polygon on an AOI child layer's pane.
   * Uses latLngToLayerPoint for accurate coordinate mapping.
   * Re-runs on viewreset + zoomend so the polygon stays accurate after zoom.
   *
   * Why CSS clip-path works here:
   * - The pane div has position:absolute with a CSS translate3d transform.
   * - clip-path coordinates are in the element's LOCAL space (before transform).
   * - latLngToLayerPoint returns coordinates in exactly this local space.
   * - On pan, Leaflet moves the entire pane via CSS transform — both tiles AND
   *   the clip-path polygon translate together, keeping the geographic boundary fixed.
   * - On zoom/viewreset, tile positions within the pane reset, so we recalculate.
   */
  private setupAoiClipPath(layerId: string, paneName: string, geometry: GeoJSONGeometry): void {
    const map = this.map!;
    const pane = map.getPane(paneName) as HTMLElement | null;
    if (!pane) return;

    const applyClip = () => {
      const ring = this.extractExteriorRing(geometry);
      if (ring.length < 3) return;
      const pts = ring.map(([lng, lat]) => {
        const p = map.latLngToLayerPoint([lat, lng]);
        return `${p.x}px ${p.y}px`;
      });
      // Close the path (repeat first point if needed)
      if (pts[0] !== pts[pts.length - 1]) pts.push(pts[0]);
      pane.style.clipPath = `polygon(${pts.join(', ')})`;
    };

    applyClip();

    // Clean up any previous listener for this layer
    this.cleanupAoiClip(layerId);

    map.on('viewreset zoomend', applyClip);
    this.aoiClipListeners.set(layerId, applyClip);
  }

  private extractExteriorRing(geometry: GeoJSONGeometry): [number, number][] {
    if (geometry.type === 'Polygon') {
      return geometry.coordinates[0];
    }
    if (geometry.type === 'MultiPolygon') {
      // Use the ring with the most points (largest polygon)
      let best: [number, number][] = [];
      for (const poly of geometry.coordinates) {
        if (poly[0] && poly[0].length > best.length) best = poly[0];
      }
      return best;
    }
    return [];
  }

  private cleanupAoiClip(layerId: string): void {
    const fn = this.aoiClipListeners.get(layerId);
    if (fn) {
      if (this.map) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.map as any).off('viewreset zoomend', fn);
      }
      this.aoiClipListeners.delete(layerId);
    }
  }

  private createDataLayer(config: LayerConfig, data: unknown): L.Layer | null {
    switch (config.type) {
      case 'annotation':
        return this.createAnnotationLayer(config, data as Annotation[]);
      case 'tracking':
        return this.createTrackingLayer(config, data as TrackedObject[]);
      case 'alert':
        return this.createAlertLayer(config, data as Alert[]);
      case 'dataset':
        // Dataset without tileUrl → footprint polygon
        return this.createFootprintLayer(config, data as DatasetFootprintData);
      default:
        return null;
    }
  }

  private createAnnotationLayer(config: LayerConfig, annotations: Annotation[]): L.GeoJSON | null {
    if (!this.L || annotations.length === 0) return null;
    const L = this.L;
    const { style, opacity } = config;

    const features = annotations.map((a) => ({
      type: 'Feature' as const,
      geometry: a.geometry,
      properties: {
        id: a.id,
        label: a.label,
        confidence: a.confidence,
        source: a.source,
        status: a.status,
        version: a.version,
        created_at: a.created_at,
        _color: style.color,
        _fillColor: style.fillColor,
        _fillOpacity: style.fillOpacity,
        _weight: style.weight,
        _dashArray: style.dashArray ?? '',
      },
    }));

    const geoJsonLayer = L.geoJSON(features, {
      pane: 'awakeforest-annotations',
      style: () => ({
        color: style.color,
        fillColor: style.fillColor,
        fillOpacity: style.fillOpacity * opacity,
        weight: style.weight,
        dashArray: style.dashArray,
      }),
      pointToLayer: (_feature, latlng) =>
        L.circleMarker(latlng, {
          pane: 'awakeforest-annotations',
          radius: style.radius,
          color: style.color,
          fillColor: style.fillColor,
          fillOpacity: style.fillOpacity * opacity,
          weight: style.weight,
        }),
      onEachFeature: (feature, layer) => {
        layer.on('click', (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e);
          markFeatureClick();

          const geomStats = feature.geometry
            ? computeGeoStats(feature.geometry as Parameters<typeof computeGeoStats>[0])
            : { featureType: 'annotation', stats: {} };

          const pointCoords =
            feature.geometry?.type === 'Point'
              ? {
                  latitude: fmtCoord((feature.geometry.coordinates as [number, number])[1], 'lat'),
                  longitude: fmtCoord((feature.geometry.coordinates as [number, number])[0], 'lng'),
                }
              : {};

          useMapLayersStore.getState().openFeaturePanel({
            layerType: 'annotation',
            featureType: geomStats.featureType,
            featureId: feature.properties?.id ?? config.id,
            properties: {
              ...feature.properties,
              ...geomStats.stats,
              ...pointCoords,
            },
            latlng: [e.latlng.lat, e.latlng.lng],
            layerRef: layer,
            layerId: config.id,
          });

          const label = feature.properties?.label ?? 'Annotation';
          L.popup({ closeButton: false, className: 'af-map-popup', offset: [0, -6], maxWidth: 220 })
            .setLatLng(e.latlng)
            .setContent(
              `<div class="af-popup-content">
                <div class="af-popup-title">${label}</div>
                <div class="af-popup-sub">See details in panel →</div>
              </div>`
            )
            .openOn(this.map!);
        });
      },
    });

    geoJsonLayer.setStyle({ opacity });
    return geoJsonLayer;
  }

  /**
   * Create a GeoJSON layer for an annotation set.
   * Features are styled per class_id using config.classStyles.
   */
  /** Register the verify/delete action handler (called once from MapEditorShell). */
  setAnnotationActionHandler(
    fn: MapManager['annotationActionHandler'],
  ): void {
    this.annotationActionHandler = fn;
  }

  /**
   * Open the per-annotation action popup at `latlng`. Shows the class label,
   * optional confidence, and — when an annotation id is known and a handler is
   * registered — small Verify (approve) and Delete buttons. Leaflet anchors the
   * popup to the geometry, so it tracks pan/zoom automatically and only one is
   * ever open (it represents the user-clicked annotation).
   */
  private openAnnotationActionPopup(
    latlng: L.LatLng,
    label: string,
    subHtml: string,
    ctx: {
      annotationSetId?: string;
      annotationId?: string;
      properties?: Record<string, unknown>;
      layerId: string;
    },
  ): void {
    if (!this.L || !this.map) return;
    const L = this.L;
    const map = this.map;

    const root = document.createElement('div');
    root.className = 'af-popup-content';
    root.innerHTML = `
      <div class="af-popup-title">${label}</div>
      ${subHtml}
      <div class="af-popup-sub">See details in panel &rarr;</div>
    `;

    const canAct = !!ctx.annotationId && !!this.annotationActionHandler;
    if (canAct) {
      const bar = document.createElement('div');
      bar.className = 'af-popup-actions';

      const makeBtn = (action: 'verify' | 'delete', title: string, svg: string, cls: string) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `af-popup-action ${cls}`;
        btn.title = title;
        btn.setAttribute('aria-label', title);
        btn.innerHTML = svg;
        L.DomEvent.disableClickPropagation(btn);
        btn.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          this.annotationActionHandler?.(action, ctx);
          map.closePopup();
        });
        return btn;
      };

      const checkSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      const trashSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';

      // Already-verified annotations live in the verified set — they can only be
      // deleted from there, never re-verified.
      const alreadyVerified = ctx.properties?.review_status === 'verified';
      if (!alreadyVerified) {
        bar.appendChild(makeBtn('verify', 'Verify annotation', checkSvg, 'af-popup-action-verify'));
      }
      bar.appendChild(makeBtn('delete', 'Delete annotation', trashSvg, 'af-popup-action-delete'));
      root.appendChild(bar);
    }

    L.popup({ closeButton: false, className: 'af-map-popup', offset: [0, -6], maxWidth: 220 })
      .setLatLng(latlng)
      .setContent(root)
      .openOn(map);
  }

  private createAnnotationSetLayer(config: LayerConfig, fc: GeoJSONFeatureCollection): L.Layer | null {
    if (!this.L || !fc) return null;
    const L = this.L;
    const allFeatures = (fc.features ?? []) as GeoJSON.Feature[];

    // Build a styled, interactive GeoJSON layer for a subset of features. Used
    // for both the "always geometry" (large areas) and "cluster-eligible"
    // (points / tiny masks) partitions so they share identical styling + click
    // handling.
    const buildGeometryLayer = (feats: GeoJSON.Feature[]): L.GeoJSON =>
      L.geoJSON({ type: 'FeatureCollection', features: feats } as GeoJSON.FeatureCollection, {
      pane: 'awakeforest-annotations',
      interactive: true,
      style: (feature) => {
        return this.resolveAnnotationStyle(
          config,
          feature?.properties as Record<string, unknown> | undefined,
          false,
          feature?.geometry as GeoJSONGeometry | undefined,
        );
      },
      pointToLayer: (feature, latlng) => {
        const s = this.annotationPointStyle(
          config,
          feature?.properties as Record<string, unknown> | undefined,
          feature?.geometry as GeoJSONGeometry | undefined,
        );
        return L.circleMarker(latlng, {
          pane: 'awakeforest-annotations',
          ...s,
          // Render point annotations as a small solid dot (a "point"), not a
          // large outlined circle: tiny radius and no stroke ring. Hidden
          // (filtered-out) features keep their disabling flags from `s`.
          radius: ANNOTATION_POINT_RADIUS,
          weight: s.stroke === false ? 0 : 1,
        });
      },
      onEachFeature: (feature, layer) => {
        layer.on('click', (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e);
          markFeatureClick();

          const geomStats = feature.geometry
            ? computeGeoStats(feature.geometry as Parameters<typeof computeGeoStats>[0])
            : { featureType: 'annotation', stats: {} };

          const pointCoords =
            feature.geometry?.type === 'Point'
              ? {
                  latitude: fmtCoord((feature.geometry.coordinates as [number, number])[1], 'lat'),
                  longitude: fmtCoord((feature.geometry.coordinates as [number, number])[0], 'lng'),
                }
              : {};

          // Derive annotation_set_id from config ID (format: "annset-{uuid}")
          const annotationSetId = config.id.startsWith('annset-') ? config.id.slice(7) : undefined;
          const annotationId = (feature.properties?.id ?? feature.id ?? undefined) as string | undefined;

          useMapLayersStore.getState().openFeaturePanel({
            layerType: 'annotation',
            featureType: geomStats.featureType,
            featureId: annotationId ?? config.id,
            properties: {
              ...feature.properties,
              ...geomStats.stats,
              ...pointCoords,
              ...(annotationSetId ? { _annotation_set_id: annotationSetId } : {}),
              ...(annotationId ? { _annotation_id: annotationId } : {}),
            },
            latlng: [e.latlng.lat, e.latlng.lng],
            layerRef: layer,
            layerId: config.id,
          });

          const label = feature.properties?.class_name ?? feature.properties?.label ?? 'Annotation';
          const subHtml = feature.properties?.confidence != null
            ? `<div class="af-popup-sub">Confidence: ${(feature.properties.confidence * 100).toFixed(0)}%</div>`
            : '';
          this.openAnnotationActionPopup(e.latlng, label, subHtml, {
            annotationSetId,
            annotationId,
            properties: feature.properties as Record<string, unknown> | undefined,
            layerId: config.id,
          });
        });
      },
    });

    // ── Partition by on-screen size: cluster only points + sub-pixel masks ────
    // Clustering is meant to collapse features that are too small to see when
    // zoomed out (points, tiny detections). A segmentation polygon that covers
    // real ground should NOT be hidden inside a count bubble — it stays visible
    // as geometry at every zoom. We classify with a fast bbox-span proxy at the
    // cluster threshold zoom (no per-feature area computation).
    const pxPerDeg = mercatorPxPerDegree(ANNOTATION_CLUSTER_ZOOM);
    const alwaysGeomFeatures: GeoJSON.Feature[] = [];
    const clusterEligibleFeatures: GeoJSON.Feature[] = [];
    for (const f of allFeatures) {
      const geom = f.geometry as GeoJSONGeometry | null;
      const geomType = geom?.type as string | undefined;
      const isPointLike = geomType === 'Point' || geomType === 'MultiPoint';
      const spanPx = geometryBboxSpanDeg(geom) * pxPerDeg;
      if (!isPointLike && spanPx >= ANNOTATION_MIN_GEOMETRY_PX) {
        alwaysGeomFeatures.push(f);
      } else {
        clusterEligibleFeatures.push(f);
      }
    }

    const alwaysGeomLayer = alwaysGeomFeatures.length
      ? buildGeometryLayer(alwaysGeomFeatures)
      : null;
    const eligibleGeomLayer = clusterEligibleFeatures.length
      ? buildGeometryLayer(clusterEligibleFeatures)
      : null;

    // ── Level-of-detail: cluster the eligible features below the threshold ────
    // Below the threshold, rendering thousands of sub-pixel features is both
    // expensive and useless. We swap them for a marker-cluster layer of count
    // bubbles; clicking a bubble zooms in (markercluster's zoomToBoundsOnClick),
    // at which point their real geometry takes over. Large areas
    // (`alwaysGeomLayer`) render as geometry at all zooms.
    const clusterLayer = clusterEligibleFeatures.length
      ? this.createAnnotationClusterLayer(config, {
          ...fc,
          features: clusterEligibleFeatures as GeoJSONFeatureCollection['features'],
        })
      : null;

    if (!clusterLayer || !eligibleGeomLayer) {
      // Nothing to cluster (all large areas), or clustering unavailable (plugin
      // failed to load) — render every feature as plain geometry, no LOD swap.
      return alwaysGeomLayer ?? eligibleGeomLayer ?? buildGeometryLayer(allFeatures);
    }

    const container = L.featureGroup();
    if (alwaysGeomLayer) container.addLayer(alwaysGeomLayer); // permanent — never clusters
    let showingClusters: boolean | null = null;
    const applyLod = () => {
      if (!this.map) return;
      const useClusters = this.map.getZoom() < ANNOTATION_CLUSTER_ZOOM;
      if (useClusters === showingClusters) return;
      showingClusters = useClusters;
      if (useClusters) {
        if (container.hasLayer(eligibleGeomLayer)) container.removeLayer(eligibleGeomLayer);
        if (!container.hasLayer(clusterLayer)) container.addLayer(clusterLayer);
      } else {
        if (container.hasLayer(clusterLayer)) container.removeLayer(clusterLayer);
        if (!container.hasLayer(eligibleGeomLayer)) container.addLayer(eligibleGeomLayer);
      }
    };
    container.on('add', () => {
      this.map?.on('zoomend', applyLod);
      showingClusters = null; // force a fresh evaluation on (re-)add
      applyLod();
    });
    container.on('remove', () => {
      this.map?.off('zoomend', applyLod);
    });

    return container;
  }

  /**
   * Build a marker-cluster layer of feature centroids for an annotation set.
   * Used as the low-zoom (< {@link ANNOTATION_CLUSTER_ZOOM}) representation so a
   * dense set collapses into a handful of count bubbles instead of thousands of
   * shapes. Returns null when there are no features or the plugin can't load.
   */
  private createAnnotationClusterLayer(
    config: LayerConfig,
    fc: GeoJSONFeatureCollection,
  ): L.Layer | null {
    if (!this.L) return null;
    const L = this.L;
    const features = fc.features ?? [];
    if (features.length === 0) return null;

    // leaflet.markercluster is a UMD bundle that expects a global `L` at eval
    // time — mirror the lazy-require pattern used for leaflet.vectorgrid.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof window !== 'undefined' && !(window as any).L) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).L = L;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (L as any).markerClusterGroup !== 'function') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('leaflet.markercluster');
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Failed to load leaflet.markercluster', err);
        return null;
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const makeClusterGroup = (L as any).markerClusterGroup;
    if (typeof makeClusterGroup !== 'function') return null;

    const accent = config.style.color || '#8c6d2c';
    const group = makeClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: false,
      zoomToBoundsOnClick: true,
      maxClusterRadius: 60,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      iconCreateFunction: (cluster: any) => {
        const count = cluster.getChildCount() as number;
        const size = count < 100 ? 'sm' : count < 1000 ? 'md' : 'lg';
        return L.divIcon({
          html: `<div class="af-cluster af-cluster-${size}" style="--af-cluster-accent:${accent}"><span>${count}</span></div>`,
          className: 'af-cluster-wrap',
          iconSize: L.point(40, 40),
        });
      },
    });

    const dotIcon = L.divIcon({
      html: `<div class="af-cluster-dot" style="--af-cluster-accent:${accent}"></div>`,
      className: 'af-cluster-dot-wrap',
      iconSize: L.point(12, 12),
    });

    for (const f of features) {
      const ll = geometryCentroid(f.geometry as GeoJSONGeometry | null);
      if (!ll) continue;
      const marker = L.marker(ll as L.LatLngExpression, { icon: dotIcon });
      // A lone (un-clustered) dot: zoom in so the real geometry renders.
      marker.on('click', () => {
        if (!this.map) return;
        this.map.setView(ll as L.LatLngExpression, Math.max(this.map.getZoom(), ANNOTATION_CLUSTER_ZOOM + 2));
      });
      group.addLayer(marker);
    }

    return group as L.Layer;
  }

  private createTrackingLayer(config: LayerConfig, objects: TrackedObject[]): L.LayerGroup | null {
    if (!this.L || objects.length === 0) return null;
    const L = this.L;
    const { style, opacity } = config;
    const group = L.layerGroup();

    objects.forEach((obj) => {
      const pos = extractLatLng(obj.latest_geometry);
      if (!pos) return;

      const markerColor = PRIORITY_COLORS[obj.priority] ?? style.color;

      const marker = L.circleMarker(pos, {
        radius: style.radius,
        color: markerColor,
        fillColor: markerColor,
        fillOpacity: style.fillOpacity * opacity,
        weight: style.weight,
        opacity,
      });

      marker.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        markFeatureClick();
        useMapLayersStore.getState().openFeaturePanel({
          layerType: 'tracking',
          featureType: 'tracking',
          featureId: obj.id,
          properties: {
            id: obj.id,
            object_type: obj.object_type,
            status: obj.status,
            priority: obj.priority,
            severity: obj.severity,
            confidence_score: obj.confidence_score,
            observation_count: obj.observation_count,
            first_observed_at: obj.first_observed_at,
            last_observed_at: obj.last_observed_at,
          },
          latlng: [e.latlng.lat, e.latlng.lng],
          layerId: config.id,
        });
        L.popup({ closeButton: false, className: 'af-map-popup', offset: [0, -10], maxWidth: 220 })
          .setLatLng(e.latlng)
          .setContent(
            `<div class="af-popup-content">
              <div class="af-popup-title">${obj.object_type}</div>
              <div class="af-popup-sub">${obj.priority} priority · ${obj.status}</div>
            </div>`
          )
          .openOn(this.map!);
      });

      marker.bindTooltip(`${obj.object_type} — ${obj.priority}`, { sticky: true });
      group.addLayer(marker);
    });

    return group;
  }

  private createAlertLayer(config: LayerConfig, alerts: Alert[]): L.LayerGroup | null {
    if (!this.L || alerts.length === 0) return null;
    const L = this.L;
    const { opacity } = config;
    const group = L.layerGroup();

    alerts.forEach((alert) => {
      const pos = extractLatLng(alert.geometry);
      if (!pos) return;

      const color = ALERT_STATUS_COLORS[alert.status] ?? ALERT_STATUS_COLORS.open;
      const size = SEVERITY_SIZES[alert.severity] ?? 10;

      const icon = L.divIcon({
        html: makePinSvg(color, size),
        className: '',
        iconSize: [size * 2, size * 1.6],
        iconAnchor: [size, size * 1.6],
        popupAnchor: [0, -size * 1.6],
      });

      const marker = L.marker(pos, { icon, opacity });

      marker.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        markFeatureClick();
        useMapLayersStore.getState().openFeaturePanel({
          layerType: 'alert',
          featureType: 'alert',
          featureId: alert.id,
          properties: {
            id: alert.id,
            alert_type: alert.alert_type,
            severity: alert.severity,
            status: alert.status,
            title: alert.title,
            tracked_object_id: alert.tracked_object_id,
            created_at: alert.created_at,
          },
          latlng: [e.latlng.lat, e.latlng.lng],
          layerId: config.id,
        });
      });

      marker.bindTooltip(`${alert.title} (${alert.severity})`, { sticky: true });
      group.addLayer(marker);
    });

    return group;
  }

  private createFootprintLayer(config: LayerConfig, data: DatasetFootprintData): L.GeoJSON | null {
    if (!this.L || !data.geometry) return null;
    const L = this.L;
    const { style, opacity } = config;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const featureCollection: any = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: data.geometry,
        properties: { id: data.id, name: data.name, status: data.status },
      }],
    };

    // Footprint layers are non-interactive - clicks pass through to map handler
    // which uses findTileLayerAtPoint to select the appropriate tile layer
    return L.geoJSON(featureCollection, {
      pane: 'awakeforest-data',
      interactive: false,
      style: () => ({
        color: style.color,
        fillColor: style.fillColor,
        fillOpacity: style.fillOpacity * opacity,
        weight: style.weight,
        dashArray: '4 4',
        opacity,
      }),
    });
  }

  private createAoiLayer(config: LayerConfig): L.GeoJSON | null {
    if (!this.L || !config.aoiGeometry) return null;
    const L = this.L;
    const { style, opacity } = config;

    const featureCollection = {
      type: 'FeatureCollection' as const,
      features: [{
        type: 'Feature' as const,
        geometry: config.aoiGeometry,
        properties: { id: config.id, name: config.name ?? 'AOI' },
      }],
    };

    const geoJsonLayer = L.geoJSON(featureCollection as GeoJSON.FeatureCollection, {
      pane: 'awakeforest-annotations',
      style: () => ({
        color: style.color,
        fillColor: style.fillColor,
        fillOpacity: style.fillOpacity * opacity,
        weight: style.weight,
        dashArray: style.dashArray,
      }),
    });

    // Add click handler to focus the AOI layer
    geoJsonLayer.on('click', (e: L.LeafletMouseEvent) => {
      L.DomEvent.stopPropagation(e);
      markFeatureClick();
      useMapLayersStore.getState().focusLayer(config.id);
    });

    return geoJsonLayer;
  }

  // ── Internal: rebuild data layer ───────────────────────────────────────────

  private rebuildDataLayer(id: string, config: LayerConfig): void {
    if (!this.map || !this.L) return;

    const wasOnMap = this.onMap.has(id);
    const hadLeafletLayer = this.leafletLayers.has(id);
    this.removeLayerFromMap(id);

    const data = this.dataStore.get(id);
    if (!data) return;

    // If config has tileUrl, tile layer takes priority (no footprint needed)
    if (config.tileUrl && config.type === 'dataset') {
      // Data was pushed but we have tiles — skip footprint
      return;
    }

    // Route through createLayer so annotation_set (and other sourceType-based
    // dispatches) are handled correctly instead of falling into createDataLayer
    // which expects raw arrays (Annotation[], etc.).
    const layer = config.sourceType === 'annotation_set'
      ? this.createLayer(config)
      : this.createDataLayer(config, data);
    if (!layer) return;

    this.leafletLayers.set(id, layer);
    // Show layer if: it was previously on map, OR this is the first time data
    // arrived (no prior Leaflet layer existed) and the config says visible.
    if (config.visible && (wasOnMap || !hadLeafletLayer)) {
      layer.addTo(this.map);
      this.onMap.add(id);
    }
  }

  // ── Internal: cleanup ──────────────────────────────────────────────────────

  private removeLayerFromMap(id: string): void {
    const layer = this.leafletLayers.get(id);
    if (layer) {
      // Helper to aggressively destroy a tile layer
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const destroyTileLayer = (tileLayer: any) => {
        // Abort any pending tile loads
        if (typeof tileLayer._abortLoading === 'function') {
          tileLayer._abortLoading();
        }

        // Remove all tiles and revoke blob URLs
        if (tileLayer._tiles) {
          const tiles = tileLayer._tiles as Record<string, { el?: HTMLImageElement }>;

          for (const key in tiles) {
            const tile = tiles[key];
            if (tile?.el) {
              // Cancel any ongoing requests
              tile.el.onload = null;
              tile.el.onerror = null;

              // Revoke blob URLs for auth tile layers
              if (tile.el.src && tile.el.src.startsWith('blob:')) {
                URL.revokeObjectURL(tile.el.src);
              }

              // Clear the src to stop any pending requests
              tile.el.src = '';
            }
          }
          // Clear the tile cache
          tileLayer._tiles = {};
        }

        // Clear tile queue if it exists
        if (tileLayer._tilesToLoad) {
          tileLayer._tilesToLoad = 0;
        }

        // Remove from parent container if it exists
        if (tileLayer._container && tileLayer._container.parentNode) {
          tileLayer._container.parentNode.removeChild(tileLayer._container);
        }
      };

      // Handle LayerGroup (which may contain a TileLayer and/or pointers)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((layer as any).eachLayer) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (layer as any).eachLayer((sublayer: any) => {
          // Only destroy tile layers, not markers
          if (sublayer._tiles || sublayer._url) {
            destroyTileLayer(sublayer);
          }
        });
      } else {
        // Direct TileLayer
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        destroyTileLayer(layer as any);
      }

      // Remove layer from map (triggers onRemove lifecycle)
      if (this.map && this.map.hasLayer(layer)) {
        this.map.removeLayer(layer);
      }

      // Additional cleanup for any lingering DOM elements
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const layerAny = layer as any;
      if (layerAny._container && layerAny._container.parentNode) {
        try {
          layerAny._container.parentNode.removeChild(layerAny._container);
        } catch {
          // ignore if already removed
        }
      }
      if (layerAny.eachLayer) {
        layerAny.eachLayer((sublayer: any) => {
          if (sublayer._container && sublayer._container.parentNode) {
            try {
              sublayer._container.parentNode.removeChild(sublayer._container);
            } catch {
              // ignore
            }
          }
        });
      }

      this.onMap.delete(id);
    }

    // Also remove pointer if it exists
    const pointer = this.pointerLayers.get(id);
    if (pointer) {
      // Get the parent group and remove pointer from it
      const parentGroup = this.pointerParentGroups.get(id);
      if (parentGroup && parentGroup.hasLayer(pointer)) {
        parentGroup.removeLayer(pointer);
      }
      this.pointerLayers.delete(id);
      this.pointerParentGroups.delete(id);
      this.visiblePointers.delete(id);
    }
  }

  // ── Pointer management ─────────────────────────────────────────────────────

  /**
   * Create a layer with an embedded pointer marker.
   * For tile layers with bounds, wraps the tile layer in a LayerGroup
   * that also contains the pointer marker.
   */
  private createLayerWithPointer(tileLayer: L.Layer, config: LayerConfig): L.LayerGroup {
    const L = this.L!;
    const layerGroup = L.layerGroup([tileLayer]);

    // Only create pointer if we have valid bounds
    if (!config.tileBounds || this.isDefaultBounds(config.tileBounds)) {
      return layerGroup;
    }

    const [west, south, east, north] = config.tileBounds;
    const bounds = L.latLngBounds([[south, west], [north, east]]);
    
    const pointerType = getPointerType(config.type, config.sourceType);
    const pointerConfig = POINTER_CONFIGS[pointerType];
    const marker = createPointerMarker(bounds, pointerConfig, config, config.name || config.id);

    // Store pointer reference and parent group for zoom-based visibility
    this.pointerLayers.set(config.id, marker);
    this.pointerParentGroups.set(config.id, layerGroup);

    // Attach click handler to zoom to bounds
    marker.on('click', () => {
      this.fitBounds([west, south, east, north]);
    });

    // Only add pointer if zoom is below threshold (zoom < 12)
    const currentZoom = this.map?.getZoom() ?? 0;
    if (isPointerVisibleAtZoom(currentZoom)) {
      layerGroup.addLayer(marker);
      this.visiblePointers.add(config.id);
    }

    return layerGroup;
  }

  /**
   * Check if bounds are "default" (world bounds or center of earth).
   * These indicate TileJSON returned invalid bounds.
   */
  private isDefaultBounds(bounds: [number, number, number, number]): boolean {
    const [west, south, east, north] = bounds;
    
    // Check for world bounds [-180, -85, 180, 85]
    const isWorldBounds = Math.abs(west - (-180)) < 0.01 && 
                         Math.abs(south - (-85.0511287798066)) < 0.01 &&
                         Math.abs(east - 180) < 0.01 && 
                         Math.abs(north - 85.0511287798066) < 0.01;
    
    // Check for center-of-earth (all zeros or near-zero)
    const isCenterEarth = Math.abs(west) < 0.0001 && Math.abs(south) < 0.0001 && 
                          Math.abs(east) < 0.0001 && Math.abs(north) < 0.0001;
    
    return isWorldBounds || isCenterEarth;
  }

  /**
   * Convert layer tile bounds into Leaflet bounds expression.
   * When provided, Leaflet avoids requesting tiles outside this extent.
   */
  private getLeafletTileBounds(config: LayerConfig): L.LatLngBoundsExpression | undefined {
    if (!this.L || !config.tileBounds || this.isDefaultBounds(config.tileBounds)) return undefined;
    const [west, south, east, north] = config.tileBounds;
    return [[south, west], [north, east]];
  }

  /**
   * Rebuild a layer when its bounds are loaded asynchronously.
   * Called from useMapSync when tileBounds change.
   */
  updateLayerBounds(layerId: string, tileBounds: [number, number, number, number], config: LayerConfig): void {
    if (!this.map) return;

    const wasOnMap = this.onMap.has(layerId);
    this.removeLayerFromMap(layerId);
    
    // Create new layer with bounds (which will create pointer if bounds are valid)
    const layer = this.createLayer({ ...config, tileBounds });
    if (layer) {
      this.leafletLayers.set(layerId, layer);
      if (wasOnMap && config.visible) {
        layer.addTo(this.map);
        this.onMap.add(layerId);
      }
    }
  }

  /**
   * Compute bounds from GeoJSON geometry.
   * Used when TileJSON bounds are invalid (world bounds or center-of-earth).
   */
  computeBoundsFromGeometry(geometry: GeoJSONGeometry | null): [number, number, number, number] | null {
    if (!geometry) return null;

    if (geometry.type === 'Point') {
      const [lng, lat] = geometry.coordinates as [number, number];
      // Return a small bounding box around the point
      return [lng - 0.001, lat - 0.001, lng + 0.001, lat + 0.001];
    }

    if (geometry.type === 'Polygon') {
      const coords = geometry.coordinates[0] as [number, number][];
      if (!coords || coords.length === 0) return null;
      
      let minLng = coords[0][0], maxLng = coords[0][0];
      let minLat = coords[0][1], maxLat = coords[0][1];
      
      for (const [lng, lat] of coords) {
        minLng = Math.min(minLng, lng);
        maxLng = Math.max(maxLng, lng);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
      }
      
      return [minLng, minLat, maxLng, maxLat];
    }

    return null;
  }

  /**
   * Resolve style for annotation class (MVT or GeoJSON).
   * Used by both createMvtLayer and createAnnotationSetLayer.
   */
  private resolveAnnotationStyle(
    config: LayerConfig,
    properties?: Record<string, unknown>,
    addFillFlag: boolean = false,
    geometry?: GeoJSONGeometry,
  ): Record<string, unknown> {
    const fillFlag = addFillFlag ? { fill: true } : {};

    // ── Visualization filter ──────────────────────────────────────────────
    // Features that fall below the confidence/area thresholds are hidden
    // entirely (no stroke, no fill, non-interactive) so the filter actually
    // removes them from the map rather than just dimming them.
    const filter = config.annotationFilter ?? DEFAULT_ANNOTATION_FILTER;
    const confidence = extractConfidence(properties);
    if (!this.passesAnnotationFilter(filter, confidence, geometry)) {
      return {
        stroke: false,
        fill: false,
        opacity: 0,
        fillOpacity: 0,
        weight: 0,
        interactive: false,
        ...fillFlag,
      };
    }

    const classRef = extractClassIdFromProperties(properties);
    const cs = resolveClassStyle(config.classStyles, classRef);

    // Leaflet's setStyle MERGES rather than replaces, so a feature that was
    // previously hidden (stroke/fill/opacity off, non-interactive) keeps those
    // disabling flags unless we explicitly re-enable them here. Without this,
    // raising the confidence/area filter hides features but lowering it never
    // brings them back.
    const visibleFlags = {
      stroke: true,
      fill: true,
      opacity: 1,
      interactive: true,
    };

    // ── Confidence color mode ─────────────────────────────────────────────
    // Override per-class colors with a red→green heatmap driven by the
    // feature's confidence score.
    if (filter.colorMode === 'confidence' && confidence !== undefined) {
      const hue = confidenceColor(confidence);
      const baseFillOpacity = (cs?.fillOpacity ?? config.style.fillOpacity) * config.opacity;
      return {
        ...visibleFlags,
        color: hue,
        fillColor: hue,
        fillOpacity: baseFillOpacity,
        weight: cs?.strokeWidth ?? config.style.weight,
        ...fillFlag,
      };
    }

    // ── Verified vs. unverified differentiation ───────────────────────────
    // Distinguish human-verified annotations from raw/unverified ones without
    // touching hue (classes own the color). Verified features get a thicker
    // stroke and a fuller fill; unverified ones get a dashed, lighter "draft"
    // look. The flag is read per feature — the backend places verified
    // annotations in their own set, so each carries review_status === 'verified'.
    // Not applied in confidence color mode (handled/returned above).
    const isVerified = properties?.review_status === 'verified';
    const verifiedStyle = (baseWeight: number, baseFillOpacity: number) =>
      isVerified
        ? {
            weight: baseWeight + 1,
            fillOpacity: Math.min(baseFillOpacity * 1.6, 0.85),
            dashArray: undefined, // clear any merged dash from a prior unverified style
          }
        : {
            weight: baseWeight,
            dashArray: '4 4',
            fillOpacity: baseFillOpacity * 0.6,
          };

    if (cs) {
      return {
        ...visibleFlags,
        color: cs.strokeColor,
        fillColor: cs.fillColor,
        ...verifiedStyle(cs.strokeWidth, cs.fillOpacity * config.opacity),
        ...fillFlag,
      };
    }

    return {
      ...visibleFlags,
      color: config.style.color,
      fillColor: config.style.fillColor,
      ...verifiedStyle(config.style.weight, config.style.fillOpacity * config.opacity),
      ...fillFlag,
    };
  }

  /**
   * Whether a feature passes the layer's annotation filter. Features with no
   * confidence value are never hidden by the confidence threshold (they have
   * no score to compare); the area threshold only applies to polygons.
   */
  private passesAnnotationFilter(
    filter: LayerConfig['annotationFilter'],
    confidence: number | undefined,
    geometry?: GeoJSONGeometry,
  ): boolean {
    if (!filter) return true;
    if (filter.minConfidence > 0 && confidence !== undefined && confidence < filter.minConfidence) {
      return false;
    }
    if (filter.minAreaM2 > 0 && geometry && (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon')) {
      try {
        const a = areaM2(geometry);
        if (Number.isFinite(a) && a > 0 && a < filter.minAreaM2) return false;
      } catch {
        // Unmeasurable geometry — don't hide on area grounds.
      }
    }
    return true;
  }

  /**
   * Point-marker style for annotation sets. Points (e.g. crown centres) render
   * as SOLID circle markers — the per-class ``fillOpacity`` is tuned for
   * translucent polygons and makes points look hollow. We keep the class color
   * and stroke but force an opaque fill, scaled only by the layer opacity so the
   * opacity slider still applies.
   */
  private annotationPointStyle(
    config: LayerConfig,
    properties?: Record<string, unknown>,
    geometry?: GeoJSONGeometry,
  ): Record<string, unknown> {
    const s = this.resolveAnnotationStyle(config, properties, false, geometry);
    // Filtered-out features come back hidden — keep them hidden rather than
    // forcing the solid-fill point style back on.
    if (s.stroke === false && s.fill === false) return s;
    return { ...s, fill: true, fillOpacity: config.opacity };
  }

  /**
   * Highlight a pointer (show as selected).
   */
  focusLayer(layerId: string): void {
    // Clear previous focus
    if (this.selectedLayerId && this.selectedLayerId !== layerId) {
      const prevMarker = this.pointerLayers.get(this.selectedLayerId);
      if (prevMarker) {
        unhighlightPointer(prevMarker);
      }
    }

    // Set new focus
    this.selectedLayerId = layerId;
    const marker = this.pointerLayers.get(layerId);
    if (marker) {
      highlightPointer(marker);
    }
  }

  /**
   * Find the topmost visible tile layer whose bounds contain the given point.
   * Returns the layer ID, or null if no match.
   */
  findTileLayerAtPoint(latlng: L.LatLng): string | null {
    const store = useMapLayersStore.getState();
    const configs = store.layers;

    // Collect visible tile layers with bounds, sorted by z-index (highest first)
    const candidates: { id: string; zIndex: number; bounds: [number, number, number, number] }[] = [];
    for (const [id, config] of Object.entries(configs)) {
      if (!config.visible || !config.tileUrl) continue;
      // Use tileBounds or bounds
      const b = config.tileBounds ?? config.bounds;
      if (!b) continue;
      candidates.push({ id, zIndex: config.zIndex, bounds: b });
    }

    // Sort by z-index descending (topmost first)
    candidates.sort((a, b) => b.zIndex - a.zIndex);

    const lat = latlng.lat;
    const lng = latlng.lng;

    for (const c of candidates) {
      const [west, south, east, north] = c.bounds;
      if (lat >= south && lat <= north && lng >= west && lng <= east) {
        return c.id;
      }
    }

    return null;
  }

  /**
   * Find the topmost visible layer (AOI or tile dataset) under the given point,
   * resolved by the UI layer hierarchy (z-index, highest first). AOIs are tested
   * by precise polygon containment; tile datasets by bounding box. This lets an
   * AOI overlaid on a dataset win the click even though the dataset's tiles sit
   * underneath it.
   *
   * Returns the layer ID, or null if no layer is hit.
   */
  findTopLayerAtPoint(latlng: L.LatLng): string | null {
    const configs = useMapLayersStore.getState().layers;
    const lat = latlng.lat;
    const lng = latlng.lng;

    const candidates: { id: string; zIndex: number }[] = [];
    for (const [id, config] of Object.entries(configs)) {
      if (!config.visible) continue;

      // AOIs: precise point-in-polygon test against the actual geometry.
      if (config.type === 'aoi' && config.aoiGeometry) {
        if (pointInGeometry(lng, lat, config.aoiGeometry)) {
          candidates.push({ id, zIndex: config.zIndex });
        }
        continue;
      }

      // Tile datasets: bounding-box test (matches findTileLayerAtPoint).
      if (!config.tileUrl) continue;
      const b = config.tileBounds ?? config.bounds;
      if (!b) continue;
      const [west, south, east, north] = b;
      if (lat >= south && lat <= north && lng >= west && lng <= east) {
        candidates.push({ id, zIndex: config.zIndex });
      }
    }

    if (candidates.length === 0) return null;
    // Highest z-index (topmost in the UI hierarchy) wins.
    candidates.sort((a, b) => b.zIndex - a.zIndex);
    return candidates[0].id;
  }

  /**
   * Clear layer focus.
   */
  clearFocus(): void {
    if (this.selectedLayerId) {
      const marker = this.pointerLayers.get(this.selectedLayerId);
      if (marker) {
        unhighlightPointer(marker);
      }
      this.selectedLayerId = null;
    }
  }

  /**
   * Update pointer visibility based on zoom level.
   * Pointers are hidden when zoomed in (zoom >= threshold).
   */
  updatePointersForZoom(zoom: number, threshold: number = 12): void {
    if (!this.map) return;

    for (const [layerId, marker] of this.pointerLayers) {
      const shouldShow = isPointerVisibleAtZoom(zoom, threshold);
      const isOnMap = this.visiblePointers.has(layerId);
      const parentGroup = this.pointerParentGroups.get(layerId);

      if (shouldShow && !isOnMap && this.leafletLayers.has(layerId)) {
        // Add pointer back to its parent LayerGroup (or directly to map if no group)
        if (parentGroup) {
          parentGroup.addLayer(marker);
        } else {
          marker.addTo(this.map);
        }
        this.visiblePointers.add(layerId);
      } else if (!shouldShow && isOnMap) {
        // Remove pointer from its parent LayerGroup (or from map)
        if (parentGroup) {
          parentGroup.removeLayer(marker);
        } else {
          this.map.removeLayer(marker);
        }
        this.visiblePointers.delete(layerId);
      }
    }
  }
}

// ── Data shape for dataset footprint layers ──────────────────────────────────

export interface DatasetFootprintData {
  id: string;
  name: string;
  status: string;
  geometry: GeoJSONGeometry | null;
}
