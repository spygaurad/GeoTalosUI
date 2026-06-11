/**
 * AOI Module — Manager Extension
 *
 * Provides AOI layer creation and double-buffer animation methods.
 * Extracted from MapManager.ts (createAoiLayer, createAoiChildTileLayer,
 * setupAoiClipPath, double-buffer methods).
 *
 * Methods:
 *  - createAoiOutlineLayer      — dashed polygon outline layer for AOI boundary
 *  - createAoiChildTileLayer    — double-buffered clipped tile layer for AOI datasets
 *  - setupAoiClipPath           — CSS clip-path setup for AOI-bounded panes
 *  - preloadNextAoiFrame        — preload next frame into invisible back buffer
 *  - commitAoiFrame             — instant swap from back buffer to front (no flicker)
 *  - hasAoiDoubleBuffer         — check if a layer has a double buffer registered
 */

import type L from 'leaflet';
import type { ManagerContext } from '../../core/types';
import type { LayerConfig } from '../../types';
import type { GeoJSONGeometry } from '@/types/geo';
import { useMapLayersStore, markFeatureClick } from '@/stores/mapLayersStore';

// ── Double buffer state ──────────────────────────────────────────────────────

interface AoiDoubleBuffer {
  front: L.TileLayer;
  back: L.TileLayer;
  backHasUrl: boolean;
  backReady: boolean;
  transitioning: boolean;
}

export function createAoiManagerExtension(
  ctx: ManagerContext,
  createAuthTileLayer: (url: string, config: LayerConfig, paneName?: string) => L.TileLayer,
) {
  const { L, map } = ctx;

  // Double buffer state — closure variable, not reactive
  const aoiDoubleBuffers = new Map<string, AoiDoubleBuffer>();
  // Clip-path event listeners keyed by layer ID
  const aoiClipListeners = new Map<string, () => void>();

  // ── Geometry helpers ────────────────────────────────────────────────────────

  function extractExteriorRing(geometry: GeoJSONGeometry): [number, number][] {
    if (geometry.type === 'Polygon') {
      return geometry.coordinates[0] as [number, number][];
    }
    if (geometry.type === 'MultiPolygon') {
      // Use the ring with the most points (largest polygon)
      let best: [number, number][] = [];
      for (const poly of geometry.coordinates as [number, number][][][]) {
        if (poly[0] && poly[0].length > best.length) best = poly[0];
      }
      return best;
    }
    return [];
  }

  function cleanupAoiClip(layerId: string): void {
    const fn = aoiClipListeners.get(layerId);
    if (fn) {
      if (map) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (map as any).off('viewreset zoomend', fn);
      }
      aoiClipListeners.delete(layerId);
    }
  }

  // ── Public methods ──────────────────────────────────────────────────────────

  /**
   * Create a dashed polygon outline layer for an AOI boundary.
   * Extracted from MapManager.createAoiLayer.
   */
  function createAoiOutlineLayer(config: LayerConfig): L.GeoJSON | null {
    if (!config.aoiGeometry) return null;
    const { style, opacity } = config;

    const featureCollection = {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          geometry: config.aoiGeometry,
          properties: { id: config.id, name: config.name ?? 'AOI' },
        },
      ],
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

    // Add click handler to focus the AOI layer in the left panel
    geoJsonLayer.on('click', (e: L.LeafletMouseEvent) => {
      L.DomEvent.stopPropagation(e);
      markFeatureClick();
      useMapLayersStore.getState().focusLayer(config.id);
    });

    return geoJsonLayer;
  }

  /**
   * Create a double-buffered raster tile layer for an AOI-bounded child dataset.
   * Uses a dedicated Leaflet pane so CSS clip-path applies to both buffers.
   * The clip polygon follows the parent AOI's exact geometry — sharp boundary.
   *
   * Double-buffering: front layer (opacity 1) + back layer (opacity 0).
   * Back layer silently preloads the next frame's tiles while front is displayed.
   * On frame advance: instant opacity swap, then refs are swapped.
   *
   * @param config - The AOI child layer config (must have parentAoiId and tileUrl)
   * @param createAuthTileLayerFn - Injected dependency for creating auth tile layers
   */
  function createAoiChildTileLayer(config: LayerConfig): L.Layer | null {
    if (!config.tileUrl) return null;

    // Get parent AOI geometry for clipping
    const parentAoi = useMapLayersStore.getState().layers[config.parentAoiId!];
    const aoiGeometry = parentAoi?.aoiGeometry;

    // Dedicated pane between data (100) and annotations (150)
    const paneName = `aoi-clip-${config.id}`;
    if (!map!.getPane(paneName)) {
      const pane = map!.createPane(paneName);
      (pane as HTMLElement).style.zIndex = '105';
    }

    // Create FRONT layer (visible, current frame)
    const frontLayer = createAuthTileLayer(config.tileUrl, config, paneName);

    // Create BACK layer (invisible, preloading next frame)
    const backLayer = createAuthTileLayer(config.tileUrl, config, paneName);
    backLayer.setOpacity(0);

    // Store double buffer
    aoiDoubleBuffers.set(config.id, {
      front: frontLayer,
      back: backLayer,
      backHasUrl: false,
      backReady: false,
      transitioning: false,
    });

    // Add back layer to map immediately (for silent preloading)
    if (map) {
      backLayer.addTo(map);
    }

    // Apply CSS clip-path matching the AOI polygon (applies to both front and back)
    if (aoiGeometry) {
      setupAoiClipPath(config.id, paneName, aoiGeometry);
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
   *
   * @param aoiClipListeners - External listeners map (pass from MapManager if needed)
   */
  function setupAoiClipPath(
    layerId: string,
    paneName: string,
    geometry: GeoJSONGeometry,
    externalClipListeners?: Map<string, () => void>,
  ): void {
    const currentMap = map!;
    const pane = currentMap.getPane(paneName) as HTMLElement | null;
    if (!pane) return;

    const applyClip = () => {
      const ring = extractExteriorRing(geometry);
      if (ring.length < 3) return;
      const pts = ring.map(([lng, lat]) => {
        const p = currentMap.latLngToLayerPoint([lat, lng]);
        return `${p.x}px ${p.y}px`;
      });
      // Close the path (repeat first point if needed)
      if (pts[0] !== pts[pts.length - 1]) pts.push(pts[0]);
      pane.style.clipPath = `polygon(${pts.join(', ')})`;
    };

    applyClip();

    // Clean up any previous listener for this layer
    cleanupAoiClip(layerId);

    currentMap.on('viewreset zoomend', applyClip);
    aoiClipListeners.set(layerId, applyClip);

    // Also register in external map if provided (for MapManager compat)
    if (externalClipListeners) {
      externalClipListeners.set(layerId, applyClip);
    }
  }

  /**
   * Preload the next frame's tiles into the back buffer invisibly.
   * Called when we know the next frame's tile URL, allowing tiles to load
   * in background while the current frame is displayed.
   *
   * Marks backReady=true after ~300ms to allow tiles to load.
   */
  function preloadNextAoiFrame(id: string, url: string): void {
    const buf = aoiDoubleBuffers.get(id);
    if (!buf) return;
    buf.backHasUrl = true;
    buf.backReady = false; // reset ready flag
    buf.back.setUrl(url, false); // triggers tile loading, invisible (opacity 0)

    // Mark ready after a short delay to allow tiles to load
    setTimeout(() => {
      if (aoiDoubleBuffers.has(id)) {
        const current = aoiDoubleBuffers.get(id)!;
        if (current.backHasUrl) {
          current.backReady = true;
        }
      }
    }, 300);
  }

  /**
   * Commit the next frame by instantly swapping from front to back buffer.
   * Does NOT use CSS transitions — swaps immediately when backReady=true.
   *
   * Returns true if swap was completed, false if back buffer isn't ready yet.
   * Caller should fall back to setTileLayerUrl if this returns false.
   */
  function commitAoiFrame(id: string): boolean {
    const buf = aoiDoubleBuffers.get(id);
    if (!buf || buf.transitioning) return false;

    // Only swap if back buffer is ready (tiles have had time to load)
    if (!buf.backReady) return false;

    buf.transitioning = true;

    // Instant swap: no CSS transition, just immediate opacity change
    buf.back.setOpacity(1);
    buf.front.setOpacity(0);

    // Immediately swap refs (no timeout needed)
    const { front, back } = buf;
    buf.front = back;
    buf.back = front;
    buf.backHasUrl = false;
    buf.backReady = false;
    buf.transitioning = false;

    return true;
  }

  /**
   * Check if a layer has a registered double buffer.
   */
  function hasAoiDoubleBuffer(id: string): boolean {
    return aoiDoubleBuffers.has(id);
  }

  /**
   * Clean up all double buffers and clip listeners (called on map destroy).
   */
  function destroyAll(): void {
    aoiDoubleBuffers.clear();
    for (const [id] of aoiClipListeners) {
      cleanupAoiClip(id);
    }
  }

  return {
    createAoiOutlineLayer,
    createAoiChildTileLayer,
    setupAoiClipPath,
    preloadNextAoiFrame,
    commitAoiFrame,
    hasAoiDoubleBuffer,
    destroyAll,
    /** Exposed for cleanup in MapManager */
    cleanupAoiClip,
  };
}

export type AoiManagerExtension = ReturnType<typeof createAoiManagerExtension>;
