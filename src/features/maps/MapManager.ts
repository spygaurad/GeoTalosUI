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
    this.map = null;
    this.L = null;
  }

  getMap(): L.Map | null {
    return this.map;
  }

  // ── Stub methods for features not yet implemented ────────────────────────────

  hasError(id: string): boolean {
    // TODO: implement error tracking
    return false;
  }

  retryLayer(id: string): void {
    // TODO: implement layer retry
  }

  get online(): boolean {
    // TODO: implement online status tracking
    return true;
  }

  registerViewportCallback(id: string, callback: () => void): void {
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
    this.removeLayerFromMap(id);
    this.leafletLayers.delete(id);
    this.dataStore.delete(id);
  }

  // ── Layer property updates ─────────────────────────────────────────────────

  setLayerVisible(id: string, visible: boolean): void {
    if (!this.map) return;
    const layer = this.leafletLayers.get(id);
    if (!layer) return;

    if (visible && !this.onMap.has(id)) {
      layer.addTo(this.map);
      this.onMap.add(id);
    } else if (!visible && this.onMap.has(id)) {
      this.map.removeLayer(layer);
      this.onMap.delete(id);
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

    // GeoJSON / LayerGroup — update style on children
    if ('eachLayer' in layer && typeof (layer as L.LayerGroup).eachLayer === 'function') {
      (layer as L.LayerGroup).eachLayer((child) => {
        if ('setStyle' in child && typeof (child as L.Path).setStyle === 'function') {
          (child as L.Path).setStyle({ opacity, fillOpacity: undefined });
        }
        if ('setOpacity' in child && typeof (child as L.Marker).setOpacity === 'function') {
          (child as L.Marker).setOpacity(opacity);
        }
      });
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

    this.removeLayerFromMap(id);
    const layer = this.createTileLayer(config);
    if (!layer) return;

    this.leafletLayers.set(id, layer);
    if (config.visible) {
      layer.addTo(this.map);
      this.onMap.add(id);
    }
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
    // Tile-based layers
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

    const needsAuth = config.sourceType === 'dataset' || config.sourceType === 'stac_item';

    const tileLayer = needsAuth
      ? this.createAuthTileLayer(config.tileUrl, config)
      : this.L.tileLayer(config.tileUrl, {
          pane: 'awakeforest-data',
          opacity: config.opacity,
          minZoom: config.tileMinZoom ?? 0,
          maxZoom: config.tileMaxZoom ?? 24,
          tileSize: 256,
        });

    // If layer has bounds, wrap in LayerGroup with pointer marker
    if (config.tileBounds) {
      return this.createLayerWithPointer(tileLayer, config);
    }

    return tileLayer;
  }

  private createAuthTileLayer(url: string, config: LayerConfig): L.TileLayer {
    const L = this.L!;

    type TileLayerCtor = new (url: string, opts?: L.TileLayerOptions) => L.TileLayer;

    // Subclass TileLayer to inject Clerk JWT via fetch + blob URL
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const AuthTileLayer = (L.TileLayer as any).extend({
      createTile(coords: L.Coords, done: L.DoneCallback) {
        const img = L.DomUtil.create('img', 'leaflet-tile') as HTMLImageElement;
        img.alt = '';

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tileUrl = (this as any).getTileUrl(coords) as string;

        getAuthToken()
          .then((token) =>
            fetch(tileUrl, token ? { headers: { Authorization: `Bearer ${token}` } } : {})
          )
          .then((r) => {
            if (!r.ok) throw new Error(`Tile ${r.status}`);
            return r.blob();
          })
          .then((blob) => {
            const objUrl = URL.createObjectURL(blob);
            img.onload = () => { URL.revokeObjectURL(objUrl); done(undefined, img); };
            img.onerror = () => { URL.revokeObjectURL(objUrl); done(new Error('tile load'), img); };
            img.src = objUrl;
          })
          .catch((e) => done(e as Error, img));

        return img;
      },
    }) as TileLayerCtor;

    return new AuthTileLayer(url, {
      pane: 'awakeforest-data',
      opacity: config.opacity,
      minZoom: config.tileMinZoom ?? 0,
      maxZoom: config.tileMaxZoom ?? 24,
      tileSize: 256,
    });
  }

  private createDataLayer(config: LayerConfig, data: unknown): L.Layer | null {
    // Annotation set layers receive GeoJSON FeatureCollection directly
    if (config.sourceType === 'annotation_set') {
      return this.createAnnotationSetLayer(config, data as GeoJSONFeatureCollection);
    }

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
  private createAnnotationSetLayer(config: LayerConfig, fc: GeoJSONFeatureCollection): L.GeoJSON | null {
    if (!this.L || !fc || fc.features.length === 0) return null;
    const L = this.L;
    const { style, opacity, classStyles } = config;

    const resolveStyle = (classId?: string) => {
      const cs = classId && classStyles?.[classId];
      if (cs) {
        return {
          color: cs.strokeColor,
          fillColor: cs.fillColor,
          fillOpacity: cs.fillOpacity * opacity,
          weight: cs.strokeWidth,
        };
      }
      // Fallback to layer default style
      return {
        color: style.color,
        fillColor: style.fillColor,
        fillOpacity: style.fillOpacity * opacity,
        weight: style.weight,
      };
    };

    const geoJsonLayer = L.geoJSON(fc as unknown as GeoJSON.FeatureCollection, {
      pane: 'awakeforest-annotations',
      style: (feature) => {
        const classId = feature?.properties?.class_id;
        return resolveStyle(classId);
      },
      pointToLayer: (feature, latlng) => {
        const classId = feature?.properties?.class_id;
        const s = resolveStyle(classId);
        return L.circleMarker(latlng, {
          pane: 'awakeforest-annotations',
          radius: style.radius,
          ...s,
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
          L.popup({ closeButton: false, className: 'af-map-popup', offset: [0, -6], maxWidth: 220 })
            .setLatLng(e.latlng)
            .setContent(
              `<div class="af-popup-content">
                <div class="af-popup-title">${label}</div>
                ${feature.properties?.confidence != null ? `<div class="af-popup-sub">Confidence: ${(feature.properties.confidence * 100).toFixed(0)}%</div>` : ''}
                <div class="af-popup-sub">See details in panel &rarr;</div>
              </div>`
            )
            .openOn(this.map!);
        });
      },
    });

    return geoJsonLayer;
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

    const layer = this.createDataLayer(config, data);
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

      // Handle LayerGroup (which may contain a TileLayer)
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
      // Also explicitly remove from map if it has a reference
      if (this.map) {
        this.map.removeLayer(layer);
      }
      layer.remove();
      this.onMap.delete(id);
    }
    
    // Also remove pointer if it exists
    const pointer = this.pointerLayers.get(id);
    if (pointer) {
      pointer.remove();
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
  private createLayerWithPointer(tileLayer: L.TileLayer, config: LayerConfig): L.LayerGroup {
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
