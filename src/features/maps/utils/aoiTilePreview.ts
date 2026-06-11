/**
 * Slippy-tile math + AOI stitching helpers for fetching a single PNG preview
 * of an AOI rectangle from any {z}/{x}/{y} tile URL template. Used by the
 * bbox-picker in the AOI inference panel.
 */

const TILE_SIZE = 256;
const MAX_TILES = 64;

function lngToTileX(lng: number, z: number) {
  return Math.floor(((lng + 180) / 360) * Math.pow(2, z));
}

function latToTileY(lat: number, z: number) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z),
  );
}

function lngLatToWorldPx(lng: number, lat: number, z: number) {
  const n = Math.pow(2, z);
  const x = ((lng + 180) / 360) * n * TILE_SIZE;
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * n * TILE_SIZE;
  return { x, y };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
  });
}

/** Drop the zoom until the AOI bbox fits within MAX_TILES tiles. */
export function clampZoomForTileBudget(
  bbox: [number, number, number, number],
  startZoom: number,
): number {
  const [W, S, E, N] = bbox;
  for (let z = Math.max(0, Math.min(22, startZoom)); z >= 0; z--) {
    const tx0 = lngToTileX(W, z);
    const tx1 = lngToTileX(E, z);
    const ty0 = latToTileY(N, z);
    const ty1 = latToTileY(S, z);
    const tiles = (Math.abs(tx1 - tx0) + 1) * (Math.abs(ty1 - ty0) + 1);
    if (tiles <= MAX_TILES) return z;
  }
  return 0;
}

/**
 * Fetch tiles for the AOI rectangle from a {z}/{x}/{y} template, stitch them
 * into a canvas, crop to the AOI bbox in world-pixel space, and return a
 * data URL plus the rendered dimensions.
 */
export async function renderAoiPreview(
  tileUrlTemplate: string,
  aoiBbox: [number, number, number, number],
  zoom: number,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const [W, S, E, N] = aoiBbox;
  const tx0 = Math.min(lngToTileX(W, zoom), lngToTileX(E, zoom));
  const tx1 = Math.max(lngToTileX(W, zoom), lngToTileX(E, zoom));
  const ty0 = Math.min(latToTileY(N, zoom), latToTileY(S, zoom));
  const ty1 = Math.max(latToTileY(N, zoom), latToTileY(S, zoom));

  const tileCountX = tx1 - tx0 + 1;
  const tileCountY = ty1 - ty0 + 1;
  if (tileCountX * tileCountY > MAX_TILES) {
    throw new Error(
      `AOI covers ${tileCountX * tileCountY} tiles at z${zoom}; reduce zoom or AOI`,
    );
  }

  const stitch = document.createElement('canvas');
  stitch.width = tileCountX * TILE_SIZE;
  stitch.height = tileCountY * TILE_SIZE;
  const sctx = stitch.getContext('2d');
  if (!sctx) throw new Error('Canvas 2D not available');

  const fetches: Promise<void>[] = [];
  for (let tx = tx0; tx <= tx1; tx++) {
    for (let ty = ty0; ty <= ty1; ty++) {
      const url = tileUrlTemplate
        .replace('{z}', String(zoom))
        .replace('{x}', String(tx))
        .replace('{y}', String(ty))
        .replace('{r}', '');
      fetches.push(
        fetch(url, { credentials: 'include' }).then(async (r) => {
          if (!r.ok) throw new Error(`tile ${tx},${ty} HTTP ${r.status}`);
          const blob = await r.blob();
          const ou = URL.createObjectURL(blob);
          try {
            const img = await loadImage(ou);
            sctx.drawImage(img, (tx - tx0) * TILE_SIZE, (ty - ty0) * TILE_SIZE);
          } finally {
            URL.revokeObjectURL(ou);
          }
        }),
      );
    }
  }
  await Promise.all(fetches);

  const tl = lngLatToWorldPx(W, N, zoom);
  const br = lngLatToWorldPx(E, S, zoom);
  const originX = tx0 * TILE_SIZE;
  const originY = ty0 * TILE_SIZE;
  const cropX = Math.max(0, Math.round(tl.x - originX));
  const cropY = Math.max(0, Math.round(tl.y - originY));
  const cropW = Math.max(1, Math.min(stitch.width - cropX, Math.round(br.x - tl.x)));
  const cropH = Math.max(1, Math.min(stitch.height - cropY, Math.round(br.y - tl.y)));

  const out = document.createElement('canvas');
  out.width = cropW;
  out.height = cropH;
  const octx = out.getContext('2d');
  if (!octx) throw new Error('Canvas 2D not available');
  octx.drawImage(stitch, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

  return {
    dataUrl: out.toDataURL('image/png'),
    width: cropW,
    height: cropH,
  };
}
