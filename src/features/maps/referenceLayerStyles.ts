/**
 * One colour per public reference layer, so layers stay tellable apart when
 * several are on. Protected areas are split by category into strict protection
 * and sustainable use. Keys are the Martin source names from the API.
 */

type VectorStyle = {
  weight: number;
  color: string;
  fill?: boolean;
  fillColor?: string;
  fillOpacity?: number;
  radius?: number;
};

export const REFERENCE_LAYER_COLORS: Record<string, string> = {
  ramsar: '#1d4ed8',
  cofopri: '#7e22ce',
  raisg_protected_areas: '#15803d',
  raisg_mining: '#c2410c',
  gfw_mining: '#b91c1c',
  gfw_logging: '#854d0e',
  hydrorivers: '#0284c7',
  mrds: '#be185d',
};
export const DEFAULT_REFERENCE_LAYER_COLOR = '#0e7490';

// RAISG categories come in Spanish, Portuguese and English.
const STRICT = /parque|santuario|monumento|reserva (biol|natural|ecol)|esta[cç][aã]o ecol|nature reserve|ref[uú]gio/i;
const SUSTAINABLE_COLOR = '#65a30d';

export const PROTECTED_AREA_LEGEND = [
  { label: 'Strict protection', color: REFERENCE_LAYER_COLORS.raisg_protected_areas },
  { label: 'Sustainable use', color: SUSTAINABLE_COLOR },
];

function polygon(color: string, fillOpacity = 0.2): VectorStyle {
  return { weight: 1, color, fill: true, fillColor: color, fillOpacity, radius: 4 };
}

/** The user's overrides (from the API); anything left out keeps the default look. */
export type StyleOverride = { colour?: string; opacity?: number };

export function referenceLayerColour(name: string, override?: StyleOverride): string {
  return override?.colour ?? REFERENCE_LAYER_COLORS[name] ?? DEFAULT_REFERENCE_LAYER_COLOR;
}

/** Style (or style function) for Leaflet.VectorGrid's vectorTileLayerStyles. */
export function referenceLayerStyle(
  name: string,
  override?: StyleOverride,
): VectorStyle | ((p?: Record<string, unknown>) => VectorStyle) {
  const color = referenceLayerColour(name, override);
  if (name === 'hydrorivers') return { weight: 1, color };
  if (name === 'mrds') return { weight: 1, color, fill: true, fillColor: color, fillOpacity: override?.opacity ?? 0.8, radius: 3 };
  // A chosen colour replaces the strict / sustainable split.
  if (name === 'raisg_protected_areas' && !override?.colour) {
    return (p) => polygon(STRICT.test(String(p?.categoria ?? '')) ? color : SUSTAINABLE_COLOR, override?.opacity);
  }
  return polygon(color, override?.opacity);
}
