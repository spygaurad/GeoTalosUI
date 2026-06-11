'use client';

import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Calendar, FileImage, Map, Loader, ChevronLeft, Filter, Trash2 } from 'lucide-react';
import { datasetsApi } from '@/lib/api/datasets';
import { qk } from '@/lib/query-keys';
import { useMapLayersStore } from '@/stores/mapLayersStore';
import type { DatasetItem } from '@/types/api';
import { datasetItemLabel } from '@/features/datasets/itemLabel';
import { MC } from '../../mapColors';
import {
  addDatasetItemLayerToMap,
  getDatasetItemLayerId,
  removeDatasetItemLayerFromMap,
} from '@/features/maps/utils/datasetItemLayer';
import {
  switchAoiChildLayerToFirstItem,
  switchAoiChildLayerToItem,
} from '@/features/maps/utils/aoiChildItem';

interface DatasetItemsPanelProps {
  datasetId: string;
  mapId?: string;
}

export function DatasetItemsPanel({ datasetId, mapId }: DatasetItemsPanelProps) {
  const queryClient = useQueryClient();
  const openDatasetPanel = useMapLayersStore((s) => s.openDatasetPanel);
  const layers = useMapLayersStore((s) => s.layers);
  const selectedAoiLayerId = useMapLayersStore((s) => s.selectedAoiLayerId);
  const [actingItemId, setActingItemId] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const aoiChildLayerId = selectedAoiLayerId ? `${selectedAoiLayerId}-ds-${datasetId}` : null;
  const aoiChildLayer = aoiChildLayerId ? layers[aoiChildLayerId] : undefined;
  const isAoiScoped = !!aoiChildLayer?.parentAoiId && !!aoiChildLayer?.clipBounds;
  const aoiBboxParam = isAoiScoped ? aoiChildLayer!.clipBounds!.join(',') : undefined;

  // Fetch dataset details
  const { data: dataset } = useQuery({
    queryKey: qk.datasets.detail(datasetId),
    queryFn: () => datasetsApi.get(datasetId),
  });

  // Fetch items in the dataset
  const { data: itemsData, isLoading } = useQuery({
    queryKey: isAoiScoped
      ? [...qk.datasets.items(datasetId), 'aoi', aoiBboxParam ?? '']
      : qk.datasets.items(datasetId),
    queryFn: () => datasetsApi.listItems(datasetId, {
      page_size: 100,
      ...(aoiBboxParam ? { bbox: aoiBboxParam } : {}),
    }),
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

  const toggleItemOnMap = async (item: DatasetItem, onMap: boolean) => {
    if (actingItemId === item.id) return;
    setActingItemId(item.id);

    try {
      if (isAoiScoped && aoiChildLayerId && aoiChildLayer) {
        if (onMap) {
          await switchAoiChildLayerToFirstItem({
            childLayerId: aoiChildLayerId,
            datasetId,
            layerSnapshot: aoiChildLayer,
          });
        } else {
          await switchAoiChildLayerToItem({
            childLayerId: aoiChildLayerId,
            datasetId,
            stacItemId: item.stac_item_id,
            layerSnapshot: aoiChildLayer,
          });
        }
      } else {
        if (!mapId) return;
        if (onMap) {
          await removeDatasetItemLayerFromMap({
            mapId,
            layerId: getDatasetItemLayerId(item.stac_item_id),
          });
        } else {
          await addDatasetItemLayerToMap({
            mapId,
            datasetId,
            item,
          });
        }
        await queryClient.invalidateQueries({ queryKey: qk.maps.detail(mapId) });
        toast.success(onMap ? 'Item removed from map' : 'Item added to map');
      }
      if (isAoiScoped) {
        toast.success(onMap ? 'AOI item reset to default' : 'AOI item switched');
      }
    } catch {
      toast.error(onMap ? 'Failed to remove item' : 'Failed to add item');
    } finally {
      setActingItemId(null);
    }
  };

  // Check if an item is already on the map
  const isOnMap = (stacItemId: string) =>
    isAoiScoped
      ? aoiChildLayer?.stacItemId === stacItemId
      : !!layers[getDatasetItemLayerId(stacItemId)];

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
            {isAoiScoped ? ' · AOI-clipped item switcher' : ' · Select individual files to overlay'}
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
                const acting = actingItemId === item.id;

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
                        {datasetItemLabel(item)}
                      </div>
                      {item.datetime && (
                        <div style={{ fontSize: 10, color: MC.textMuted, marginTop: 1 }}>
                          {new Date(item.datetime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => {
                        if (acting) return;
                        void toggleItemOnMap(item, onMap);
                      }}
                      disabled={acting}
                      style={{
                        flexShrink: 0,
                        height: 26,
                        padding: '0 10px',
                        borderRadius: 4,
                        border: `1px solid ${onMap ? MC.danger : MC.accent}`,
                        background: onMap ? `${MC.danger}16` : MC.accentDim,
                        color: onMap ? MC.danger : MC.accent,
                        cursor: acting ? 'default' : 'pointer',
                        fontSize: 11,
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        transition: 'all 0.1s',
                      }}
                    >
                      {acting ? (
                        <Loader size={10} style={{ animation: 'spin 1s linear infinite' }} />
                      ) : (
                        onMap ? (
                          <>
                            <Trash2 size={10} />
                            Remove
                          </>
                        ) : (
                          <>
                            <Map size={10} />
                            Add
                          </>
                        )
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
