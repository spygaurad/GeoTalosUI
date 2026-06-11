'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import '@geoman-io/leaflet-geoman-free';
import { useMapStore, setMapInstance } from '@/stores/mapStore';
import type { DrawTool } from '@/stores/mapStore';
import { useMapLayersStore, wasFeatureJustClicked, markFeatureClick } from '@/stores/mapLayersStore';
import { getMapManager } from '@/features/maps/MapManager';
import { useMapSync } from '@/features/maps/hooks/useMapSync';
import { annotationSetsApi } from '@/lib/api/annotation-sets';
import { toast } from 'sonner';

// Map Geoman shape names → our DrawTool enum
const GEOMAN_TO_DRAW_TOOL: Record<string, DrawTool> = {
  Marker: 'point',
  Line: 'polyline',
  Polygon: 'polygon',
  Rectangle: 'rectangle',
  Circle: 'circle',
  CircleMarker: 'point',
};
import type { GeoJSONGeometry } from '@/types/geo';

// Fix Leaflet default marker icon paths broken by webpack asset hashing
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const BASEMAPS: Record<string, { url: string; attribution: string; maxNativeZoom: number }> = {
  // CartoDB Voyager — English-first labels, clean cartographic style
  osm: {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution:
      '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ' +
      '© <a href="https://carto.com/attributions">CARTO</a>',
    maxNativeZoom: 19,
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '© Esri, Maxar, Earthstar Geographics',
    maxNativeZoom: 19,
  },
  light: {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution:
      '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ' +
      '© <a href="https://carto.com/attributions">CARTO</a>',
    maxNativeZoom: 19,
  },
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution:
      '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ' +
      '© <a href="https://carto.com/attributions">CARTO</a>',
    maxNativeZoom: 19,
  },
};

// Geoman draw mode names keyed by our DrawTool type
const GEOMAN_MODE: Record<string, string> = {
  point: 'Marker',
  polyline: 'Line',
  polygon: 'Polygon',
  rectangle: 'Rectangle',
  circle: 'Circle',
};

// Web Mercator valid latitude range
const MAP_BOUNDS = L.latLngBounds(L.latLng(-85.051129, -Infinity), L.latLng(85.051129, Infinity));
const MIN_ZOOM = 2;

// ── Floating delete control ────────────────────────────────────────────────────
// Minimal '×' overlaid at the top-right corner of drawn shapes.
function createDeleteControl(
  map: L.Map,
  position: L.LatLng,
  drawTool: DrawTool,
  onDelete: () => void,
): L.Marker {
  const btn = document.createElement('button');
  btn.title = 'Delete';
  btn.textContent = '×';
  btn.style.cssText = [
    'width: 16px',
    'height: 16px',
    'background: rgba(0,0,0,0.45)',
    'border: none',
    'border-radius: 50%',
    'cursor: pointer',
    'color: rgba(255,255,255,0.9)',
    'font-size: 13px',
    'line-height: 1',
    'display: flex',
    'align-items: center',
    'justify-content: center',
    'padding: 0',
    'pointer-events: all',
    'transition: background 0.15s',
  ].join(';');

  L.DomEvent.on(btn, 'mouseover', () => { btn.style.background = 'rgba(180,40,40,0.85)'; });
  L.DomEvent.on(btn, 'mouseout', () => { btn.style.background = 'rgba(0,0,0,0.45)'; });
  L.DomEvent.on(btn, 'click', (ev) => {
    L.DomEvent.stopPropagation(ev);
    onDelete();
  });
  L.DomEvent.on(btn, 'mousedown', L.DomEvent.stopPropagation);

  // For points: anchor so '×' appears to the upper-right of the standard 25×41 pin icon.
  // For all other shapes: bottom-center anchor places the icon directly above the vertex.
  const iconAnchor: [number, number] = drawTool === 'point' ? [-6, 40] : [8, 20];

  const icon = L.divIcon({
    html: btn,
    className: '',
    iconSize: [16, 16],
    iconAnchor,
  });

  return L.marker(position, { icon, zIndexOffset: 1000, interactive: true }).addTo(map);
}

// Find the northernmost vertex of a drawn layer so the delete '×' sits directly
// above the highest actual point of the geometry (never floating in empty space).
function getLayerNorthernmost(layer: L.Layer, drawTool: DrawTool): L.LatLng | null {
  try {
    if (drawTool === 'point') {
      return (layer as unknown as L.Marker).getLatLng();
    }
    if (drawTool === 'circle') {
      // North pole of the circle bounds — always on the edge
      return (layer as unknown as L.Circle).getBounds().getNorth()
        ? L.latLng(
            (layer as unknown as L.Circle).getBounds().getNorth(),
            (layer as unknown as L.Circle).getLatLng().lng,
          )
        : (layer as unknown as L.Circle).getLatLng();
    }
    // polyline, polygon, rectangle — walk all vertices, pick highest latitude
    const raw = (layer as unknown as L.Polyline).getLatLngs();
    // getLatLngs can return nested arrays for polygons; flatten two levels deep
    const flat = (raw as unknown[]).flat(2) as L.LatLng[];
    if (!flat.length) return null;
    return flat.reduce((best, ll) => (ll.lat > best.lat ? ll : best));
  } catch {
    return null;
  }
}

export default function LeafletMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  // Tracks the MOST RECENTLY drawn (pending) layer for live style updates
  // Using L.Layer as base type to support both Marker (point) and Path (others)
  const pendingLayerRef = useRef<L.Layer | null>(null);
  // Prevents map click from closing panel right after a shape is drawn
  const justCreatedShapeRef = useRef(false);
  // Per-drawn-layer geometry data — all layer types (including markers)
  const drawnLayerData = useRef(
    new Map<L.Layer, { shapeType: DrawTool; geometry: GeoJSONGeometry; circleRadius?: number }>()
  );
  // Floating delete control markers for each drawn shape
  const drawnControls = useRef(new Map<L.Layer, L.Marker>());
  // Which drawn layer is currently "selected" (delete button visible)
  const selectedDrawnLayerRef = useRef<L.Layer | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    // Guard: skip on React Strict Mode double-effect
    if (!container || mapRef.current) return;

    // Guards all event callbacks — set false in cleanup so rAF-deferred
    // Leaflet handlers don't fire after the map has been removed, which
    // prevents "Cannot read properties of undefined (reading '_leaflet_pos')"
    let mounted = true;

    const { center, zoom } = useMapStore.getState();

    const map = L.map(container, {
      center,
      zoom,
      minZoom: MIN_ZOOM,
      zoomControl: true,
      preferCanvas: true,
      worldCopyJump: true,
      maxBounds: MAP_BOUNDS,
      maxBoundsViscosity: 1.0,
    });
    mapRef.current = map;
    setMapInstance(map);
    getMapManager().init(map);

    // Set initial zoom so pointer visibility is correct before first zoomend
    useMapLayersStore.getState().setCurrentZoom(zoom);

    // ── Tile layer ─────────────────────────────────────────
    const initialBasemapId = useMapStore.getState().activeBasemapId ?? 'osm';
    const initialBm = BASEMAPS[initialBasemapId] ?? BASEMAPS.osm;
    tileLayerRef.current = L.tileLayer(initialBm.url, {
      attribution: initialBm.attribution,
      maxNativeZoom: initialBm.maxNativeZoom,
      maxZoom: 22,
      pane: 'awakeforest-basemap',
    }).addTo(map);

    // ── Geoman config — no native toolbar (toolbar lives in MapTopBar) ──
    if (map.pm) {
      map.pm.setGlobalOptions({ snappable: true, snapDistance: 20 });
      map.pm.setPathOptions({
        color: '#8c6d2c',
        fillColor: '#8c6d2c',
        fillOpacity: 0.15,
        // weight:3 is the minimum that gives a reasonable click/touch target on
        // thin polylines when using canvas rendering (preferCanvas:true).
        weight: 3,
      });
    }

    // ── Force size recalculation after mount ───────────────
    // L.map() can capture wrong dimensions if the CSS layout hasn't flushed
    // yet (common on dynamic import / SPA re-navigation). We fire invalidateSize
    // at three points to guarantee tiles fill the viewport regardless of timing:
    //   1. Next animation frame — covers most layout flushes
    //   2. Double rAF — covers deferred flex/grid recalculations
    //   3. 300 ms timeout — covers slow CSS transitions or component animations
    const rafId1 = requestAnimationFrame(() => {
      if (mounted) map.invalidateSize({ animate: false });
    });
    const rafId2 = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (mounted) map.invalidateSize({ animate: false });
      });
    });
    const sizeTimerId = setTimeout(() => {
      if (mounted) map.invalidateSize({ animate: false });
    }, 300);

    // ── Reload tiles when tab becomes visible again ─────────
    // Fixes blank/dark map when returning to the page after browser tab suspend
    const handleVisibility = () => {
      if (!document.hidden) {
        setTimeout(() => { if (mounted) mapRef.current?.invalidateSize({ animate: false }); }, 150);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // ── Map events → store ──────────────────────────────────
    const handleMouseMove = (e: L.LeafletMouseEvent) => {
      if (!mounted) return;
      useMapStore.getState().setCursorLatLng([e.latlng.lat, e.latlng.lng]);
    };
    const handleMouseOut = () => {
      if (!mounted) return;
      useMapStore.getState().setCursorLatLng(null);
    };
    const handleZoomEnd = () => {
      if (!mounted) return;
      const c = map.getCenter();
      const zoom = map.getZoom();
      useMapStore.getState().setCenter([c.lat, c.lng], zoom);
      // Update store's currentZoom for pointer visibility subscriptions
      useMapLayersStore.getState().setCurrentZoom(zoom);
    };
    const handleMoveEnd = () => {
      if (!mounted) return;
      const c = map.getCenter();
      useMapStore.getState().setCenter([c.lat, c.lng]);
    };
    map.on('mousemove', handleMouseMove);
    map.on('mouseout', handleMouseOut);
    map.on('zoomend', handleZoomEnd);
    map.on('moveend', handleMoveEnd);

    // Toggle a delete control's visibility without removing it from the map
    const setControlVisible = (marker: L.Marker, visible: boolean) => {
      const el = marker.getElement();
      if (!el) return;
      el.style.opacity = visible ? '1' : '0';
      el.style.pointerEvents = visible ? 'all' : 'none';
    };

    // Show the delete control for one layer; hide any previously shown control
    const selectDrawnLayer = (layer: L.Layer) => {
      if (selectedDrawnLayerRef.current && selectedDrawnLayerRef.current !== layer) {
        const prev = drawnControls.current.get(selectedDrawnLayerRef.current);
        if (prev) setControlVisible(prev, false);
      }
      const control = drawnControls.current.get(layer);
      if (control) setControlVisible(control, true);
      selectedDrawnLayerRef.current = layer;
    };

    // Hide all delete controls (called when map is clicked / panel closed)
    const deselectAllDrawnLayers = () => {
      if (selectedDrawnLayerRef.current) {
        const control = drawnControls.current.get(selectedDrawnLayerRef.current);
        if (control) setControlVisible(control, false);
        selectedDrawnLayerRef.current = null;
      }
    };

    // Helper: remove a drawn layer and its associated delete control
    const removeDrawnLayer = (layer: L.Layer) => {
      if (selectedDrawnLayerRef.current === layer) selectedDrawnLayerRef.current = null;
      const control = drawnControls.current.get(layer);
      control?.remove();
      drawnControls.current.delete(layer);
      drawnLayerData.current.delete(layer);
      layer.remove();
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handlePmCreate = (e: any) => {
      if (!mounted) return;
      const layer = e.layer as L.Layer & { toGeoJSON(): { geometry: GeoJSONGeometry } };
      const geom = layer.toGeoJSON?.().geometry;
      const drawTool = GEOMAN_TO_DRAW_TOOL[e.shape as string] ?? 'polygon';

      const layersState = useMapLayersStore.getState();

      // ── Annotation draw mode: save geometry to active set ────────────────
      if (layersState.activeAnnotationSetId && geom) {
        const setId = layersState.activeAnnotationSetId;
        const classId = layersState.activeAnnotationClassId;
        layer.remove();
        if (!classId) {
          toast.warning('Select a class in the right panel before drawing');
          useMapStore.getState().setActiveDrawTool('polygon');
          return;
        }
        annotationSetsApi.addFeature(setId, {
          geometry: geom,
          class_id: classId,
        }).then(() => {
          layersState.requestAnnotationSetRefresh(setId);
          toast.success('Annotation saved');
        }).catch((err: unknown) => {
          toast.error('Failed to save annotation');
          console.error('annotation save error', err);
        });
        // Re-enable polygon draw for the next shape
        useMapStore.getState().setActiveDrawTool('polygon');
        return;
      }

      // ── Bbox-prompt Mode: capture rectangle as a SAM3 bbox prompt ─────────
      // Relay the [W,S,E,N] bounds to the inference panel and drop the temp
      // Geoman layer (the panel renders its own styled prompt overlay). Keep the
      // rectangle tool armed so the user can draw several exemplar boxes in a row.
      if (layersState.bboxPromptDrawMode && geom) {
        const bounds = (layer as unknown as L.Polygon).getBounds();
        const bbox: [number, number, number, number] = [
          bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth(),
        ];
        layersState.setCapturedBboxPrompt(bbox);
        layer.remove();
        useMapStore.getState().setActiveDrawTool('rectangle');
        return;
      }

      // ── AOI Mode: create AOI layer and remove temporary Geoman layer ──────
      if (layersState.aoiDrawMode && geom) {
        const bounds = (layer as unknown as L.Polygon).getBounds();
        const bbox: [number, number, number, number] = [
          bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth(),
        ];

        layersState.createAoiLayer(geom, bbox);
        layer.remove();
        useMapStore.getState().setActiveDrawTool(null);
        return;
      }

      // ── Standard annotation flow ──────────────────────────────────────────
      if (geom) {
        useMapStore.getState().setDrawnGeometry(geom);
      }

      // Store shape type + circle radius for geometry stats panel
      const circleRadius = drawTool === 'circle'
        ? (layer as unknown as L.Circle).getRadius?.()
        : undefined;
      useMapStore.getState().setDrawnShapeInfo(drawTool, circleRadius);

      // Track for live style updates
      pendingLayerRef.current = layer;

      // Always store per-layer geometry data (including markers)
      if (geom) {
        drawnLayerData.current.set(layer, {
          shapeType: drawTool,
          geometry: geom,
          circleRadius: circleRadius ?? undefined,
        });
      }

      // Add floating '×' delete overlay directly above the northernmost vertex.
      // Created hidden — only made visible when the layer is selected (clicked).
      const topRight = getLayerNorthernmost(layer, drawTool);
      if (topRight) {
        const control = createDeleteControl(map, topRight, drawTool, () => {
          removeDrawnLayer(layer);
          if (pendingLayerRef.current === layer) {
            pendingLayerRef.current = null;
          }
          useMapStore.getState().setDrawnGeometry(null);
          useMapLayersStore.getState().clearPendingAnnotation();
        });
        // Hide immediately after adding to map
        const el = control.getElement();
        if (el) { el.style.opacity = '0'; el.style.pointerEvents = 'none'; }
        drawnControls.current.set(layer, control);
      }

      // Select the newly drawn layer so its delete button is visible right away
      selectDrawnLayer(layer);

      // Prevent the completion click from immediately closing the panel
      justCreatedShapeRef.current = true;
      setTimeout(() => { justCreatedShapeRef.current = false; }, 500);

      // Add click handler so user can re-open annotation panel by clicking the drawn shape.
      // Guard with wasFeatureJustClicked() so clicking a saved annotation nearby
      // doesn't also trigger this Geoman layer's handler.
      layer.on('click', (ev: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(ev); // prevent map click from also firing
        if (wasFeatureJustClicked()) return;
        markFeatureClick();
        selectDrawnLayer(layer); // show this layer's delete button
        // Restore this specific layer's geometry context before showing the panel
        const data = drawnLayerData.current.get(layer);
        if (data) {
          useMapStore.getState().setDrawnShapeInfo(data.shapeType, data.circleRadius);
          useMapStore.getState().setDrawnGeometry(data.geometry);
        }
        useMapLayersStore.getState().showAnnotationPanel();
      });

      // Auto-return to select mode after placing a shape
      useMapStore.getState().setActiveDrawTool(null);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handlePmRemove = (e: any) => {
      if (!mounted) return;
      // If Geoman removes the layer via its own removal tool, clean up our tracking
      const layer = e.layer as L.Layer;
      if (layer) {
        const control = drawnControls.current.get(layer);
        control?.remove();
        drawnControls.current.delete(layer);
        drawnLayerData.current.delete(layer);
      }
      useMapStore.getState().setDrawnGeometry(null);
    };

    // ── Close right panel when clicking on empty map, or select tile layer ──
    const handleMapClick = (e: L.LeafletMouseEvent) => {
      if (!mounted) return;
      if (justCreatedShapeRef.current) return;
      if (wasFeatureJustClicked()) return;
      // Don't touch the panel while measuring — measurement click listener
      // handles those clicks independently and the panel must stay open.
      if (useMapLayersStore.getState().measurementActive) return;
      // Don't reselect/close while a draw tool is armed (AOI, annotation, or
      // bbox-prompt). Mid-draw clicks place vertices; routing them to the layer
      // underneath would switch the right panel and reset its state (e.g. the
      // SAM3 inference panel's model + bbox-prompt selection).
      if (useMapStore.getState().activeDrawTool) return;
      deselectAllDrawnLayers(); // hide delete button when deselecting

      // Resolve the topmost layer under the click via the UI hierarchy (z-index).
      // AOIs are tested by polygon containment, so an AOI overlaid on a dataset
      // wins the click even though the dataset's tiles render underneath it.
      const mm = getMapManager();
      const hitLayerId = mm.findTopLayerAtPoint(e.latlng);
      if (hitLayerId) {
        markFeatureClick(); // prevent map click from also closing panel
        const hitConfig = useMapLayersStore.getState().layers[hitLayerId];
        if (hitConfig?.type === 'aoi') {
          // AOI → open the AOI panel and zoom-in-only to it.
          useMapLayersStore.getState().focusLayer(hitLayerId);
        } else {
          useMapLayersStore.getState().layerOnMapClick(hitLayerId);
        }
        return;
      }

      if (useMapLayersStore.getState().rightPanelMode !== 'none') {
        useMapLayersStore.getState().closeRightPanel();
      }
    };
    map.on('pm:create', handlePmCreate);
    map.on('pm:remove', handlePmRemove);
    map.on('click', handleMapClick);

    // ── Live style update for the pending drawn annotation ──
    const unsubPending = useMapLayersStore.subscribe(
      (s) => s.pendingAnnotation,
      (pending) => {
        if (!mounted) return;
        const layer = pendingLayerRef.current;
        if (!pending) {
          // Annotation was cancelled — remove drawn shape and its control
          if (layer) {
            const control = drawnControls.current.get(layer);
            control?.remove();
            drawnControls.current.delete(layer);
            drawnLayerData.current.delete(layer);
            layer.remove();
            pendingLayerRef.current = null;
          }
          return;
        }
        if (!layer) return;
        // Apply live style changes from the panel (only for paths, not markers)
        const path = layer as unknown as L.Path;
        if (typeof path.setStyle === 'function') {
          path.setStyle({
            color: pending.style.color,
            fillColor: pending.style.fillColor,
            fillOpacity: pending.style.fillOpacity,
            weight: pending.style.weight,
            dashArray: pending.style.dashArray || undefined,
          });
        }
      }
    );

    // ── Invalidate size when container resizes ──────────────
    const ro = new ResizeObserver(() => {
      if (!mounted) return;
      map.invalidateSize({ animate: false });
    });
    ro.observe(container);

    // ── Reactive basemap swap ───────────────────────────────
    const unsubBasemap = useMapStore.subscribe((state, prev) => {
      if (state.activeBasemapId === prev.activeBasemapId) return;
      if (!mapRef.current) return;
      tileLayerRef.current?.remove();
      const bm = BASEMAPS[state.activeBasemapId ?? 'osm'] ?? BASEMAPS.osm;
      tileLayerRef.current = L.tileLayer(bm.url, {
        attribution: bm.attribution,
        maxNativeZoom: bm.maxNativeZoom,
        maxZoom: 22,
        pane: 'awakeforest-basemap',
      }).addTo(mapRef.current);
    });

    // ── Reactive annotation class selection → update Geoman draw color ─────────
    // When user picks a class in AnnotationDrawPanel, apply that class's fill/
    // stroke colour to Geoman so the polygon preview matches the final colour.
    const unsubClass = useMapLayersStore.subscribe(
      (s) => ({ classId: s.activeAnnotationClassId, setId: s.activeAnnotationSetId }),
      ({ classId, setId }) => {
        if (!mounted || !mapRef.current?.pm) return;
        if (classId && setId) {
          const layerId = `annset-${setId}`;
          const layer = useMapLayersStore.getState().layers[layerId];
          const cs = layer?.classStyles?.[classId];
          if (cs) {
            mapRef.current.pm.setPathOptions({
              color: cs.strokeColor,
              fillColor: cs.fillColor,
              fillOpacity: cs.fillOpacity,
              weight: cs.strokeWidth ?? 2,
            });
            return;
          }
        }
        // No class selected or no style — reset to default golden-brown
        mapRef.current.pm.setPathOptions({
          color: '#8c6d2c',
          fillColor: '#8c6d2c',
          fillOpacity: 0.15,
          weight: 3,
        });
      },
      { equalityFn: (a, b) => a.classId === b.classId && a.setId === b.setId },
    );

    // ── Reactive draw tool — calls Geoman on tool change ────
    const unsubDrawTool = useMapStore.subscribe((state, prev) => {
      if (state.activeDrawTool === prev.activeDrawTool) return;
      const m = mapRef.current;
      if (!m?.pm) return;

      // Disable current draw/edit mode first
      m.pm.disableDraw();
      m.pm.disableGlobalEditMode();
      m.pm.disableGlobalRemovalMode();

      const geomanMode = state.activeDrawTool
        ? GEOMAN_MODE[state.activeDrawTool]
        : null;
      if (geomanMode) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        m.pm.enableDraw(geomanMode as any);
      }
    });

    return () => {
      // Flip mounted flag first — all rAF-deferred Leaflet callbacks check
      // this before touching the DOM, preventing the "_leaflet_pos" crash.
      mounted = false;
      cancelAnimationFrame(rafId1);
      cancelAnimationFrame(rafId2);
      clearTimeout(sizeTimerId);
      document.removeEventListener('visibilitychange', handleVisibility);
      // Explicitly remove all named map event listeners before destroying the map.
      // map.remove() also clears them, but being explicit prevents any window between
      // mounted=false and map.remove() where a stale handler could fire.
      map.off('mousemove', handleMouseMove);
      map.off('mouseout', handleMouseOut);
      map.off('zoomend', handleZoomEnd);
      map.off('moveend', handleMoveEnd);
      map.off('pm:create', handlePmCreate);
      map.off('pm:remove', handlePmRemove);
      map.off('click', handleMapClick);
      ro.disconnect();
      unsubBasemap();
      unsubDrawTool();
      unsubClass();
      unsubPending();
      // Clean up all drawn control markers
      drawnControls.current.forEach((control) => control.remove());
      drawnControls.current.clear();
      drawnLayerData.current.clear();
      getMapManager().destroy();
      setMapInstance(null);
      // Stop all animations before removing so pending rAF pan/zoom callbacks
      // don't run after the map panes are gone (fixes "_leaflet_pos" error).
      map.stop();
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      pendingLayerRef.current = null;
    };
  }, []);

  // Sync Zustand store changes with MapManager
  useMapSync();

  return <div ref={containerRef} className="absolute inset-0" />;
}
