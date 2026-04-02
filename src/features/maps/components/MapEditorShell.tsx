'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
import { toast } from 'sonner';

import { useMapStore, getMapInstance } from '@/stores/mapStore';
import { useMapLayersStore } from '@/stores/mapLayersStore';
import type { DrawTool, BasemapId } from '@/stores/mapStore';

import { mapsApi } from '@/lib/api/maps';
import { datasetsApi } from '@/lib/api/datasets';
import { qk } from '@/lib/query-keys';
import { geometryToTileBounds } from '@/lib/geo';

import { useMapContext } from '@/features/maps/hooks/useMapContext';
import { useMeasureTool } from '@/features/maps/hooks/useMeasureTool';
import { useMapSync } from '@/features/maps/hooks/useMapSync';
import { getMapManager } from '@/features/maps/MapManager';
import type { DatasetFootprintData } from '@/features/maps/MapManager';
import { MAP_Z } from '@/features/maps/mapColors';
import { useIsCompact } from '@/hooks/use-mobile';

import { MapTopNav } from './MapTopNav';
import type { ActiveTool } from './MapTopNav';
import { MapStatusBar } from './MapStatusBar';
import { LeftPanel } from './LeftPanel/LeftPanel';
import { RightPanel } from './RightPanel/RightPanel';
import { LibraryPanel } from './LibraryPanel';
import { ScaleBar } from '@/components/map/ScaleBar';
import { TimelinePanel } from './TimelinePanel';

// ─── Leaflet components — always ssr: false ────────────────────────────────────
const LeafletMap = dynamic(() => import('@/components/map/LeafletMap'), {
  ssr: false,
  loading: () => <div style={{ position: 'absolute', inset: 0, background: '#1c2119' }} />,
});
const MeasurementLayerDyn = dynamic(
  () => import('@/components/map/MeasurementLayer').then((m) => ({ default: m.MeasurementLayer })),
  { ssr: false }
);

// ─── Auto-save interval (ms) — 8 seconds as per integration guide §7 ──────────
const AUTO_SAVE_DELAY = 8000;

interface MapEditorShellProps {
  workspaceId: string;
  projectId: string;
  mapId: string;
}

export function MapEditorShell({ workspaceId, projectId, mapId }: MapEditorShellProps) {
  const queryClient = useQueryClient();
  const { orgId } = useAuth();

  // ── Server state ───────────────────────────────────────────
  const { data: mapData } = useQuery({
    queryKey: qk.maps.detail(mapId),
    queryFn: () => mapsApi.get(mapId),
    enabled: !!mapId,
  });

  const updateMapMutation = useMutation({
    mutationFn: (name: string) => mapsApi.update(mapId, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.maps.detail(mapId) });
      toast.success('Map name saved');
    },
    onError: () => toast.error('Failed to save map name'),
  });

  // ── Feature data ───────────────────────────────────────────
  const { datasets, annotations, trackedObjects, alerts, annotationSets } = useMapContext(projectId, orgId ?? '', mapId);

  // ── MapManager sync — bridges Zustand → Leaflet ────────────
  useMapSync();

  // ── Measurement ────────────────────────────────────────────
  const { totalDistance } = useMeasureTool();
  const measurementActive = useMapLayersStore((s) => s.measurementActive);
  const toggleMeasurement = useMapLayersStore((s) => s.toggleMeasurement);
  const layers = useMapLayersStore((s) => s.layers);
  const initLayer = useMapLayersStore((s) => s.initLayer);
  const removeLayer = useMapLayersStore((s) => s.removeLayer);
  const setBackendLayerId = useMapLayersStore((s) => s.setBackendLayerId);
  const setLayerTileConfig = useMapLayersStore((s) => s.setLayerTileConfig);
  const setLayerVisible = useMapLayersStore((s) => s.setLayerVisible);
  const setLayerOpacity = useMapLayersStore((s) => s.setLayerOpacity);

  // ── Timeline — fetch items when timeline opens for a dataset ──
  const timelineEnabled = useMapLayersStore((s) => s.timelineEnabled);
  const timelineDatasetId = useMapLayersStore((s) => s.timelineDatasetId);

  const { data: timelineItemsData } = useQuery({
    queryKey: qk.datasets.items(timelineDatasetId ?? ''),
    queryFn: () => datasetsApi.listItems(timelineDatasetId!, { page_size: 500 }),
    enabled: !!timelineDatasetId,
  });

  useEffect(() => {
    if (timelineItemsData?.items) {
      useMapLayersStore.getState().setTimelineItems(timelineItemsData.items);
    }
  }, [timelineItemsData]);

  // ── Reset layer store when switching maps ──────────────────
  const resetForMap = useMapLayersStore((s) => s.resetForMap);
  useEffect(() => {
    resetForMap();
    return () => { resetForMap(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapId]);

  // ── Restore view_state from map data ──────────────────────
  const viewStateRestoredRef = useRef(false);

  useEffect(() => {
    if (!mapData?.view_state || viewStateRestoredRef.current) return;
    const map = getMapInstance();
    if (!map) return;

    const { center, zoom } = mapData.view_state;
    // view_state.center is [lng, lat] — Leaflet wants [lat, lng]
    if (center && center.length === 2) {
      map.setView([center[1], center[0]], zoom ?? 3);
      viewStateRestoredRef.current = true;
    }
  }, [mapData]);

  // Also try restoring when the map instance becomes ready
  const mapReady = useMapStore((s) => s.mapReady);
  useEffect(() => {
    if (!mapData?.view_state || viewStateRestoredRef.current || !mapReady) return;
    const map = getMapInstance();
    if (!map) return;

    const { center, zoom } = mapData.view_state;
    if (center && center.length === 2) {
      map.setView([center[1], center[0]], zoom ?? 3);
      viewStateRestoredRef.current = true;
    }
  }, [mapData, mapReady]);

  // ── Restore backend map layers on mount ────────────────────
  // GET /maps/{mapId} returns layers[] — use them to reinstate layers
  useEffect(() => {
    if (!mapData?.layers?.length) return;

    const currentLayers = useMapLayersStore.getState().layers;
    
    mapData.layers
      .sort((a, b) => a.z_index - b.z_index)
      .forEach((bl) => {
        // Handle annotation_set layers differently
        if (bl.source_type === 'annotation_set' && bl.annotation_set_id) {
          const layerId = `annset-${bl.annotation_set_id}`;
          
          // Skip if layer already exists in store (prevents re-adding deleted layers)
          if (currentLayers[layerId]) return;
          
          setBackendLayerId(layerId, bl.id);
          initLayer(layerId, 'annotation', {
            name: bl.name,
            sourceType: 'annotation_set',
            annotationSetId: bl.annotation_set_id,
            zIndex: bl.z_index,
          });
          if (!bl.visible) setLayerVisible(layerId, false);
          if (bl.opacity !== 1) setLayerOpacity(layerId, bl.opacity);
          return;
        }

        // Layer ID convention: dataset layers use dataset_id, item layers use item-{stac_item_id}
        const layerId = bl.source_type === 'stac_item' && bl.stac_item_id
          ? `item-${bl.stac_item_id}`
          : bl.dataset_id ?? bl.id;
        if (!layerId) return;

        // Skip if layer already exists in store (prevents re-adding deleted layers)
        if (currentLayers[layerId]) return;

        // Store the backend layer ID for PATCH/DELETE
        setBackendLayerId(layerId, bl.id);

        // Init with proper source type and z_index
        // For stac_item layers, dataset_id is stored in source_config (not top-level)
        const parentDatasetId = bl.dataset_id
          ?? (bl.source_config?.dataset_id as string | undefined)
          ?? undefined;

        initLayer(layerId, 'dataset', {
          name: bl.name,
          sourceType: bl.source_type,
          zIndex: bl.z_index,
          tileServiceUrl: bl.tile_service_url ?? undefined,
          parentDatasetId,
          stacItemId: bl.stac_item_id ?? undefined,
        });

        // Honour saved visibility / opacity
        if (!bl.visible) setLayerVisible(layerId, false);
        if (bl.opacity !== 1) setLayerOpacity(layerId, bl.opacity);

        // Fetch tiles based on source_type
        // Dataset (collection) layers are group containers — no tiles.
        // Only stac_item layers get tile rendering via TiTiler.
        if (bl.source_type === 'dataset' && bl.dataset_id) {
          // Store rendering_config from dataset metadata for child items
          const ds = datasets?.find((d) => d.id === bl.dataset_id);
          const rc = ds?.metadata?.rendering_config;
          if (rc) {
            useMapLayersStore.getState().setLayerRenderingConfig(layerId, rc);
          }
        } else if (bl.source_type === 'stac_item' && bl.stac_item_id) {
          // dataset_id is cached in source_config when the layer was created
          let dsId = parentDatasetId;
          const stacId = bl.stac_item_id;
          
          // Async IIFE to handle the restore flow with proper backfill
          (async () => {
            try {
              // If we don't have dataset_id, try to get it from the tile config response
              if (!dsId) {
                // For old layers without source_config.dataset_id, we'll fetch tile config
                // which returns dataset_id, allowing us to backfill parentDatasetId
                // First, try searching datasets to find which one has this item
                const dsMatch = datasets?.find((d) => 
                  d.id && d.status === 'ready' // Only check ready datasets
                );
                // If still no match, the layer won't have bounds but tiles may still work
                // if the stac_item_id is resolvable globally (unlikely without dataset context)
              }
              
              if (!dsId) return; // Can't proceed without dataset_id
              
              // Fetch tile config
              const cfg = await datasetsApi.getItemTileConfigByStacId(dsId, stacId);
              
              // If tile config returns a different dataset_id than we expected, use it
              // and backfill parentDatasetId for future queries
              if (cfg.dataset_id && cfg.dataset_id !== dsId) {
                dsId = cfg.dataset_id;
                useMapLayersStore.getState().setLayerParentDatasetId(layerId, dsId);
              } else if (!parentDatasetId && cfg.dataset_id) {
                // Backfill parentDatasetId for old layers
                useMapLayersStore.getState().setLayerParentDatasetId(layerId, cfg.dataset_id);
              }
              
              // Try to find the item to get geometry for tileBounds
              let tileBounds: [number, number, number, number] | null = null;
              try {
                const itemsResp = await datasetsApi.listItems(dsId, { page_size: 500 });
                const item = itemsResp.items?.find((i) => i.stac_item_id === stacId);
                if (item?.geometry) {
                  tileBounds = geometryToTileBounds(item.geometry);
                }
              } catch {
                // Items fetch failed — proceed without bounds
              }
              
              // Apply rendering parameters to tile URL
              // For multi-band rasters (3+ bands), prefer RGB rendering over grayscale presets
              let tileUrl = cfg.tile_url_template;
              let activePreset: string | null = null;
              const rc = cfg.rendering_config;
              const hasBands = rc?.bands && rc.bands.length >= 3;
              
              // Helper: check if a preset is RGB (has 3 bands in asset_bidx)
              const isRgbPreset = (presetParams?: Record<string, string>) => {
                if (!presetParams?.asset_bidx) return false;
                const match = presetParams.asset_bidx.match(/\|(\d+),(\d+),(\d+)/);
                return !!match;
              };
              
              // For multi-band rasters, find an RGB preset or use default RGB bands
              if (hasBands && rc) {
                // First, try to find an RGB preset (prefer one named "RGB", "True Color", etc.)
                let rgbPresetId: string | null = null;
                if (rc.presets) {
                  // Look for preset with RGB in name first
                  for (const [id, preset] of Object.entries(rc.presets)) {
                    if (isRgbPreset(preset.params)) {
                      if (/rgb|true.?color|natural/i.test(preset.label || id)) {
                        rgbPresetId = id;
                        break;
                      }
                      // Store first RGB preset as fallback
                      if (!rgbPresetId) rgbPresetId = id;
                    }
                  }
                }
                
                if (rgbPresetId && rc.presets) {
                  // Apply found RGB preset
                  const presetConfig = rc.presets[rgbPresetId];
                  if (presetConfig?.params) {
                    const params = new URLSearchParams();
                    Object.entries(presetConfig.params).forEach(([key, value]) => {
                      if (value) params.set(key, String(value));
                    });
                    tileUrl = `${cfg.tile_url_template}?${params.toString()}`;
                    activePreset = rgbPresetId;
                  }
                } else {
                  // No RGB preset found - apply default RGB band selection
                  const bands = rc.bands;
                  const r = bands[0]?.index ?? 1;
                  const g = bands[1]?.index ?? 2;
                  const b = bands[2]?.index ?? 3;
                  const assetBidx = `data|${r},${g},${b}`;
                  
                  // Build rescale from band statistics
                  const p2Vals = [bands[0]?.stats?.p2, bands[1]?.stats?.p2, bands[2]?.stats?.p2].filter(v => v != null) as number[];
                  const p98Vals = [bands[0]?.stats?.p98, bands[1]?.stats?.p98, bands[2]?.stats?.p98].filter(v => v != null) as number[];
                  
                  const params = new URLSearchParams();
                  params.set('asset_bidx', assetBidx);
                  if (p2Vals.length === 3 && p98Vals.length === 3) {
                    const rescale = `${Math.round(Math.min(...p2Vals))},${Math.round(Math.max(...p98Vals))}`;
                    params.set('rescale', rescale);
                  }
                  tileUrl = `${cfg.tile_url_template}?${params.toString()}`;
                  
                  // Set band selection in store so UI reflects the applied bands
                  useMapLayersStore.getState().setLayerBandSelection(layerId, { r, g, b }, null);
                }
              } else if (rc?.default_preset && rc.presets) {
                // Single-band or no bands - use default preset
                const defaultPreset = rc.default_preset;
                const presetConfig = rc.presets[defaultPreset];
                if (presetConfig?.params) {
                  const params = new URLSearchParams();
                  Object.entries(presetConfig.params).forEach(([key, value]) => {
                    if (value) params.set(key, String(value));
                  });
                  tileUrl = `${cfg.tile_url_template}?${params.toString()}`;
                  activePreset = defaultPreset;
                }
              }
              
              if (tileUrl) {
                setLayerTileConfig(layerId, { 
                  tileUrl,
                  ...(tileBounds ? { tileBounds } : {}),
                });
              }
              if (cfg.rendering_config) {
                useMapLayersStore.getState().setLayerRenderingConfig(layerId, cfg.rendering_config);
              }
              // Set active preset if we applied one
              if (activePreset) {
                useMapLayersStore.getState().setLayerBandSelection(layerId, null, activePreset);
              }
            } catch {
              // Tile config fetch failed — layer will show without tiles
            }
          })();
        } else if (bl.source_type === 'tile_service' && bl.tile_service_url) {
          setLayerTileConfig(layerId, { tileUrl: bl.tile_service_url });
        }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapData?.layers]);

  // ── Sync annotation sets to backend map_layers if missing ──────────────────
  // When annotation sets exist in useMapContext but aren't in mapData.layers,
  // persist them so they survive page reload
  const annSetSyncedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!mapId || !mapData?.layers || annotationSets.length === 0) return;

    // Find annotation set IDs already in backend map_layers
    const existingAnnSetIds = new Set(
      mapData.layers
        .filter((l) => l.source_type === 'annotation_set' && l.annotation_set_id)
        .map((l) => l.annotation_set_id!)
    );

    // For each annotation set NOT in backend, create a map layer
    annotationSets.forEach((annSet) => {
      if (existingAnnSetIds.has(annSet.id)) return;
      if (annSetSyncedRef.current.has(annSet.id)) return;
      annSetSyncedRef.current.add(annSet.id);

      const layerId = `annset-${annSet.id}`;
      
      // Create the backend map layer
      datasetsApi.addMapLayer(mapId, {
        name: annSet.name,
        layer_type: 'vector',
        source_type: 'annotation_set',
        annotation_set_id: annSet.id,
        opacity: 1.0,
        visible: true,
      }).then((bl) => {
        setBackendLayerId(layerId, bl.id);
        queryClient.invalidateQueries({ queryKey: qk.maps.detail(mapId) });
      }).catch(() => {
        annSetSyncedRef.current.delete(annSet.id);
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapId, mapData?.layers, annotationSets, setBackendLayerId, queryClient]);

  // ── Persist visibility changes to the backend (immediate) ──
  useEffect(() => {
    const unsub = useMapLayersStore.subscribe(
      (s) => s.layers,
      (current, prev) => {
        const backendIds = useMapLayersStore.getState().backendLayerIds;
        Object.entries(current).forEach(([id, layer]) => {
          const prevLayer = prev[id];
          const backendId = backendIds[id];
          if (!prevLayer || !backendId) return;
          // Only immediate-save visibility (per integration guide §6)
          if (layer.visible !== prevLayer.visible) {
            datasetsApi.updateMapLayer(mapId, backendId, {
              visible: layer.visible,
            }).catch(() => {});
          }
        });
      }
    );
    return unsub;
  }, [mapId]);

  // ── 8-second auto-save for camera + continuous layer changes ──
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'pending' | 'saving'>('idle');

  const flushAutoSave = useCallback(async () => {
    const map = getMapInstance();
    if (!map) return;

    // 4E: Skip auto-save when offline — will retry on next interaction
    if (!getMapManager().online) {
      setAutoSaveStatus('idle');
      return;
    }

    setAutoSaveStatus('saving');

    const center = map.getCenter();
    const layerState = useMapLayersStore.getState();
    const backendIds = layerState.backendLayerIds;

    // Collect opacity changes for layers with backend IDs
    const layerUpdates = Object.entries(layerState.layers)
      .filter(([id]) => backendIds[id])
      .map(([id, l]) => ({
        id: backendIds[id],
        opacity: l.opacity,
      }));

    try {
      await mapsApi.autoSave(mapId, {
        view_state: {
          center: [center.lng, center.lat],
          zoom: map.getZoom(),
        },
        layers: layerUpdates.length > 0 ? layerUpdates : undefined,
      });
      useMapLayersStore.getState().clearAutoSaveDirty();
    } catch {
      // Silent failure — will retry on next interaction
    } finally {
      setAutoSaveStatus('idle');
    }
  }, [mapId]);

  const scheduleAutoSave = useCallback(() => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    setAutoSaveStatus('pending');
    autoSaveTimerRef.current = setTimeout(flushAutoSave, AUTO_SAVE_DELAY);
  }, [flushAutoSave]);

  // Attach auto-save to map movement events
  useEffect(() => {
    const map = getMapInstance();
    if (!map) return;

    const handler = () => scheduleAutoSave();
    map.on('moveend zoomend', handler);
    return () => { map.off('moveend zoomend', handler); };
  }, [mapReady, scheduleAutoSave]);

  // Also trigger auto-save when opacity/style changes (via dirty flag)
  useEffect(() => {
    const unsub = useMapLayersStore.subscribe(
      (s) => s.autoSaveDirty,
      (dirty) => {
        if (dirty) scheduleAutoSave();
      }
    );
    return unsub;
  }, [scheduleAutoSave]);

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        flushAutoSave();
      }
    };
  }, [flushAutoSave]);

  // ── Remove dataset layer from map ──────────────────────────
  const handleRemoveDataset = useCallback(async (datasetId: string) => {
    const backendId = useMapLayersStore.getState().backendLayerIds[datasetId];
    const allLayers = useMapLayersStore.getState().layers;
    
    // Find and remove all item layers belonging to this dataset
    const itemLayersToRemove = Object.entries(allLayers)
      .filter(([id, layer]) => 
        layer.parentDatasetId === datasetId && id.startsWith('item-')
      )
      .map(([id]) => id);
    
    // Remove item layers first (from store immediately, backend async)
    const itemDeletePromises: Promise<void>[] = [];
    for (const itemId of itemLayersToRemove) {
      const itemBackendId = useMapLayersStore.getState().backendLayerIds[itemId];
      removeLayer(itemId); // Remove from store immediately
      if (itemBackendId) {
        itemDeletePromises.push(
          datasetsApi.deleteMapLayer(mapId, itemBackendId).catch((err) => {
            console.error('Failed to delete item layer from backend:', itemId, err);
          })
        );
      }
    }
    
    // Remove the parent dataset layer (from store immediately)
    removeLayer(datasetId);
    
    // Delete from backend (async)
    const deletePromises: Promise<void>[] = [...itemDeletePromises];
    if (backendId) {
      deletePromises.push(
        datasetsApi.deleteMapLayer(mapId, backendId).catch((err) => {
          console.error('Failed to delete dataset layer from backend:', datasetId, err);
          toast.error('Failed to remove layer from map');
          throw err;
        })
      );
    }
    
    // Wait for all deletes to complete, then invalidate the map query
    try {
      await Promise.all(deletePromises);
      // Invalidate map query to refetch updated layers from backend
      queryClient.invalidateQueries({ queryKey: qk.maps.detail(mapId) });
    } catch (err) {
      console.warn('Some layers failed to delete from backend', err);
    }
  }, [mapId, removeLayer, queryClient]);

  // ── Remove annotation set layer from map ──────────────────
  const handleRemoveAnnotationSet = useCallback((setId: string) => {
    const layerId = `annset-${setId}`;
    removeLayer(layerId);
    import('@/lib/api/annotation-sets').then(({ annotationSetsApi }) => {
      annotationSetsApi.delete(setId).catch(() => {});
    });
  }, [removeLayer]);

  // ── Rename annotation set ─────────────────────────────────
  const handleRenameAnnotationSet = useCallback((setId: string, newName: string) => {
    import('@/lib/api/annotation-sets').then(({ annotationSetsApi }) => {
      annotationSetsApi.rename(setId, newName).catch(() => {});
    });
  }, []);

  // ── Auto-fetch TileJSON when a dataset on this map becomes ready ──
  const tileJsonAttemptedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const currentLayers = useMapLayersStore.getState().layers;
    datasets.forEach((d) => {
      if (d.status !== 'ready' || d.dataset_type !== 'raster' || !d.stac_collection_id) return;
      if (!currentLayers[d.id]) return;

      const layer = currentLayers[d.id];
      if (layer?.tileUrl) return;
      if (tileJsonAttemptedRef.current.has(d.id)) return;

      tileJsonAttemptedRef.current.add(d.id);

      datasetsApi.getTileJson(d.id)
        .then((tj) => {
          if (!tj.tiles[0]) return;
          
          // Check if TileJSON bounds are defaults (world bounds or center-of-earth)
          const isWorldBounds = tj.bounds 
            && tj.bounds[0] === -180 
            && tj.bounds[1] <= -85 
            && tj.bounds[2] === 180 
            && tj.bounds[3] >= 85;
          const isCenterEarth = tj.bounds
            && Math.abs(tj.bounds[0]) < 0.0001 
            && Math.abs(tj.bounds[1]) < 0.0001 
            && Math.abs(tj.bounds[2]) < 0.0001 
            && Math.abs(tj.bounds[3]) < 0.0001;
          
          // Use dataset geometry bounds if TileJSON has default bounds
          let tileBounds = tj.bounds;
          if ((isWorldBounds || isCenterEarth) && d.geometry) {
            // Compute bounds from geometry via MapManager
            const geomBounds = getMapManager().computeBoundsFromGeometry(d.geometry);
            if (geomBounds) {
              tileBounds = geomBounds;
            }
          }
          
          setLayerTileConfig(d.id, {
            tileUrl: tj.tiles[0],
            tileBounds,
            tileMinZoom: tj.minzoom,
            tileMaxZoom: tj.maxzoom,
          });
          // Store rendering config for band selection UI
          const rc = d.metadata?.rendering_config;
          if (rc) {
            useMapLayersStore.getState().setLayerRenderingConfig(d.id, rc);
          }
          // Fly to dataset extent on first tile load
          if (tileBounds) {
            getMapManager().fitBounds(tileBounds);
          }
        })
        .catch(() => {
          tileJsonAttemptedRef.current.delete(d.id);
        });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasets, setLayerTileConfig]);

  // ── Push feature data to MapManager ─────────────────────────
  // Annotations: grouped by label, each group is a layer
  useEffect(() => {
    if (!mapReady) return;
    const mm = getMapManager();
    const byLabel = annotations.reduce<Record<string, typeof annotations>>((acc, a) => {
      if (!acc[a.label]) acc[a.label] = [];
      acc[a.label].push(a);
      return acc;
    }, {});
    Object.entries(byLabel).forEach(([label, items]) => {
      mm.setLayerData(`annotation-${label}`, items);
    });
  }, [annotations, mapReady]);

  // Tracking objects
  useEffect(() => {
    if (!mapReady) return;
    getMapManager().setLayerData('tracking-all', trackedObjects);
  }, [trackedObjects, mapReady]);

  // Alerts
  useEffect(() => {
    if (!mapReady) return;
    getMapManager().setLayerData('alerts-all', alerts);
  }, [alerts, mapReady]);

  // Annotation sets — fetch GeoJSON features and push to MapManager
  const annSetFetchedRef = useRef<Set<string>>(new Set());

  // Helper: fetch annotation set features and push to MapManager
  const fetchAnnSetFeatures = useCallback((annSetId: string, layerId: string) => {
    const mm = getMapManager();

    // Set loading state
    useMapLayersStore.setState((s) => ({
      layers: s.layers[layerId]
        ? { ...s.layers, [layerId]: { ...s.layers[layerId], loading: true } }
        : s.layers,
    }));

    import('@/lib/api/annotation-sets').then(({ annotationSetsApi }) => {
      annotationSetsApi.getFeatures(annSetId)
        .then((fc) => {
          mm.setLayerData(layerId, fc);

          // Compute bounds from all features so zoom-to-layer works
          let bounds: [number, number, number, number] | null = null;
          const features = (fc as { features?: { geometry?: { coordinates: number[] | number[][] | number[][][] } }[] })?.features;
          if (features && features.length > 0) {
            let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
            const visitCoords = (coords: unknown) => {
              if (!Array.isArray(coords)) return;
              if (typeof coords[0] === 'number') {
                const [lng, lat] = coords as [number, number];
                if (lng < minLng) minLng = lng;
                if (lng > maxLng) maxLng = lng;
                if (lat < minLat) minLat = lat;
                if (lat > maxLat) maxLat = lat;
              } else {
                for (const c of coords) visitCoords(c);
              }
            };
            for (const f of features) {
              if (f.geometry?.coordinates) visitCoords(f.geometry.coordinates);
            }
            if (minLng !== Infinity) bounds = [minLng, minLat, maxLng, maxLat];
          }

          useMapLayersStore.setState((s) => ({
            layers: s.layers[layerId]
              ? { ...s.layers, [layerId]: { ...s.layers[layerId], loading: false, error: false, bounds } }
              : s.layers,
          }));
        })
        .catch(() => {
          // Do NOT clear annSetFetchedRef here — that would cause an infinite
          // fetch loop (clear ref → state update → re-render → re-fetch → 404 → repeat).
          useMapLayersStore.setState((s) => ({
            layers: s.layers[layerId]
              ? { ...s.layers, [layerId]: { ...s.layers[layerId], loading: false, error: true } }
              : s.layers,
          }));
        });
    });
  }, []);

  useEffect(() => {
    if (!mapReady) return;
    const mm = getMapManager();
    annotationSets.forEach((annSet) => {
      const layerId = `annset-${annSet.id}`;
      if (!layers[layerId]) return;
      if (annSetFetchedRef.current.has(annSet.id)) return;
      annSetFetchedRef.current.add(annSet.id);

      fetchAnnSetFeatures(annSet.id, layerId);

      // 4C: Register viewport callback for debounced reload on pan/zoom
      mm.registerViewportCallback(layerId, () => {
        fetchAnnSetFeatures(annSet.id, layerId);
      });
    });
  }, [annotationSets, layers, mapReady, fetchAnnSetFeatures]);

  // Re-fetch annotation set features when signalled (e.g. after annotation save)
  const refreshAnnotationSetId = useMapLayersStore((s) => s.refreshAnnotationSetId);
  const clearAnnotationSetRefresh = useMapLayersStore((s) => s.clearAnnotationSetRefresh);
  useEffect(() => {
    if (!refreshAnnotationSetId || !mapReady) return;
    const layerId = `annset-${refreshAnnotationSetId}`;
    // Allow re-fetch by clearing the guard
    annSetFetchedRef.current.delete(refreshAnnotationSetId);
    fetchAnnSetFeatures(refreshAnnotationSetId, layerId);
    annSetFetchedRef.current.add(refreshAnnotationSetId);
    clearAnnotationSetRefresh();
  }, [refreshAnnotationSetId, mapReady, fetchAnnSetFeatures, clearAnnotationSetRefresh]);

  // ── Temporal annotation filtering: show/hide annotation sets by timeline frame ──
  const timelineIndex = useMapLayersStore((s) => s.timelineIndex);
  const timelineItems = useMapLayersStore((s) => s.timelineItems);
  const setLayerVisibleForTimeline = useMapLayersStore((s) => s.setLayerVisible);

  useEffect(() => {
    if (!timelineEnabled || !timelineDatasetId || timelineItems.length === 0) return;
    const currentItem = timelineItems[timelineIndex];
    const currentStacItemId = currentItem?.stac_item_id ?? null;

    annotationSets.forEach((annSet) => {
      const layerId = `annset-${annSet.id}`;
      if (!layers[layerId]) return;

      // If this annotation set is linked to the timeline dataset
      if (annSet.dataset_id === timelineDatasetId) {
        // Show only if the set's stac_item_id matches current frame (or has no stac_item_id = show always)
        const shouldShow = !annSet.stac_item_id || annSet.stac_item_id === currentStacItemId;
        setLayerVisibleForTimeline(layerId, shouldShow);
      }
      // Annotation sets not linked to the timeline dataset are left unchanged
    });
  }, [timelineEnabled, timelineDatasetId, timelineIndex, timelineItems, annotationSets, layers, setLayerVisibleForTimeline]);

  // Dataset footprints (for datasets on the map that don't have tileUrl yet)
  useEffect(() => {
    if (!mapReady) return;
    const mm = getMapManager();
    datasets.forEach((d) => {
      const layer = layers[d.id];
      if (!layer) return;
      // Only push footprint data if there's no tile URL (footprint is the fallback)
      if (!layer.tileUrl && d.geometry) {
        const footprintData: DatasetFootprintData = {
          id: d.id,
          name: d.name,
          status: d.status,
          geometry: d.geometry,
        };
        mm.setLayerData(d.id, footprintData);

        // Compute bounds from geometry so zoom-to-layer works for footprint layers
        if (!layer.bounds) {
          const geomBounds = mm.computeBoundsFromGeometry(d.geometry);
          if (geomBounds) {
            useMapLayersStore.setState((s) => ({
              layers: s.layers[d.id]
                ? { ...s.layers, [d.id]: { ...s.layers[d.id], bounds: geomBounds } }
                : s.layers,
            }));
          }
        }
      }
    });
  }, [datasets, layers, mapReady]);

  // ── Only show datasets that are actually on this map ───────
  const activeDatasets = datasets.filter((d) => !!layers[d.id]);

  // ── Map store ──────────────────────────────────────────────
  const cursorLatLng = useMapStore((s) => s.cursorLatLng);
  const zoom = useMapStore((s) => s.zoom);
  const activeBasemapId = useMapStore((s) => s.activeBasemapId);
  const drawnGeometry = useMapStore((s) => s.drawnGeometry);

  // When a shape is drawn via Geoman, open the annotation attribute panel
  useEffect(() => {
    if (drawnGeometry) {
      useMapLayersStore.getState().openAnnotationPanel();
    }
  }, [drawnGeometry]);

  const isCompact = useIsCompact();
  const rightPanelMode = useMapLayersStore((s) => s.rightPanelMode);

  // ── Local UI state ─────────────────────────────────────────
  const [activeTool, setActiveTool] = useState<ActiveTool>('pan');
  const [layersOpen, setLayersOpen] = useState(true);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [basemapOpen, setBasemapOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [mapName, setMapName] = useState('');

  useEffect(() => {
    if (!editingName && mapData?.name) setMapName(mapData.name);
  }, [mapData?.name, editingName]);

  // On compact viewports, collapse LeftPanel when RightPanel opens
  useEffect(() => {
    if (isCompact && rightPanelMode !== 'none') {
      setLayersOpen(false);
    }
  }, [isCompact, rightPanelMode]);

  // Sync activeTool when measurement is stopped from the right panel Done button
  useEffect(() => {
    if (!measurementActive && activeTool === 'measure') {
      setActiveTool('pan');
    }
  }, [measurementActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Tool handling ──────────────────────────────────────────
  const handleToolChange = useCallback(
    (tool: ActiveTool) => {
      if (tool === 'measure') {
        toggleMeasurement();
        setActiveTool('measure');
        return;
      }
      setActiveTool(tool);
      if (measurementActive) useMapLayersStore.getState().clearMeasurement();

      const drawTools: DrawTool[] = ['point', 'polyline', 'polygon', 'rectangle', 'circle'];
      if (drawTools.includes(tool as DrawTool)) {
        useMapStore.getState().setActiveDrawTool(tool as DrawTool);
      } else {
        useMapStore.getState().setActiveDrawTool(null);
      }
    },
    [measurementActive, toggleMeasurement]
  );

  const handleMeasurementToggle = useCallback(() => {
    toggleMeasurement();
    setActiveTool(measurementActive ? 'pan' : 'measure');
  }, [measurementActive, toggleMeasurement]);

  const handleBasemapSelect = useCallback((id: BasemapId) => {
    useMapStore.getState().setActiveBasemapId(id);
  }, []);

  const handleSaveName = useCallback(
    (name: string) => {
      setEditingName(false);
      const trimmed = name.trim();
      if (trimmed && trimmed !== mapData?.name) {
        updateMapMutation.mutate(trimmed);
        setMapName(trimmed);
      }
    },
    [mapData?.name, updateMapMutation]
  );

  // ── Layer reorder handler ─────────────────────────────────
  const handleLayerMove = useCallback((layerId: string, direction: 'up' | 'down') => {
    const result = useMapLayersStore.getState().moveLayer(layerId, direction);
    if (!result) return;

    // Build the new layer_ids array ordered by z_index (bottom-to-top for the API)
    const state = useMapLayersStore.getState();
    const backendIds = state.backendLayerIds;
    const sortedBackendIds = Object.entries(state.layers)
      .filter(([id]) => backendIds[id])
      .sort(([, a], [, b]) => a.zIndex - b.zIndex)
      .map(([id]) => backendIds[id]);

    if (sortedBackendIds.length > 1) {
      mapsApi.reorderLayers(mapId, sortedBackendIds).then((reordered) => {
        // Apply the server-assigned z_index values back to the store
        const newOrder: Record<string, number> = {};
        reordered.forEach((rl) => {
          // Find the frontend ID from the backend ID
          const frontendId = Object.entries(backendIds).find(([, bid]) => bid === rl.id)?.[0];
          if (frontendId) newOrder[frontendId] = rl.z_index;
        });
        if (Object.keys(newOrder).length > 0) {
          useMapLayersStore.getState().applyReorder(newOrder);
        }
      }).catch(() => {});
    }
  }, [mapId]);

  return (
    // Root — fills the viewport as a flex column: TopNav → Map area → StatusBar
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: '#1a1e17', zIndex: MAP_Z.root }}>

      {/* ── TopNav — fixed height, not overlapping the map ─── */}
      <MapTopNav
        workspaceId={workspaceId}
        projectId={projectId}
        mapName={mapName}
        editingName={editingName}
        onStartEdit={() => setEditingName(true)}
        onSaveName={handleSaveName}
        onCancelEdit={() => setEditingName(false)}
        activeTool={activeTool}
        onToolChange={handleToolChange}
        libraryOpen={libraryOpen}
        onLibraryToggle={() => {
          setLibraryOpen((v) => !v);
          if (!libraryOpen) useMapLayersStore.getState().closeRightPanel();
        }}
        basemapOpen={basemapOpen}
        onBasemapToggle={() => setBasemapOpen((v) => !v)}
        activeBasemapId={activeBasemapId}
        onBasemapSelect={handleBasemapSelect}
        measurementActive={measurementActive}
        onMeasurementToggle={handleMeasurementToggle}
      />

      {/* ── Map area — fills remaining space between nav and status bar ── */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>

        {/* Map canvas — all feature layers are managed by MapManager via useMapSync */}
        <div style={{ position: 'absolute', inset: 0, zIndex: MAP_Z.canvas }}>
          <LeafletMap />
          {measurementActive && <MeasurementLayerDyn />}
        </div>

        {/* ── Scale bar ── */}
        <div style={{
          position: 'absolute',
          left: 12,
          bottom: 12,
          zIndex: MAP_Z.scale,
          pointerEvents: 'none',
          userSelect: 'none',
        }}>
          <ScaleBar />
        </div>

        {/* ── Panels ─── */}
        <LeftPanel
          open={layersOpen}
          onToggle={() => setLayersOpen((v) => !v)}
          topOffset={0}
          bottomOffset={0}
          projectId={projectId}
          mapId={mapId}
          datasets={activeDatasets}
          annotations={annotations}
          trackedObjects={trackedObjects}
          alerts={alerts}
          annotationSets={annotationSets}
          onRemoveDataset={handleRemoveDataset}
          onRemoveAnnotationSet={handleRemoveAnnotationSet}
          onRenameAnnotationSet={handleRenameAnnotationSet}
        />

        <RightPanel topOffset={0} bottomOffset={0} mapId={mapId} projectId={projectId} />

        <LibraryPanel
          open={libraryOpen}
          topOffset={0}
          bottomOffset={0}
          projectId={projectId}
          mapId={mapId}
          datasets={datasets}
          onClose={() => setLibraryOpen(false)}
        />

        {/* ── Floating Timeline panel — positioned within map area ── */}
        {timelineEnabled && <TimelinePanel />}

      </div>

      {/* ── StatusBar — fixed height at bottom ─────────────── */}
      <MapStatusBar
        cursorLatLng={cursorLatLng}
        zoom={zoom}
        measurementActive={measurementActive}
        totalDistanceM={totalDistance}
        autoSaveStatus={autoSaveStatus}
      />
    </div>
  );
}
