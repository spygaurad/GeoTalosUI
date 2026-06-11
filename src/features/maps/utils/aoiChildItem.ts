import { datasetsApi } from '@/lib/api/datasets';
import { stacApi } from '@/lib/api/stac';
import type { BandSelection, LayerConfig } from '@/features/maps/types';
import { useMapLayersStore } from '@/stores/mapLayersStore';
import { buildTileUrlFromConfig } from '@/features/maps/utils/datasetItemLayer';

function buildAoiItemTileUrl(
  tileTemplate: string,
  defaultQuery: string,
  layerSnapshot: LayerConfig,
  renderingConfig: LayerConfig['renderingConfig'],
  bandSelection: BandSelection | null,
  activePreset: string | null,
): string {
  const params = new URLSearchParams();
  
  // AOI child layers: prioritize user-selected bands over preset
  // If user selects bands, use RGB. Only fall back to preset if no bands selected.
  if (bandSelection) {
    params.set('asset_bidx', `data|${bandSelection.r},${bandSelection.g},${bandSelection.b}`);
    const rBand = renderingConfig?.bands?.find((b) => b.index === bandSelection.r);
    const gBand = renderingConfig?.bands?.find((b) => b.index === bandSelection.g);
    const bBand = renderingConfig?.bands?.find((b) => b.index === bandSelection.b);
    if (rBand && gBand && bBand) {
      const p2 = Math.min(rBand.stats.p2, gBand.stats.p2, bBand.stats.p2);
      const p98 = Math.max(rBand.stats.p98, gBand.stats.p98, bBand.stats.p98);
      params.set('rescale', `${Math.round(p2)},${Math.round(p98)}`);
    }
  } else if (activePreset && renderingConfig?.presets?.[activePreset]) {
    Object.entries(renderingConfig.presets[activePreset].params).forEach(([key, value]) => {
      if (value) params.set(key, String(value));
    });
  } else if (!!renderingConfig && renderingConfig.bands.length >= 3) {
    // Fallback to RGB default if no bands selected and no preset
    const r = renderingConfig.bands[0]?.index ?? 1;
    const g = renderingConfig.bands[1]?.index ?? 2;
    const b = renderingConfig.bands[2]?.index ?? 3;
    params.set('asset_bidx', `data|${r},${g},${b}`);
    const rBand = renderingConfig.bands.find((band) => band.index === r);
    const gBand = renderingConfig.bands.find((band) => band.index === g);
    const bBand = renderingConfig.bands.find((band) => band.index === b);
    if (rBand && gBand && bBand) {
      const p2 = Math.min(rBand.stats.p2, gBand.stats.p2, bBand.stats.p2);
      const p98 = Math.max(rBand.stats.p98, gBand.stats.p98, bBand.stats.p98);
      params.set('rescale', `${Math.round(p2)},${Math.round(p98)}`);
    }
  } else {
    const defaults = new URLSearchParams(defaultQuery);
    defaults.forEach((value, key) => params.set(key, value));
  }

  if (layerSnapshot.clipBounds) {
    params.set('bbox', layerSnapshot.clipBounds.join(','));
  }

  const qs = params.toString();
  return qs ? `${tileTemplate}?${qs}` : tileTemplate;
}

export async function switchAoiChildLayerToItem(args: {
  childLayerId: string;
  datasetId: string;
  stacItemId: string;
  layerSnapshot: LayerConfig;
  bandSelection?: BandSelection | null;
  activePreset?: string | null;
}): Promise<void> {
  const {
    childLayerId,
    datasetId,
    stacItemId,
    layerSnapshot,
    bandSelection = layerSnapshot.bandSelection ?? null,
    activePreset = layerSnapshot.activePreset ?? null,
  } = args;

  const tileConfig = await datasetsApi.getItemTileConfigByStacId(datasetId, stacItemId);
  if (!tileConfig.tile_url_template) throw new Error('Item has no tile URL template');

  const { tileUrl: defaultTileUrl } = buildTileUrlFromConfig(tileConfig);
  const [tilePath, defaultQs = ''] = defaultTileUrl.split('?');
  const renderingConfig = tileConfig.rendering_config ?? layerSnapshot.renderingConfig ?? null;

  const tileUrl = buildAoiItemTileUrl(
    tilePath,
    defaultQs,
    layerSnapshot,
    renderingConfig,
    bandSelection,
    bandSelection ? null : activePreset,
  );

  useMapLayersStore.setState((state) => {
    const existing = state.layers[childLayerId];
    if (!existing) return state;
    return {
      layers: {
        ...state.layers,
        [childLayerId]: {
          ...existing,
          tileUrl,
          stacItemId,
          renderingConfig,
          bandSelection,
          activePreset: bandSelection ? null : activePreset,
          loading: false,
        },
      },
    };
  });
}

export async function switchAoiChildLayerToFirstItem(args: {
  childLayerId: string;
  datasetId: string;
  layerSnapshot: LayerConfig;
}): Promise<void> {
  const { childLayerId, datasetId, layerSnapshot } = args;
  const collectionId = layerSnapshot.stacCollectionId;
  const bbox = layerSnapshot.clipBounds;
  if (!collectionId || !bbox) return;

  const response = await stacApi.listCollectionItems(collectionId, {
    bbox: bbox.join(','),
    limit: 1,
  });
  const first = response.features?.[0];
  if (!first) return;

  await switchAoiChildLayerToItem({
    childLayerId,
    datasetId,
    stacItemId: first.id,
    layerSnapshot,
  });
}
