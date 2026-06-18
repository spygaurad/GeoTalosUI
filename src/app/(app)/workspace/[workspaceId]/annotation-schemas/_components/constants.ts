// Color palette (warm forest cream — consistent with Datasets/Projects pages)
export const C = {
  bg: '#faf8f4',
  border: '#e8d8c4',
  borderAccent: '#dcc9b2',
  text: '#2e3428',
  textSec: '#6a5c4e',
  textMuted: '#9a8878',
  accent: '#7f5539',
  accentHover: '#6b4628',
  accentLight: '#e8d5b8',
  accentDim: 'rgba(127,85,57,0.08)',
  success: '#4a7a4a',
  warning: '#a68a64',
  danger: '#b35e4c',
  rowHover: '#fdf5ec',
  canvas: '#fff',
};

export const GEOMETRY_TYPES = [
  'Point',
  'LineString',
  'Polygon',
  'MultiPoint',
  'MultiLineString',
  'MultiPolygon',
];

export const PRESET_COLORS = [
  '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c',
  '#3498db', '#9b59b6', '#34495e', '#7f8c8d', '#c0392b',
  '#d35400', '#27ae60', '#16a085', '#2980b9', '#8e44ad',
];

// Derive a darker shade of a hex color — used to auto-generate the stroke/border
// color from the chosen fill color so users only pick one color.
export function darkenHex(hex: string, amount = 0.3): string {
  const m = hex.replace('#', '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  if (full.length !== 6) return hex;
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return hex;
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((num >> 16) & 0xff) * (1 - amount));
  const g = clamp(((num >> 8) & 0xff) * (1 - amount));
  const b = clamp((num & 0xff) * (1 - amount));
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
}
