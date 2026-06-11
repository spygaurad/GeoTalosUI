/**
 * Layer pointer system — visual indicators for layer bounds when zoomed out.
 *
 * Design principles:
 * - Each layer type has a unique visual identifier (color + icon)
 * - Pointers appear only when zoomed below THRESHOLD (configurable)
 * - Pointers are passive: tooltips show layer name on hover
 * - Icons use Unicode emoji for broad platform support
 * - Colors synced with layer styles for UI consistency (legend, right panel, left panel)
 */

import L from 'leaflet';
import type { LayerType, LayerSourceType, LayerConfig } from './types';

/**
 * Unique pointer identifier per layer type.
 * Determines which color/icon is used for the marker.
 */
export type PointerType = 
  | 'dataset-raster'
  | 'dataset-vector' 
  | 'annotation'
  | 'tracking'
  | 'alert';

/**
 * Configuration for how a pointer looks.
 * Applied to L.Marker with divIcon when rendering.
 */
export interface PointerConfig {
  type: PointerType;
  radius: number;           // Circle marker radius in pixels
  color: string;            // Border color (always white)
  fillColor: string;        // Fill color (type-specific)
  icon: string;             // Unicode emoji displayed in tooltip
  description: string;      // Shown in console/debugger
}

/**
 * Visual configuration for each pointer type.
 * 
 * Design rationale:
 * - Rasters are blue (satellite/earth imagery)
 * - Vectors are green (geographic features)
 * - Annotations are gold (user-added data)
 * - Tracking is green (active tracking objects)
 * - Alerts are red (high priority notifications)
 */
export const POINTER_CONFIGS: Record<PointerType, PointerConfig> = {
  'dataset-raster': {
    type: 'dataset-raster',
    radius: 8,
    color: '#ffffff',
    fillColor: '#5c8ce0',    // dataset blue
    icon: '🛰️',
    description: 'Raster dataset (satellite/drone imagery)',
  },
  'dataset-vector': {
    type: 'dataset-vector',
    radius: 8,
    color: '#ffffff',
    fillColor: '#5c8ce0',    // dataset blue
    icon: '📍',
    description: 'Vector dataset (polygon/feature data)',
  },
  'annotation': {
    type: 'annotation',
    radius: 7,
    color: '#ffffff',
    fillColor: '#c4985c',    // annotation gold
    icon: '📝',
    description: 'Annotation set',
  },
  'tracking': {
    type: 'tracking',
    radius: 7,
    color: '#ffffff',
    fillColor: '#6bcc6b',    // tracking green
    icon: '📡',
    description: 'Tracking object',
  },
  'alert': {
    type: 'alert',
    radius: 7,
    color: '#ffffff',
    fillColor: '#e05c5c',    // alert red
    icon: '⚠️',
    description: 'Alert event',
  },
};

/**
 * Get the pointer type for a layer based on its type and source.
 * This determines which icon and default color are used.
 */
export function getPointerType(layerType: LayerType, sourceType?: LayerSourceType): PointerType {
  // Map layer types to pointer types
  const typeMap: Record<LayerType, PointerType> = {
    'dataset': 'dataset-raster',    // Default to raster for datasets
    'annotation': 'annotation',
    'tracking': 'tracking',
    'alert': 'alert',
    'aoi': 'annotation',           // AOI uses annotation pointer style
  };

  if (layerType === 'dataset' && sourceType === 'stac_item') {
    return 'dataset-vector';  // STAC items are often vector data
  }

  return typeMap[layerType] ?? 'dataset-raster';
}

/**
 * Get the color for a layer's pointer.
 * Uses the layer's style color for UI consistency with legend and panels.
 * Falls back to default color if style is not defined.
 */
export function getColorForLayer(config: LayerConfig | undefined): string {
  if (!config) return '#5c8ce0'; // default dataset blue
  if (!config.style) return '#5c8ce0'; // default dataset blue
  return config.style.color || '#5c8ce0'; // default dataset blue
}

/**
 * Create a pointer marker for a layer at its bounds center.
 *
 * Pointer markers:
 * - Are placed at the center of the layer's spatial bounds
 * - Act as a visual "I am here" indicator for zoomed-out views
 * - Show layer name on hover (tooltip)
 * - Are interactive (pointer cursor, selectable)
 * - Use Leaflet's Marker with custom pin icon
 * - Color synced with layer's style for UI consistency
 *
 * @param bounds - L.LatLngBounds of the layer (from tileBounds or computed)
 * @param config - PointerConfig defining visual appearance (icon, description)
 * @param layerConfig - LayerConfig for accessing style.color
 * @param layerName - Human-readable layer name (shown in tooltip)
 * @returns L.Marker ready to be added to map
 */
export function createPointerMarker(
  bounds: L.LatLngBounds,
  config: PointerConfig,
  layerConfig: LayerConfig,
  layerName: string
): L.Marker {
  const center = bounds.getCenter();
  const color = getColorForLayer(layerConfig);

  // Create custom pin icon with unique color synced to layer style
  const pinIcon = L.divIcon({
    className: 'custom-pin-marker',
    html: `
      <div class="pin-container">
        <svg width="32" height="40" viewBox="0 0 32 40" xmlns="http://www.w3.org/2000/svg">
          <path 
            d="M16 0C7.163 0 0 7.163 0 16c0 8.837 16 24 16 24s16-15.163 16-24C32 7.163 24.837 0 16 0z" 
            fill="${color}" 
            stroke="#ffffff" 
            stroke-width="2"
          />
          <circle cx="16" cy="14" r="5" fill="#ffffff" opacity="0.9"/>
        </svg>
        <div class="pin-label">${config.icon}</div>
      </div>
    `,
    iconSize: [32, 40],
    iconAnchor: [16, 40], // Point of the pin
    popupAnchor: [0, -40],
  });

  const marker = L.marker(center, {
    icon: pinIcon,
    pane: 'awakeforest-pointers',
    interactive: true,
  });

  // Tooltip with layer info (shown on hover)
  marker.bindTooltip(
    `<div style="font-size: 12px; font-weight: 500;">
      ${config.icon} ${layerName}
    </div>`,
    {
      permanent: false,        // Only show on hover
      direction: 'top',        // Above pointer
      offset: [0, -10],        // 10px above
      className: 'data-pointer-tooltip',
    }
  );

  return marker;
}

/**
 * Determine if pointer should be visible at this zoom level.
 * Pointers show at zoom < threshold (zoomed out to regional/city views).
 * At zoom >= threshold, features are visible enough without pointers.
 *
 * @param zoom - Current map zoom level (0–24)
 * @param threshold - Zoom level threshold (pointers shown if zoom < threshold)
 * @returns true if pointer should be visible at this zoom
 */
export function isPointerVisibleAtZoom(zoom: number, threshold: number = 12): boolean {
  return zoom < threshold;
}

/**
 * Highlight a pointer marker (show it as selected).
 * Used when user clicks on a layer in the left panel.
 *
 * @param marker - L.Marker to highlight
 */
export function highlightPointer(marker: L.Marker): void {
  const el = marker.getElement();
  if (!el) return;
  el.classList.add('pointer-highlighted');
  animatePulse(el, 500);
}

/**
 * Un-highlight a pointer marker.
 * Used when user deselects a layer.
 *
 * @param marker - L.Marker to unhighlight
 */
export function unhighlightPointer(marker: L.Marker): void {
  const el = marker.getElement();
  if (!el) return;
  el.classList.remove('pointer-highlighted');
  (el as HTMLElement).style.animation = '';
}

/**
 * Animate pointer with a pulsing effect for visual attention.
 * Used when layer is selected or needs user focus.
 *
 * @param el - HTMLElement to animate
 * @param duration - Animation duration in milliseconds
 */
function animatePulse(el: HTMLElement, duration: number): void {
  el.style.animation = `pinPulse ${duration}ms ease-in-out`;
  setTimeout(() => {
    el.style.animation = '';
  }, duration);
}

/**
 * Update pointer marker color dynamically.
 * Called when layer style color changes.
 *
 * @param marker - L.Marker to update
 * @param newColor - New color hex code
 */
export function updatePointerColor(marker: L.Marker, newColor: string): void {
  const el = marker.getElement() as HTMLElement | null;
  if (!el) return;

  // Find the SVG path and update its fill color
  const svgPath = el.querySelector('svg path');
  if (svgPath) {
    svgPath.setAttribute('fill', newColor);
  }
}

/**
 * Debug helper: log all pointer configurations.
 * Run in browser console to see all pointer types.
 */
export function logPointerConfigs(): void {
  console.table(POINTER_CONFIGS);
}
