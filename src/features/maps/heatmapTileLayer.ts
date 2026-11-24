/**
 * Heatmap for dense reference layers, drawn from a point tileset (one point per
 * polygon, clustered at low zoom: see scripts/reference_layers/build_pmtiles.sh).
 * Each point is a soft blob; the blobs add up, then the summed alpha is coloured.
 * Much lighter than thousands of overlapping boxes, and it reads as "how much".
 *
 * A tile also draws the points of its 8 neighbours, so a blob that crosses a tile
 * edge has no seam. Decoded tiles are kept in a small cache so neighbours are fetched once.
 * ponytail: a plain Map cache capped at 300 tiles; use an LRU if memory matters.
 */
import type L from 'leaflet';
import Pbf from 'pbf';
import { VectorTile } from 'vector-tile';

const SIZE = 256;
/** Last zoom drawn as a heatmap; the box layer takes over above it. */
export const HEATMAP_MAX_ZOOM = 9;

type Pt = { x: number; y: number; v: number; n: number }; // x, y in 0..1 of the tile; v summed weight, n cluster size
type Opts = {
  tileUrl: string;
  /** Source layer name inside the tiles (same as the Martin source id). */
  layerName: string;
  colour: string;
  opacity: number;
  radius: number;
  /** True when the style picked a weight attribute: use summed `w`, else the cluster size. */
  weighted: boolean;
  /** Weight that counts as "full" (log scale). Default suits areas in hectares. */
  weightRef?: number;
  /** Cluster size that counts as "full" when not weighted. Default 8, set for the mining layers. */
  countRef?: number;
  minZoom: number;
  /** Hidden above this zoom (the boxes take over where polygons are far apart). */
  maxZoom?: number;
  maxNativeZoom: number;
  attribution?: string | null;
  getToken: () => Promise<string | null | undefined>;
};

const cache = new Map<string, Promise<Pt[]>>();

async function loadPoints(url: string, layerName: string, getToken: Opts['getToken']): Promise<Pt[]> {
  const hit = cache.get(url);
  if (hit) return hit;
  const p = (async () => {
    try {
      const token = await getToken();
      const resp = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (resp.status === 204 || !resp.ok) return [];
      const tile = new VectorTile(new Pbf(new Uint8Array(await resp.arrayBuffer())));
      const layer = tile.layers[layerName];
      if (!layer) return [];
      const out: Pt[] = [];
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        const g = f.loadGeometry()[0]?.[0];
        if (!g) continue;
        // Tippecanoe repeats points near the edge in the neighbour tile's buffer. The neighbours
        // are drawn anyway, so keep only this tile's own points or edges count twice (seams).
        if (g.x < 0 || g.y < 0 || g.x >= layer.extent || g.y >= layer.extent) continue;
        const props = f.properties as Record<string, number | undefined>;
        // `w` is the summed weight; point_count is only set on clusters. Both are kept so a
        // change of weight setting needs no refetch.
        out.push({ x: g.x / layer.extent, y: g.y / layer.extent, v: props.w ?? 1, n: props.point_count ?? 1 });
      }
      return out;
    } catch {
      return []; // a failed tile stays empty instead of an unhandled rejection
    }
  })();
  if (cache.size >= 300) cache.delete(cache.keys().next().value as string);
  cache.set(url, p);
  return p;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

type Rgb = [number, number, number];
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as Rgb;

/** Soft blob sprite, drawn once per radius. */
function blob(radius: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = radius * 2;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(radius, radius, 0, radius, radius, radius);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, radius * 2, radius * 2);
  return c;
}

export function createHeatmapLayer(Lf: typeof L, o: Opts): L.GridLayer {
  const base = hexToRgb(o.colour);
  const light = mix(base, [255, 255, 255], 0.65);
  const dark = mix(base, [0, 0, 0], 0.45);
  const sprite = blob(o.radius);
  // Weight to 0..1: area in hectares is spread over orders of magnitude, so use a log scale.
  // A layer that gives its own top value (population, uploads) gets a square root scale and no
  // floor instead: dense point fields would otherwise pile the floor up into one flat colour.
  const scaled = o.weighted && o.weightRef !== undefined;
  const ref = o.weighted ? (o.weightRef ?? 5000) : (o.countRef ?? 8);
  const strength = (p: Pt) =>
    scaled ? Math.min(1, Math.sqrt(Math.max(0, p.v) / ref)) : Math.min(1, Math.log1p(o.weighted ? p.v : p.n) / Math.log1p(ref));
  const floor = scaled ? 0 : 0.03;

  const Layer = Lf.GridLayer.extend({
    createTile(coords: L.Coords, done: L.DoneCallback) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = SIZE;
      const n = 2 ** coords.z;
      const jobs: Promise<{ dx: number; dy: number; pts: Pt[] }>[] = [];
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const x = coords.x + dx;
          const y = coords.y + dy;
          if (x < 0 || y < 0 || x >= n || y >= n) continue;
          const url = Lf.Util.template(o.tileUrl, { z: coords.z, x, y });
          jobs.push(loadPoints(url, o.layerName, o.getToken).then((pts) => ({ dx, dy, pts })));
        }
      }
      Promise.all(jobs).then((parts) => {
        const ctx = canvas.getContext('2d')!;
        for (const { dx, dy, pts } of parts) {
          for (const p of pts) {
            const px = (p.x + dx) * SIZE;
            const py = (p.y + dy) * SIZE;
            if (px < -o.radius || py < -o.radius || px > SIZE + o.radius || py > SIZE + o.radius) continue;
            ctx.globalAlpha = floor + (scaled ? 0.2 : 0.1) * strength(p);
            ctx.drawImage(sprite, px - o.radius, py - o.radius);
          }
        }
        // Colour by how much the blobs piled up: pale and see-through where thin, the chosen
        // colour in the middle, darker where dense, so sparse and dense areas read apart.
        const img = ctx.getImageData(0, 0, SIZE, SIZE);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
          const t = Math.min(1, d[i + 3] / 255);
          if (t === 0) continue;
          const [cr, cg, cb] = t < 0.5 ? mix(light, base, t * 2) : mix(base, dark, (t - 0.5) * 2);
          d[i] = cr; d[i + 1] = cg; d[i + 2] = cb;
          d[i + 3] = Math.round(255 * (0.12 + 0.88 * t) * o.opacity);
        }
        ctx.putImageData(img, 0, 0);
        done(undefined, canvas);
      }, () => done(undefined, canvas));
      return canvas;
    },
  });

  return new (Layer as unknown as new (opts: L.GridLayerOptions) => L.GridLayer)({
    pane: 'awakeforest-data',
    tileSize: SIZE,
    minZoom: o.minZoom,
    maxZoom: o.maxZoom,
    maxNativeZoom: o.maxNativeZoom,
    attribution: o.attribution ?? undefined,
  });
}
