import { datasetsApi, type ItemTileConfigResponse } from '@/lib/api/datasets';
import { geometryToTileBounds } from '@/lib/geo';
import { useMapLayersStore } from '@/stores/mapLayersStore';
import type { DatasetItem } from '@/types/api';
import type { BandSelection } from '@/features/maps/types';
import {
  buildSegmentationColormapForMap,
  applyColormapToTileUrl,
} from '@/features/maps/utils/segmentationColormap';

export function getDatasetItemLayerId(stacItemId: string): string {
  return `item-${stacItemId}`;
}

export function buildTileUrlFromConfig(config: ItemTileConfigResponse): {
  tileUrl: string;
  activePreset: string | null;
  bandSelection: BandSelection | null;
} {
  let tileUrl = config.tile_url_template;
  let activePreset: string | null = null;
  let bandSelection: BandSelection | null = null;

  if (config.rendering_config?.default_preset && config.rendering_config.presets) {
    const defaultPreset = config.rendering_config.default_preset;
    const presetConfig = config.rendering_config.presets[defaultPreset];
    if (presetConfig?.params) {
      const params = new URLSearchParams();
      Object.entries(presetConfig.params).forEach(([key, value]) => {
        if (value) params.set(key, String(value));
      });
      const qs = params.toString();
      tileUrl = qs ? `${config.tile_url_template}?${qs}` : config.tile_url_template;
      activePreset = defaultPreset;
    }
  } else if (config.rendering_config?.bands && config.rendering_config.bands.length >= 3) {
    const bands = config.rendering_config.bands;
    const r = bands[0]?.index ?? 1;
    const g = bands[1]?.index ?? 2;
    const b = bands[2]?.index ?? 3;
    const assetBidx = `data|${r},${g},${b}`;

    const p2Vals = [bands[0]?.stats?.p2, bands[1]?.stats?.p2, bands[2]?.stats?.p2].filter(
      (v): v is number => typeof v === 'number',
    );
    const p98Vals = [bands[0]?.stats?.p98, bands[1]?.stats?.p98, bands[2]?.stats?.p98].filter(
      (v): v is number => typeof v === 'number',
    );

    const params = new URLSearchParams();
    params.set('asset_bidx', assetBidx);
    if (p2Vals.length === 3 && p98Vals.length === 3) {
      const rescale = `${Math.round(Math.min(...p2Vals))},${Math.round(Math.max(...p98Vals))}`;
      params.set('rescale', rescale);
    }
    tileUrl = `${config.tile_url_template}?${params.toString()}`;
    bandSelection = { r, g, b };
  }

  return { tileUrl, activePreset, bandSelection };
}

export async function addDatasetItemLayerToMap({
  mapId,
  datasetId,
  item,
}: {
  mapId: string;
  datasetId: string;
  item: DatasetItem;
}): Promise<string> {
  const layerId = getDatasetItemLayerId(item.stac_item_id);
  const store = useMapLayersStore.getState();
  if (store.layers[layerId]) return layerId;

  const cfg = await datasetsApi.getItemTileConfig(datasetId, item.id);
  const built = buildTileUrlFromConfig(cfg);
  const { activePreset, bandSelection } = built;
  let { tileUrl } = built;

  // Segmentation masks: override the default palette with class colors derived
  // from the schema classes' styles (self-heals when a class color changes).
  if (cfg.rendering_config?.class_map) {
    const cmap = await buildSegmentationColormapForMap(cfg.rendering_config.class_map);
    if (cmap) tileUrl = applyColormapToTileUrl(tileUrl, cmap);
  }

  const tileBounds = geometryToTileBounds(item.geometry);

  const backendLayer = await datasetsApi.addMapLayer(mapId, {
    name: item.stac_item_id,
    layer_type: 'raster',
    source_type: 'stac_item',
    stac_item_id: item.stac_item_id,
    source_config: { dataset_id: datasetId },
    visible: true,
    opacity: 1.0,
  });

  store.initLayer(layerId, 'dataset', {
    name: item.stac_item_id,
    sourceType: 'stac_item',
    parentDatasetId: datasetId,
    stacItemId: item.stac_item_id,
    tileUrl,
  });
  store.setBackendLayerId(layerId, backendLayer.id);
  store.setLayerTileConfig(layerId, tileBounds ? { tileUrl, tileBounds } : { tileUrl });

  if (cfg.rendering_config) {
    store.setLayerRenderingConfig(layerId, cfg.rendering_config);
    if (activePreset) {
      store.setLayerBandSelection(layerId, null, activePreset);
    } else if (bandSelection) {
      store.setLayerBandSelection(layerId, bandSelection, null);
    }
  }

  if (tileBounds) {
    store.requestZoomToBounds(tileBounds);
  }

  return layerId;
}

export async function removeDatasetItemLayerFromMap({
  mapId,
  layerId,
}: {
  mapId: string;
  layerId: string;
}): Promise<void> {
  const store = useMapLayersStore.getState();
  const backendId = store.backendLayerIds[layerId];
  if (backendId) {
    await datasetsApi.deleteMapLayer(mapId, backendId);
  }
  store.removeLayer(layerId);
}
