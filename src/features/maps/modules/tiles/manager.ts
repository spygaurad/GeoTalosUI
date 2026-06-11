/**
 * Tiles Module — Manager Extension
 *
 * Provides tile layer creation methods as a module extension.
 * Extracted from MapManager.ts to follow the modular architecture.
 *
 * Methods:
 *  - createAuthTileLayer  — authenticated tile layer (Clerk JWT via fetch+blob)
 *  - createPublicTileLayer — unauthenticated tile layer (tile services)
 *  - getLeafletTileBounds  — convert LayerConfig.tileBounds to L.LatLngBoundsExpression
 *  - setTileLayerUrl       — swap a tile URL in-place (smooth timeline animation)
 */

import type L from 'leaflet';
import type { ManagerContext } from '../../core/types';
import type { LayerConfig } from '../../types';
import { getAuthToken } from '@/lib/api/client';

export function createTilesManagerExtension(ctx: ManagerContext) {
  const { L, leafletLayers } = ctx;

  function getLeafletTileBounds(config: LayerConfig): L.LatLngBoundsExpression | undefined {
    if (!config.tileBounds) return undefined;
    const [w, s, e, n] = config.tileBounds;
    // Skip world bounds or center-of-earth — these indicate invalid TileJSON bounds
    const isWorld =
      Math.abs(w - -180) < 0.01 &&
      Math.abs(s - -85.05) < 0.01 &&
      Math.abs(e - 180) < 0.01 &&
      Math.abs(n - 85.05) < 0.01;
    const isCenter =
      Math.abs(w) < 0.0001 &&
      Math.abs(s) < 0.0001 &&
      Math.abs(e) < 0.0001 &&
      Math.abs(n) < 0.0001;
    if (isWorld || isCenter) return undefined;
    return [
      [s, w],
      [n, e],
    ];
  }

  function createAuthTileLayer(
    url: string,
    config: LayerConfig,
    paneName = 'awakeforest-data',
  ): L.TileLayer {
    const leafletBounds = getLeafletTileBounds(config);

    type TileLayerCtor = new (url: string, opts?: L.TileLayerOptions) => L.TileLayer;

    // Subclass TileLayer to inject Clerk JWT via fetch + blob URL.
    // This mirrors the pattern in MapManager.createAuthTileLayer.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const AuthTileLayer = (L.TileLayer as any).extend({
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
            img.onload = () => {
              URL.revokeObjectURL(objUrl);
              done(undefined, img);
            };
            img.onerror = () => {
              URL.revokeObjectURL(objUrl);
              done(new Error('tile load'), img);
            };
            img.src = objUrl;
          })
          .catch((e) => done(e as Error, img));

        return img;
      },
    }) as TileLayerCtor;

    return new AuthTileLayer(url, {
      pane: paneName,
      opacity: config.opacity,
      minZoom: config.tileMinZoom ?? 0,
      maxZoom: config.tileMaxZoom ?? 24,
      tileSize: 256,
      ...(leafletBounds ? { bounds: leafletBounds } : {}),
    });
  }

  return {
    createAuthTileLayer,
    getLeafletTileBounds,

    /** Create a non-authenticated tile layer (for public tile services). */
    createPublicTileLayer(
      url: string,
      config: LayerConfig,
      paneName = 'awakeforest-data',
    ): L.TileLayer {
      const leafletBounds = getLeafletTileBounds(config);
      return L.tileLayer(url, {
        pane: paneName,
        opacity: config.opacity,
        minZoom: config.tileMinZoom ?? 0,
        maxZoom: config.tileMaxZoom ?? 24,
        tileSize: 256,
        ...(leafletBounds ? { bounds: leafletBounds } : {}),
      });
    },

    /**
     * Update a tile layer's URL in-place without destroying and recreating it.
     * Used for smooth AOI temporal animation — avoids tile flicker from layer rebuild.
     */
    setTileLayerUrl(id: string, url: string): void {
      const layer = leafletLayers.get(id);
      if (!layer) return;

      let tileLayer: L.TileLayer | null = null;
      if (typeof (layer as L.TileLayer).setUrl === 'function') {
        tileLayer = layer as L.TileLayer;
      } else if (typeof (layer as L.LayerGroup).eachLayer === 'function') {
        (layer as L.LayerGroup).eachLayer((child) => {
          if (typeof (child as L.TileLayer).setUrl === 'function') {
            tileLayer = child as L.TileLayer;
          }
        });
      }
      if (tileLayer) tileLayer.setUrl(url, false);
    },
  };
}

export type TilesManagerExtension = ReturnType<typeof createTilesManagerExtension>;
