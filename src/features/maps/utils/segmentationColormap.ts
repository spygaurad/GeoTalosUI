import { annotationSchemasApi } from '@/lib/api/annotation-schemas';
import type { AnnotationClass, DatasetClassMap } from '@/types/api';

/** Parse a hex color (#rgb, #rrggbb, #rrggbbaa) into [R,G,B,A], or null. */
function hexToRgba(hex: string): [number, number, number, number] | null {
  let raw = (hex || '').trim().replace(/^#/, '');
  if (raw.length === 3) raw = raw.split('').map((c) => c + c).join('');
  if (raw.length === 6) raw += 'ff';
  if (raw.length !== 8) return null;
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  const a = parseInt(raw.slice(6, 8), 16);
  if ([r, g, b, a].some(Number.isNaN)) return null;
  return [r, g, b, a];
}

function classFillRgba(cls: AnnotationClass | undefined): [number, number, number, number] {
  const fill = cls?.style?.definition?.fillColor;
  if (typeof fill === 'string') {
    const rgba = hexToRgba(fill);
    if (rgba) return rgba;
  }
  return [255, 255, 255, 255];
}

/**
 * Build a TiTiler discrete colormap JSON string (value→[R,G,B,A]) from a
 * dataset's value→class map and the schema's classes. Colors come from each
 * class's `style.fillColor`, so the overlay self-heals when a class color
 * changes. Returns null if nothing maps.
 */
export function buildSegmentationColormap(
  classMap: DatasetClassMap,
  classes: AnnotationClass[],
): string | null {
  const byId = new Map(classes.map((c) => [c.id, c]));
  const colormap: Record<string, [number, number, number, number]> = {};
  for (const [value, classId] of Object.entries(classMap.value_class_map ?? {})) {
    colormap[value] = classFillRgba(byId.get(classId));
  }
  if (Object.keys(colormap).length === 0) return null;
  if (classMap.nodata_value != null) {
    colormap[String(classMap.nodata_value)] = [0, 0, 0, 0];
  }
  return JSON.stringify(colormap);
}

/** Fetch the schema's classes and build the colormap for a stored class_map. */
export async function buildSegmentationColormapForMap(
  classMap: DatasetClassMap,
): Promise<string | null> {
  try {
    const { items } = await annotationSchemasApi.getClasses(classMap.schema_id);
    return buildSegmentationColormap(classMap, items);
  } catch {
    return null;
  }
}

/** Replace the colormap param on a tile URL with a discrete class colormap.
 *  Strips any value-transforming params (rescale, expression) and the default
 *  named colormap — a discrete value→color LUT requires the raw pixel values to
 *  reach TiTiler unmodified, otherwise rescaled values miss their colormap keys
 *  and the overlay renders with the wrong colors. */
export function applyColormapToTileUrl(tileUrl: string, colormap: string): string {
  const [base, qs] = tileUrl.split('?');
  const params = new URLSearchParams(qs ?? '');
  params.delete('colormap_name');
  params.delete('rescale');
  params.delete('expression');
  params.set('colormap', colormap);
  return `${base}?${params.toString()}`;
}
