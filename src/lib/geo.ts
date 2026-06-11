import * as turf from '@turf/turf';
import type { Geometry } from 'geojson';
import type { BBox, GeoJSONGeometry } from '@/types/geo';

// Our GeoJSONGeometry is a subset of GeoJSON Geometry — safe to cast
function asGeometry(g: GeoJSONGeometry): Geometry {
  return g as unknown as Geometry;
}

/** Convert a BBox object to a GeoJSON Polygon geometry. */
export function bboxToPolygon(bbox: BBox): GeoJSONGeometry {
  const { minLng, minLat, maxLng, maxLat } = bbox;
  return {
    type: 'Polygon',
    coordinates: [
      [
        [minLng, minLat],
        [maxLng, minLat],
        [maxLng, maxLat],
        [minLng, maxLat],
        [minLng, minLat],
      ],
    ],
  };
}

/** Compute area in square metres from a GeoJSON Polygon or MultiPolygon. */
export function areaM2(geometry: GeoJSONGeometry): number {
  const feature = turf.feature(asGeometry(geometry));
  return turf.area(feature);
}

/** Convert area in square metres to hectares. */
export function areaHa(geometry: GeoJSONGeometry): number {
  return areaM2(geometry) / 10_000;
}

/** Centroid of a GeoJSON geometry as [lat, lng] for Leaflet. */
export function centroidLatLng(geometry: GeoJSONGeometry): [number, number] {
  const feature = turf.feature(asGeometry(geometry));
  const c = turf.centroid(feature);
  const [lng, lat] = c.geometry.coordinates;
  return [lat, lng];
}

/** Extract a Leaflet-compatible bounds array [[minLat, minLng], [maxLat, maxLng]] from a geometry. */
export function geometryToBounds(
  geometry: GeoJSONGeometry
): [[number, number], [number, number]] {
  const feature = turf.feature(asGeometry(geometry));
  const [minLng, minLat, maxLng, maxLat] = turf.bbox(feature);
  return [
    [minLat, minLng],
    [maxLat, maxLng],
  ];
}

/** Parse a WKT POLYGON string to a GeoJSON Polygon geometry (simple implementation). */
export function wktToGeoJSON(wkt: string): GeoJSONGeometry | null {
  try {
    const match = wkt.match(/POLYGON\s*\(\((.*)\)\)/i);
    if (!match) return null;
    const coords = match[1].split(',').map((pair) => {
      const [lng, lat] = pair.trim().split(/\s+/).map(Number);
      return [lng, lat] as [number, number];
    });
    return { type: 'Polygon', coordinates: [coords] };
  } catch {
    return null;
  }
}

/**
 * Compute [west, south, east, north] bbox from a GeoJSON geometry.
 * Returns null if geometry is invalid or has no coordinates.
 */
export function geometryToTileBounds(
  geometry: GeoJSONGeometry | null | undefined
): [number, number, number, number] | null {
  if (!geometry || !('coordinates' in geometry)) return null;
  try {
    const feature = turf.feature(asGeometry(geometry));
    const [west, south, east, north] = turf.bbox(feature);
    if (!Number.isFinite(west) || !Number.isFinite(south) ||
        !Number.isFinite(east) || !Number.isFinite(north)) {
      return null;
    }
    return [west, south, east, north];
  } catch {
    return null;
  }
}
