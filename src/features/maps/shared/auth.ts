/**
 * Shared authenticated tile layer factory.
 *
 * Creates a Leaflet TileLayer subclass that injects a Clerk JWT Bearer token
 * into each tile request via fetch() + blob URL. Used by both the tiles module
 * and the AOI module (for clipped child layers).
 */

import type L from 'leaflet';
import { getAuthToken } from '@/lib/api/client';
import type { LayerConfig } from '../types';

type TileLayerCtor = new (url: string, opts?: L.TileLayerOptions) => L.TileLayer;

/**
 * Create an authenticated tile layer for a given URL and layer config.
 *
 * @param L          - The Leaflet module reference (passed from MapManager context)
 * @param url        - The tile URL template (with {z}/{x}/{y} placeholders)
 * @param config     - Layer config (for opacity, zoom range, bounds)
 * @param paneName   - Leaflet pane name (default: 'awakeforest-data')
 * @param tileBounds - Optional Leaflet bounds expression to limit tile requests
 */
export function createAuthTileLayer(
  L: typeof import('leaflet'),
  url: string,
  config: Pick<LayerConfig, 'opacity' | 'tileMinZoom' | 'tileMaxZoom'>,
  paneName = 'awakeforest-data',
  tileBounds?: L.LatLngBoundsExpression,
): L.TileLayer {
  const AuthTileLayer = (L.TileLayer as unknown as { extend: (opts: object) => TileLayerCtor }).extend({
    createTile(coords: L.Coords, done: L.DoneCallback) {
      const img = L.DomUtil.create('img', 'leaflet-tile') as HTMLImageElement;
      img.alt = '';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tileUrl = (this as any).getTileUrl(coords) as string;

      getAuthToken()
        .then((token) =>
          fetch(tileUrl, token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
        )
        .then((r) => {
          if (!r.ok) throw new Error(`Tile ${r.status}`);
          return r.blob();
        })
        .then((blob) => {
          const objUrl = URL.createObjectURL(blob);
          img.onload = () => { URL.revokeObjectURL(objUrl); done(undefined, img); };
          img.onerror = () => { URL.revokeObjectURL(objUrl); done(new Error('tile load'), img); };
          img.src = objUrl;
        })
        .catch((e) => done(e as Error, img));

      return img;
    },
  });

  return new AuthTileLayer(url, {
    pane: paneName,
    opacity: config.opacity,
    minZoom: config.tileMinZoom ?? 0,
    maxZoom: config.tileMaxZoom ?? 24,
    tileSize: 256,
    ...(tileBounds ? { bounds: tileBounds } : {}),
  });
}
