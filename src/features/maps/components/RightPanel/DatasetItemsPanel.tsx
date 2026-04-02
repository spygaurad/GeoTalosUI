'use client';

import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Calendar, FileImage, Map, Loader, ChevronLeft, Filter } from 'lucide-react';
import { datasetsApi } from '@/lib/api/datasets';
import { qk } from '@/lib/query-keys';
import { useMapLayersStore } from '@/stores/mapLayersStore';
import { getMapInstance } from '@/stores/mapStore';
import type { DatasetItem } from '@/types/api';
import { MC } from '../../mapColors';

interface DatasetItemsPanelProps {
  datasetId: string;
  mapId?: string;
}

export function DatasetItemsPanel({ datasetId, mapId }: DatasetItemsPanelProps) {
  const queryClient = useQueryClient();
  const initLayer = useMapLayersStore((s) => s.initLayer);
  const setBackendLayerId = useMapLayersStore((s) => s.setBackendLayerId);
  const setLayerTileConfig = useMapLayersStore((s) => s.setLayerTileConfig);
  const openDatasetPanel = useMapLayersStore((s) => s.openDatasetPanel);
  const layers = useMapLayersStore((s) => s.layers);
  const [addingItemId, setAddingItemId] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Fetch dataset details
  const { data: dataset } = useQuery({
    queryKey: qk.datasets.detail(datasetId),
    queryFn: () => datasetsApi.get(datasetId),
  });

  // Fetch items in the dataset
  const { data: itemsData, isLoading } = useQuery({
    queryKey: qk.datasets.items(datasetId),
    queryFn: () => datasetsApi.listItems(datasetId, { page_size: 100 }),
    enabled: !!datasetId,
  });

  const allItems = useMemo(() => itemsData?.items ?? [], [itemsData]);

  // Apply date range filter
  const items = useMemo(() => {
    if (!dateFrom && !dateTo) return allItems;
    return allItems.filter((item) => {
      if (!item.datetime) return true;
      const d = new Date(item.datetime).getTime();
      if (dateFrom && d < new Date(dateFrom).getTime()) return false;
      if (dateTo && d > new Date(dateTo + 'T23:59:59').getTime()) return false;
      return true;
    });
  }, [allItems, dateFrom, dateTo]);

  // Add a single item as a stac_item layer on the map
  const addItemToMap = async (item: DatasetItem) => {
    if (!mapId) return;
    setAddingItemId(item.id);

    try {
      const layerId = `item-${item.stac_item_id}`;

      // 1. Register the layer in the backend (integration guide §3A)
      const bl = await datasetsApi.addMapLayer(mapId, {
        name: item.stac_item_id,
        layer_type: 'raster',
        source_type: 'stac_item',
        stac_item_id: item.stac_item_id,
        source_config: { dataset_id: datasetId },
        visible: true,
        opacity: 1.0,
      });

      // 2. Init in store
      initLayer(layerId, 'dataset', {
        sourceType: 'stac_item',
        parentDatasetId: datasetId,
        stacItemId: item.stac_item_id,
      });
      setBackendLayerId(layerId, bl.id);

      // 3. Fetch tile URL template + rendering config
      try {
        const cfg = await datasetsApi.getItemTileConfig(datasetId, item.id);
        if (cfg.tile_url_template) {
          setLayerTileConfig(layerId, { tileUrl: cfg.tile_url_template });
        }
        if (cfg.rendering_config) {
          useMapLayersStore.getState().setLayerRenderingConfig(layerId, cfg.rendering_config);
        }
      } catch {
        // Tile config not available yet
      }

      // 4. Fly to item geometry
      if (item.geometry) {
        const map = getMapInstance();
        if (map) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const L = require('leaflet') as typeof import('leaflet');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const geoLayer = L.geoJSON(item.geometry as any);
            map.fitBounds(geoLayer.getBounds(), { padding: [40, 40], maxZoom: 16 });
          } catch {
            // ignore fly-to errors
          }
        }
      }

      queryClient.invalidateQueries({ queryKey: ['map-layers', mapId] });
      toast.success(`Item added to map`);
    } catch {
      toast.error('Failed to add item');
    } finally {
      setAddingItemId(null);
    }
  };

  // Check if an item is already on the map
  const isOnMap = (stacItemId: string) => !!layers[`item-${stacItemId}`];

  // Group items by date
  const itemsByDate = items.reduce<Record<string, DatasetItem[]>>((acc, item) => {
    const date = item.datetime
      ? new Date(item.datetime).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
      : 'Unknown date';
    if (!acc[date]) acc[date] = [];
    acc[date].push(item);
    return acc;
  }, {});

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Back + dataset name */}
      <div style={{
        padding: '10px 14px',
        borderBottom: `1px solid ${MC.border}`,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <button
          onClick={() => openDatasetPanel(datasetId)}
          title="Back to dataset info"
          style={{
            width: 24, height: 24,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'transparent', border: 'none',
            color: MC.textMuted, cursor: 'pointer', borderRadius: 4,
          }}
        >
          <ChevronLeft size={14} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13, fontWeight: 700, color: MC.text,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {dataset?.name ?? 'Dataset'}
          </div>
          <div style={{ fontSize: 10, color: MC.textMuted }}>
            {items.length} item{items.length !== 1 ? 's' : ''}
            {items.length !== allItems.length && ` of ${allItems.length}`}
            {' · Select individual files to overlay'}
          </div>
        </div>

        {/* Filter toggle */}
        <button
          onClick={() => setShowFilters((v) => !v)}
          title="Filter items"
          style={{
            width: 28, height: 28,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: showFilters ? MC.accentDim : 'transparent',
            border: showFilters ? `1px solid ${MC.accent}` : 'none',
            color: showFilters ? MC.accent : MC.textMuted,
            cursor: 'pointer', borderRadius: 4, flexShrink: 0,
          }}
        >
          <Filter size={12} />
        </button>
      </div>

      {/* Date range filter */}
      {showFilters && (
        <div style={{
          padding: '8px 14px',
          borderBottom: `1px solid ${MC.border}`,
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 10, color: MC.textMuted, flexShrink: 0 }}>Date</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            style={{
              flex: 1,
              background: MC.inputBg ?? MC.hoverBg,
              border: `1px solid ${MC.border}`,
              borderRadius: 4,
              color: MC.text,
              fontSize: 10,
              padding: '3px 6px',
              outline: 'none',
            }}
          />
          <span style={{ fontSize: 10, color: MC.textMuted }}>–</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            style={{
              flex: 1,
              background: MC.inputBg ?? MC.hoverBg,
              border: `1px solid ${MC.border}`,
              borderRadius: 4,
              color: MC.text,
              fontSize: 10,
              padding: '3px 6px',
              outline: 'none',
            }}
          />
          {(dateFrom || dateTo) && (
            <button
              onClick={() => { setDateFrom(''); setDateTo(''); }}
              style={{
                background: 'transparent', border: 'none',
                color: MC.textMuted, cursor: 'pointer', fontSize: 10,
                padding: '2px 4px',
              }}
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Items list */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {isLoading ? (
          <div style={{
            padding: '32px 20px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
          }}>
            <Loader size={20} style={{ color: MC.textMuted, animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 12, color: MC.textMuted }}>Loading items…</span>
          </div>
        ) : items.length === 0 ? (
          <div style={{
            padding: '32px 20px',
            textAlign: 'center',
          }}>
            <FileImage size={28} style={{ color: MC.borderLight, margin: '0 auto 10px' }} />
            <div style={{ fontSize: 13, color: MC.textSecondary, marginBottom: 4 }}>
              No items found
            </div>
            <div style={{ fontSize: 11, color: MC.textMuted }}>
              Items appear after the dataset finishes ingesting.
            </div>
          </div>
        ) : (
          Object.entries(itemsByDate).map(([date, dateItems]) => (
            <div key={date}>
              {/* Date header */}
              <div style={{
                padding: '8px 14px 4px',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                position: 'sticky',
                top: 0,
                background: MC.panelBg,
                zIndex: 1,
              }}>
                <Calendar size={10} style={{ color: MC.accent, flexShrink: 0 }} />
                <span style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: MC.sectionLabel,
                }}>
                  {date}
                </span>
                <span style={{ fontSize: 10, color: MC.textMuted }}>
                  ({dateItems.length})
                </span>
              </div>

              {/* Item rows */}
              {dateItems.map((item) => {
                const onMap = isOnMap(item.stac_item_id);
                const adding = addingItemId === item.id;

                return (
                  <div
                    key={item.id}
                    style={{
                      padding: '8px 14px',
                      borderBottom: `1px solid ${MC.border}`,
                      display: 'flex',
                      gap: 10,
                      alignItems: 'center',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 12,
                        fontWeight: 500,
                        color: MC.text,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }} title={item.stac_item_id}>
                        {item.stac_item_id}
                      </div>
                      {item.datetime && (
                        <div style={{ fontSize: 10, color: MC.textMuted, marginTop: 1 }}>
                          {new Date(item.datetime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => {
                        if (onMap || adding) return;
                        addItemToMap(item);
                      }}
                      disabled={onMap || adding}
                      style={{
                        flexShrink: 0,
                        height: 26,
                        padding: '0 10px',
                        borderRadius: 4,
                        border: `1px solid ${onMap ? MC.borderLight : MC.accent}`,
                        background: onMap ? 'transparent' : MC.accentDim,
                        color: onMap ? MC.textMuted : MC.accent,
                        cursor: onMap || adding ? 'default' : 'pointer',
                        fontSize: 11,
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        transition: 'all 0.1s',
                      }}
                    >
                      {onMap ? 'On map' : adding ? (
                        <Loader size={10} style={{ animation: 'spin 1s linear infinite' }} />
                      ) : (
                        <>
                          <Map size={10} />
                          Add
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
