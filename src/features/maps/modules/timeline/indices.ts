/**
 * Spectral index registry for AOI temporal playback.
 *
 * Each entry describes a band-math index that can be applied per-frame as a
 * TiTiler `expression`. The registry drives:
 *   - the index dropdown in AoiTemporalPanel,
 *   - the role→band auto-detection + manual pickers,
 *   - the rescale/colormap defaults used when rendering tiles,
 *   - the colour legend + threshold slider bounds.
 *
 * v1 is intentionally limited to NORMALIZED-DIFFERENCE indices. These are
 * ratios, so they are scale-invariant: they render correctly whether the
 * underlying bands are surface reflectance [0,1] or raw DN. Indices with
 * additive constants (EVI, SAVI) assume reflectance and are deferred until we
 * normalize band values first.
 */

import type { BandInfo } from '@/types/api';

export type IndexRole = 'nir' | 'red' | 'green' | 'blue' | 'red_edge' | 'swir1' | 'swir2';

export interface SpectralIndexDef {
  id: string;
  label: string;
  /** One-line description shown in the dropdown / tooltip. */
  description: string;
  /** Band roles this index needs, in display order. */
  roles: IndexRole[];
  /** Build the TiTiler expression. `bands` maps role → 1-based band index. */
  expr: (bands: Record<IndexRole, number>) => string;
  /** Value domain [min,max] — used for rescale + threshold slider bounds. */
  domain: [number, number];
  /** TiTiler builtin colormap name, applied when no threshold is set. */
  colormap: string;
  /** Colour ramp stops low→high (hex) — builds the threshold colormap + legend. */
  ramp: string[];
  /** What the LOW end of the ramp means (hidden first by the threshold). */
  legendLow: string;
  /** What the HIGH end of the ramp means. */
  legendHigh: string;
}

// ── Colour ramps ────────────────────────────────────────────────────────────
const RD_YL_GN = [
  '#a50026', '#d73027', '#f46d43', '#fdae61', '#fee08b',
  '#d9ef8b', '#a6d96a', '#66bd63', '#1a9850', '#006837',
];
const BR_BG = ['#8c510a', '#bf812d', '#dfc27d', '#c7eae5', '#5ab4ac', '#01665e'];
const BLUES = ['#f7fbff', '#c6dbef', '#9ecae1', '#6baed6', '#3182bd', '#08519c'];

/** Normalized difference helper: (a-b)/(a+b). */
const nd = (a: number, b: number) => `(data_b${a}-data_b${b})/(data_b${a}+data_b${b})`;

export const SPECTRAL_INDICES: SpectralIndexDef[] = [
  {
    id: 'ndvi',
    label: 'NDVI',
    description: 'Vegetation greenness / vigour',
    roles: ['nir', 'red'],
    expr: (b) => nd(b.nir, b.red),
    domain: [-1, 1],
    colormap: 'rdylgn',
    ramp: RD_YL_GN,
    legendLow: 'Bare / stressed',
    legendHigh: 'Healthy canopy',
  },
  {
    id: 'gndvi',
    label: 'GNDVI',
    description: 'Chlorophyll / nitrogen content',
    roles: ['nir', 'green'],
    expr: (b) => nd(b.nir, b.green),
    domain: [-1, 1],
    colormap: 'rdylgn',
    ramp: RD_YL_GN,
    legendLow: 'Low chlorophyll',
    legendHigh: 'High chlorophyll',
  },
  {
    id: 'ndre',
    label: 'NDRE',
    description: 'Canopy stress (red-edge, sees through dense canopy)',
    roles: ['nir', 'red_edge'],
    expr: (b) => nd(b.nir, b.red_edge),
    domain: [-1, 1],
    colormap: 'rdylgn',
    ramp: RD_YL_GN,
    legendLow: 'Stressed',
    legendHigh: 'Vigorous',
  },
  {
    id: 'ndmi',
    label: 'NDMI',
    description: 'Canopy moisture / drought stress',
    roles: ['nir', 'swir1'],
    expr: (b) => nd(b.nir, b.swir1),
    domain: [-1, 1],
    colormap: 'brbg',
    ramp: BR_BG,
    legendLow: 'Dry / water-stressed',
    legendHigh: 'High moisture',
  },
  {
    id: 'ndwi',
    label: 'NDWI',
    description: 'Open water (ponds, flooding, wetlands)',
    roles: ['green', 'nir'],
    expr: (b) => nd(b.green, b.nir),
    domain: [-1, 1],
    colormap: 'blues',
    ramp: BLUES,
    legendLow: 'Land',
    legendHigh: 'Open water',
  },
  {
    id: 'nbr',
    label: 'NBR',
    description: 'Burn mapping / fire severity',
    roles: ['nir', 'swir2'],
    expr: (b) => nd(b.nir, b.swir2),
    domain: [-1, 1],
    colormap: 'rdylgn',
    ramp: RD_YL_GN,
    legendLow: 'Burned',
    legendHigh: 'Unburned / healthy',
  },
];

export const getIndexDef = (id: string | null | undefined): SpectralIndexDef | null =>
  id ? SPECTRAL_INDICES.find((i) => i.id === id) ?? null : null;

// ── Band role resolution ─────────────────────────────────────────────────────

/** Match a band's spectral_name (or description) against role keyword patterns. */
const ROLE_PATTERNS: Record<IndexRole, RegExp> = {
  red_edge: /red.?edge|rededge|vre|veg.*red/i,
  swir1: /swir.?1|swir(?!.?2)|nir2|narrow.*nir/i,
  swir2: /swir.?2/i,
  nir: /\bnir\b|near.?infra/i,
  red: /\bred\b/i,
  green: /\bgreen\b/i,
  blue: /\bblue\b/i,
};

function bandText(b: BandInfo): string {
  return `${b.spectral_name ?? ''} ${b.description ?? ''}`.toLowerCase();
}

/**
 * Resolve each requested role to a band index using spectral_name/description.
 * `red_edge`/`swir2` are matched before `red`/`swir1` so the more specific
 * pattern wins (a "red edge" band must not be claimed by the `red` role).
 */
export function resolveRoleBands(
  bands: BandInfo[],
  roles: IndexRole[],
): Partial<Record<IndexRole, number>> {
  const claimed = new Set<number>();
  const out: Partial<Record<IndexRole, number>> = {};
  // Resolve specific roles first to avoid red_edge→red / swir2→swir1 collisions.
  const order: IndexRole[] = ['red_edge', 'swir2', 'swir1', 'nir', 'red', 'green', 'blue'];
  for (const role of order) {
    if (!roles.includes(role)) continue;
    const match = bands.find(
      (b) => !claimed.has(b.index) && ROLE_PATTERNS[role].test(bandText(b)),
    );
    if (match) {
      out[role] = match.index;
      claimed.add(match.index);
    }
  }
  return out;
}

/**
 * Auto-detected default band map for an index, or null if the dataset's bands
 * can't satisfy every role. NDVI keeps an order-based fallback (red=first,
 * nir=last) for legacy datasets that lack spectral_name metadata.
 */
export function defaultBandsForIndex(
  def: SpectralIndexDef,
  bands: BandInfo[],
): Record<IndexRole, number> | null {
  const resolved = resolveRoleBands(bands, def.roles);

  if (def.id === 'ndvi' && (resolved.nir == null || resolved.red == null) && bands.length >= 2) {
    resolved.nir ??= bands[bands.length - 1]?.index;
    resolved.red ??= bands[0]?.index;
  }

  const complete: Record<string, number> = {};
  for (const role of def.roles) {
    const idx = resolved[role];
    if (idx == null) return null; // dataset can't support this index
    complete[role] = idx;
  }
  return complete as Record<IndexRole, number>;
}

// ── Threshold colormap ───────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Sample a hex ramp at t∈[0,1] with linear interpolation. */
export function sampleRamp(ramp: string[], t: number): [number, number, number] {
  if (ramp.length === 1) return hexToRgb(ramp[0]);
  const clamped = Math.max(0, Math.min(1, t));
  const pos = clamped * (ramp.length - 1);
  const i = Math.floor(pos);
  const f = pos - i;
  const a = hexToRgb(ramp[i]);
  const b = hexToRgb(ramp[Math.min(i + 1, ramp.length - 1)]);
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

const THRESHOLD_SEGMENTS = 24;

/**
 * Build a TiTiler interval `colormap` JSON string for a lower-bound threshold:
 * values below `threshold` render fully transparent (revealing the basemap);
 * values in [threshold, domainMax] get the index ramp.
 *
 * Crucially, each visible segment is coloured by its **absolute** position in the
 * index domain, NOT by its position within the surviving [threshold, dmax] window.
 * Re-stretching the ramp across the window made values just above a high threshold
 * render red (the ramp's low end) even though they are healthy in absolute terms —
 * a misleading "red above the threshold" artefact. Sampling by absolute value keeps
 * colour meaning fixed: the threshold only controls visibility, not hue.
 */
export function buildThresholdColormap(def: SpectralIndexDef, threshold: number): string {
  const [dmin, dmax] = def.domain;
  const lo = Math.max(dmin, Math.min(threshold, dmax));
  const segs: [[number, number], [number, number, number, number]][] = [];
  // Transparent below threshold.
  if (lo > dmin) segs.push([[dmin, lo], [0, 0, 0, 0]]);
  const span = dmax - lo || 1;
  const domainSpan = dmax - dmin || 1;
  for (let i = 0; i < THRESHOLD_SEGMENTS; i++) {
    const a = lo + (span * i) / THRESHOLD_SEGMENTS;
    const b = lo + (span * (i + 1)) / THRESHOLD_SEGMENTS;
    // Colour by the segment midpoint's absolute domain position, not window position.
    const mid = (a + b) / 2;
    const [r, g, bl] = sampleRamp(def.ramp, (mid - dmin) / domainSpan);
    segs.push([[a, b], [r, g, bl, 255]]);
  }
  return JSON.stringify(segs);
}

/** CSS linear-gradient string for the legend bar. */
export function rampGradient(ramp: string[]): string {
  return `linear-gradient(to right, ${ramp.join(', ')})`;
}
