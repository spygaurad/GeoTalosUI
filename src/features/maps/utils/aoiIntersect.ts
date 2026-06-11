import type { Dataset } from '@/types/api';
import type { GeoJSONGeometry } from '@/types/geo';

/**
 * Compute bounding box from a GeoJSON geometry.
 * Returns [west, south, east, north] or null if geometry is unsupported.
 */
function geometryBbox(geom: GeoJSONGeometry): [number, number, number, number] | null {
  let coords: number[][] = [];

  if (geom.type === 'Point') {
    coords = [geom.coordinates];
  } else if (geom.type === 'LineString') {
    coords = geom.coordinates;
  } else if (geom.type === 'Polygon') {
    coords = geom.coordinates.flat();
  } else if (geom.type === 'MultiPolygon') {
    coords = geom.coordinates.flat(2);
  }

  if (coords.length === 0) return null;

  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }

  return [minLng, minLat, maxLng, maxLat];
}

/**
 * Check if two bounding boxes overlap.
 * Each bbox is [west, south, east, north].
 */
function bboxOverlaps(
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean {
  // a[0]=west, a[1]=south, a[2]=east, a[3]=north
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/**
 * Find datasets whose spatial extent intersects an AOI bounding box.
 * Uses bbox overlap test — sufficient since AOIs are rectangles.
 */
export function findIntersectingDatasets(
  aoiBbox: [number, number, number, number],
  datasets: Dataset[],
): Dataset[] {
  return datasets.filter((ds) => {
    if (!ds.geometry) return false;
    const dsBbox = geometryBbox(ds.geometry);
    if (!dsBbox) return false;
    return bboxOverlaps(aoiBbox, dsBbox);
  });
}
