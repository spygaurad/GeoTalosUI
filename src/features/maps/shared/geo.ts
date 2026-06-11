/**
 * Shared geospatial math utilities — SINGLE SOURCE OF TRUTH.
 *
 * All distance, area, bearing, and formatting functions live here.
 * Other modules import from this file instead of duplicating.
 *
 * Coordinate conventions:
 * - haversineM takes [lat, lng] pairs (geographic order)
 * - sphericalAreaM2 takes GeoJSON rings: [[lng, lat], ...] (GeoJSON order)
 * - fmtCoord takes decimal degrees
 */

import type { GeoJSONGeometry } from '@/types/geo';

const R = 6371000; // Earth radius in metres

// ── Distance ────────────────────────────────────────────────────────────────

/**
 * Haversine distance between two points in metres.
 * Input: [lat, lng] pairs in decimal degrees.
 */
export function haversineM(a: [number, number], b: [number, number]): number {
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// ── Area ────────────────────────────────────────────────────────────────────

/**
 * Spherical polygon area (Gauss-Bonnet) in square metres.
 * Input: GeoJSON ring in [lng, lat] order.
 */
export function sphericalAreaM2(ring: [number, number][]): number {
  let area = 0;
  const n = ring.length;
  for (let i = 0; i < n - 1; i++) {
    const lon1 = (ring[i][0] * Math.PI) / 180;
    const lat1 = (ring[i][1] * Math.PI) / 180;
    const lon2 = (ring[i + 1][0] * Math.PI) / 180;
    const lat2 = (ring[i + 1][1] * Math.PI) / 180;
    area += (lon2 - lon1) * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  return Math.abs((area * R * R) / 2);
}

// ── Bearing ─────────────────────────────────────────────────────────────────

/**
 * Initial bearing in degrees from point A to point B.
 * Input: [lat, lng] pairs in decimal degrees.
 */
export function bearingDeg(from: [number, number], to: [number, number]): number {
  const lat1 = (from[0] * Math.PI) / 180;
  const lat2 = (to[0] * Math.PI) / 180;
  const dLng = ((to[1] - from[1]) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/**
 * Convert bearing degrees to compass direction (N, NE, E, SE, S, SW, W, NW).
 */
export function compassDir(deg: number): string {
  return COMPASS[Math.round(deg / 45) % 8];
}

// ── Formatting ──────────────────────────────────────────────────────────────

/** Format metres as human-readable length (m or km). */
export function fmtLen(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m).toLocaleString()} m`;
}

/** Format square metres as human-readable area (m² or ha). */
export function fmtArea(m2: number): string {
  return m2 >= 10000 ? `${(m2 / 10000).toFixed(2)} ha` : `${Math.round(m2).toLocaleString()} m²`;
}

/** Format decimal degrees with N/S/E/W suffix. */
export function fmtCoord(deg: number, axis: 'lat' | 'lng'): string {
  const abs = Math.abs(deg);
  const dir = axis === 'lat' ? (deg >= 0 ? 'N' : 'S') : (deg >= 0 ? 'E' : 'W');
  return `${abs.toFixed(6)}° ${dir}`;
}

// ── Composite stats ─────────────────────────────────────────────────────────

export interface GeoStatFields {
  featureType: string;
  stats: Record<string, string>;
}

/**
 * Compute geometry stats from GeoJSON geometry.
 * Returns a featureType string (e.g. 'annotation-polygon') and a stats map.
 * circleRadius is provided separately because Leaflet stores it outside GeoJSON.
 */
export function computeGeoStats(
  geometry: GeoJSONGeometry,
  circleRadius?: number | null,
): GeoStatFields {
  if (geometry.type === 'Point') {
    const [lng, lat] = geometry.coordinates as [number, number];
    return {
      featureType: 'annotation-point',
      stats: {
        latitude: fmtCoord(lat, 'lat'),
        longitude: fmtCoord(lng, 'lng'),
      },
    };
  }

  if (geometry.type === 'LineString') {
    const coords = geometry.coordinates as [number, number][];
    let len = 0;
    for (let i = 1; i < coords.length; i++) {
      len += haversineM([coords[i - 1][1], coords[i - 1][0]], [coords[i][1], coords[i][0]]);
    }
    const stats: Record<string, string> = {
      length: fmtLen(len),
      vertices: `${coords.length}`,
    };
    if (coords.length === 2) {
      const deg = bearingDeg([coords[0][1], coords[0][0]], [coords[1][1], coords[1][0]]);
      stats.bearing = `${deg.toFixed(1)}° ${compassDir(deg)}`;
    }
    return { featureType: 'annotation-polyline', stats };
  }

  if (geometry.type === 'Polygon') {
    // Distinguish circle by circleRadius
    if (circleRadius != null && circleRadius > 0) {
      const r = circleRadius;
      const ring = geometry.coordinates[0] as [number, number][];
      const [lng, lat] = ring[0];
      return {
        featureType: 'annotation-circle',
        stats: {
          radius: fmtLen(r),
          diameter: fmtLen(r * 2),
          area: fmtArea(Math.PI * r * r),
          center: `${fmtCoord(lat, 'lat')}, ${fmtCoord(lng, 'lng')}`,
        },
      };
    }

    const ring = geometry.coordinates[0] as [number, number][];
    const area = sphericalAreaM2(ring);
    let perimeter = 0;
    for (let i = 1; i < ring.length; i++) {
      perimeter += haversineM([ring[i - 1][1], ring[i - 1][0]], [ring[i][1], ring[i][0]]);
    }
    const vertexCount = ring.length - 1;
    const isRectangle = vertexCount === 4;

    if (isRectangle) {
      const h = haversineM([ring[0][1], ring[0][0]], [ring[1][1], ring[1][0]]);
      const w = haversineM([ring[1][1], ring[1][0]], [ring[2][1], ring[2][0]]);
      return {
        featureType: 'annotation-rectangle',
        stats: {
          area: fmtArea(area),
          perimeter: fmtLen(perimeter),
          ns_span: fmtLen(Math.min(h, w)),
          ew_span: fmtLen(Math.max(h, w)),
        },
      };
    }

    return {
      featureType: 'annotation-polygon',
      stats: {
        area: fmtArea(area),
        perimeter: fmtLen(perimeter),
        vertices: `${vertexCount}`,
      },
    };
  }

  return { featureType: 'annotation', stats: {} };
}
