'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useQuery, useMutation, useQueryClient, useQueries } from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
import { toast } from 'sonner';

import { useMapStore, getMapInstance } from '@/stores/mapStore';
import { useMapLayersStore, wasLayerLocallyRemoved, markLayerLocallyRemoved } from '@/stores/mapLayersStore';
import type { DrawTool, BasemapId } from '@/stores/mapStore';

import { mapsApi } from '@/lib/api/maps';
import { datasetsApi } from '@/lib/api/datasets';
import { mapAoisApi, getOrStartAoiCreate } from '@/lib/api/map-aois';
import { annotationSchemasApi } from '@/lib/api/annotation-schemas';
import { annotationSetsApi } from '@/lib/api/annotation-sets';
import { qk } from '@/lib/query-keys';
import { geometryToTileBounds } from '@/lib/geo';

import { useMapContext } from '@/features/maps/hooks/useMapContext';
import { useMeasureTool } from '@/features/maps/hooks/useMeasureTool';
import { useMapSync } from '@/features/maps/hooks/useMapSync';
import { useAoiTimeline } from '@/features/maps/hooks/useAoiTimeline';
import { getMapManager } from '@/features/maps/MapManager';
import type { DatasetFootprintData } from '@/features/maps/MapManager';
import { MAP_Z } from '@/features/maps/mapColors';
import { buildClassStyles } from '@/features/maps/utils/annotationStyles';
import { getDatasetItemLayerId } from '@/features/maps/utils/datasetItemLayer';
import { buildSegmentationColormapForMap, applyColormapToTileUrl } from '@/features/maps/utils/segmentationColormap';
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

  // ── Fetch annotation sets for all layers on the map (to get schema_id) ───────
  // When a map is reloaded, mapData.layers contains annotation_set_id but not schema_id.
  // We need to fetch each annotation set to get its schema_id.
  const mapAnnotationSetIds = useMemo(() => {
    const ids = new Set<string>();
    if (mapData?.layers) {
      for (const layer of mapData.layers) {
        if (layer.source_type === 'annotation_set' && layer.annotation_set_id) {
          ids.add(layer.annotation_set_id);
        }
      }
    }
    return [...ids];
  }, [mapData?.layers]);

  const annotationSetDetailsQueries = useQueries({
    queries: mapAnnotationSetIds.map((id) => ({
      queryKey: qk.annotationSets.detail(id),
      queryFn: () => annotationSetsApi.get(id),
      staleTime: 30_000,
    })),
  });

  // Build map of fetched annotation set details: setId -> AnnotationSet
  const annotationSetDetailsMap = useMemo(() => {
    const map: Record<string, typeof annotationSetDetailsQueries[0]['data']> = {};
    annotationSetDetailsQueries.forEach((q) => {
      if (q.data) map[q.data.id] = q.data;
    });
    return map;
  }, [annotationSetDetailsQueries]);

  // ── Fetch schema classes for all annotation sets on the map ─────────────────
  // Collect unique schema IDs from:
  // 1. useMapContext annotation sets (already loaded)
  // 2. Fetched annotation set details from mapData.layers
  const annotationSetSchemaIds = useMemo(() => {
    const ids = new Set<string>();
    // From useMapContext annotation sets
    for (const s of annotationSets) {
      if (s.schema_id) ids.add(s.schema_id);
    }
    // From fetched annotation set details
    annotationSetDetailsQueries.forEach((q) => {
      if (q.data?.schema_id) ids.add(q.data.schema_id);
    });
    return [...ids];
  }, [annotationSets, annotationSetDetailsQueries]);

  // Fetch schema classes for each schema (React Query caches for 60s)
  const schemaClassesQueries = useQueries({
    queries: annotationSetSchemaIds.map((id) => ({
      queryKey: qk.annotationSchemas.classes(id),
      queryFn: () => annotationSchemasApi.getClasses(id),
      staleTime: 60_000,
    })),
  });

  // Build lookup: schemaId → classStyles
  const schemaClassStylesMap = useMemo(() => {
    const map: Record<string, ReturnType<typeof buildClassStyles>> = {};
    annotationSetSchemaIds.forEach((id, idx) => {
      const items = schemaClassesQueries[idx]?.data?.items;
      if (items) map[id] = buildClassStyles(items);
    });
    return map;
  }, [annotationSetSchemaIds, schemaClassesQueries]);

  // ── MapManager sync — bridges Zustand → Leaflet ────────────
  useMapSync();

  // ── AOI timeline — fetches items + builds frames when AOI timeline opens ──
  useAoiTimeline(mapId);

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

  // ── AOI draw mode ─────────────────────────────────────────
  const aoiDrawMode = useMapLayersStore((s) => s.aoiDrawMode);
  const setAoiDrawMode = useMapLayersStore((s) => s.setAoiDrawMode);

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

    // Compute the set of layer IDs present in the latest mapData
    const _backendLayerIdSet = new Set(
      mapData.layers.map((bl) => {
        if (bl.source_type === 'annotation_set' && bl.annotation_set_id) return `annset-${bl.annotation_set_id}`;
        if (bl.source_config?.aoi_type === 'bbox') return (bl.source_config.layer_id as string) ?? null;
        if (bl.source_type === 'stac_item' && bl.stac_item_id) return `item-${bl.stac_item_id}`;
        return bl.dataset_id ?? bl.id ?? null;
      }).filter(Boolean) as string[]
    );
    const currentLayers = useMapLayersStore.getState().layers;

    mapData.layers
      .sort((a, b) => a.z_index - b.z_index)
      .forEach((bl) => {
        // Handle annotation_set layers differently
        if (bl.source_type === 'annotation_set' && bl.annotation_set_id) {
          const layerId = `annset-${bl.annotation_set_id}`;

          // Skip if layer already exists in store (prevents re-adding deleted layers)
          if (currentLayers[layerId]) return;
          // Skip if user explicitly deleted this layer in the current session
          if (wasLayerLocallyRemoved(layerId)) return;

          setBackendLayerId(layerId, bl.id);
          // Pre-populate classStyles from:
          // 1. Fetched annotation set details (if available) - has embedded schema
          // 2. The map mount row (keyed by annotation_set_id) - has schema_id only
          // 3. schemaClassStylesMap (from separately-fetched schema classes)
          const annSetDetail = annotationSetDetailsMap[bl.annotation_set_id];
          const annSetMount = annotationSets.find(
            (s) => s.annotation_set_id === bl.annotation_set_id,
          );
          let classStyles = buildClassStyles(annSetDetail?.schema?.classes);

          // If no styles from embedded schema yet, try schemaClassStylesMap
          // which is built from separately-fetched schema classes.
          const schemaId = annSetDetail?.schema_id ?? annSetMount?.schema_id;
          if (!classStyles && schemaId) {
            classStyles = schemaClassStylesMap[schemaId];
          }
          initLayer(layerId, 'annotation', {
            name: bl.name,
            sourceType: 'annotation_set',
            annotationSetId: bl.annotation_set_id,
            zIndex: bl.z_index,
            classStyles,
          });
          if (!bl.visible) setLayerVisible(layerId, false);
          if (bl.opacity !== 1) setLayerOpacity(layerId, bl.opacity);
          return;
        }

        // Legacy: AOI layers stored as map_layers with source_config.aoi_type='bbox'.
        // Restore the geometry to the store so the user sees the rectangle, but DO
        // NOT register the map_layer id as the AOI's backend id — AOI-scoped
        // endpoints (/maps/{id}/aois/{aoi_id}/…) expect a map_aoi id, and the
        // create-on-subscribe effect below will lazily re-save this AOI through
        // the proper endpoint on next interaction.
        if (bl.source_config?.aoi_type === 'bbox') {
          const layerId = bl.source_config.layer_id as string ?? `aoi-${Date.now()}`;
          if (currentLayers[layerId]) return;
          if (wasLayerLocallyRemoved(layerId)) return;
          const geometry = bl.source_config.geometry as import('@/types/geo').GeoJSONGeometry | undefined;
          const bbox = bl.source_config.bbox as [number, number, number, number] | undefined;
          initLayer(layerId, 'aoi', {
            name: bl.name,
            zIndex: bl.z_index,
          });
          if (geometry) {
            useMapLayersStore.setState((s) => ({
              layers: s.layers[layerId]
                ? { ...s.layers, [layerId]: { ...s.layers[layerId], aoiGeometry: geometry, aoiBbox: bbox, bounds: bbox } }
                : s.layers,
            }));
          }
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
        // Skip if user explicitly deleted this layer in the current session
        if (wasLayerLocallyRemoved(layerId)) return;

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
                const _dsMatch = datasets?.find((d) =>
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
  }, [mapData?.layers, schemaClassStylesMap, annotationSets, annotationSetDetailsMap]);

  // ── Sync annotation sets to backend map_layers if missing ──────────────────
  // Annotation-set persistence is handled entirely through the map_annotation_sets
  // mount table now: LeftPanel mounts on add (POST .../mount) and unmounts on
  // remove (DELETE .../unmount), and useMapContext rebuilds the layers from
  // listByMap on reload. The previous effect here mirrored mounts into map_layers
  // rows, but it read `annSet.id`/`annSet.name` off AnnotationSetMount objects
  // (whose fields are `annotation_set_id`/`set_name`), so it only ever created
  // junk rows. Removed to keep a single, consistent persistence path.

  // ── Sync classStyles from annotationSets schema into store ──────────────────
  // When annotation sets are restored from backend, their schema classes (and
  // therefore colors) may not be available yet. This effect runs whenever the
  // annotationSets list or schemaClassStylesMap updates and backfills classStyles
  // for any annotation layer that is currently missing them, then triggers a
  // GeoJSON re-fetch so the map immediately shows the correct colours.
  useEffect(() => {
    if (!annotationSets.length) return;
    const state = useMapLayersStore.getState();
    const layerUpdates: Record<string, import('@/features/maps/types').LayerConfig> = {};

    for (const annSet of annotationSets) {
      const layerId = `annset-${annSet.annotation_set_id}`;
      const layer = state.layers[layerId];
      if (!layer) continue;

      // Mount rows carry only schema_id (no embedded schema), so styles come from
      // the separately-fetched schema classes keyed by schema_id.
      const classStyles = annSet.schema_id ? schemaClassStylesMap[annSet.schema_id] : undefined;

      if (!classStyles) continue;
      // Only update if classStyles are actually different (avoids infinite loops)
      if (JSON.stringify(layer.classStyles) === JSON.stringify(classStyles)) continue;
      layerUpdates[layerId] = { ...layer, classStyles };
    }

    if (Object.keys(layerUpdates).length === 0) return;

    useMapLayersStore.setState((s) => ({
      layers: { ...s.layers, ...layerUpdates },
    }));

    // Trigger a refresh so MapManager re-renders polygons with updated colours
    for (const layerId of Object.keys(layerUpdates)) {
      const annSetId = layerId.replace('annset-', '');
      useMapLayersStore.getState().requestAnnotationSetRefresh(annSetId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotationSets, schemaClassStylesMap]);

  // ── Update existing annotation_set layers when classStyles become available ──
  // If a layer was created without classStyles (because schema wasn't embedded yet),
  // this effect will update it when the separately-fetched schema classes arrive.
  useEffect(() => {
    const state = useMapLayersStore.getState();
    const layerUpdates: Record<string, import('@/features/maps/types').LayerConfig> = {};

    for (const [layerId, layer] of Object.entries(state.layers)) {
      if (layer.sourceType !== 'annotation_set' || !layer.annotationSetId) continue;
      // Only update if layer currently has no classStyles
      if (layer.classStyles) continue;

      const annSet = annotationSets.find((s) => s.annotation_set_id === layer.annotationSetId);
      if (!annSet?.schema_id) continue;

      const classStyles = schemaClassStylesMap[annSet.schema_id];
      if (!classStyles) continue;

      layerUpdates[layerId] = { ...layer, classStyles };
    }

    if (Object.keys(layerUpdates).length === 0) return;

    useMapLayersStore.setState((s) => ({
      layers: { ...s.layers, ...layerUpdates },
    }));

    // Trigger a refresh for each updated layer
    for (const layerId of Object.keys(layerUpdates)) {
      const annSetId = layerId.replace('annset-', '');
      useMapLayersStore.getState().requestAnnotationSetRefresh(annSetId);
    }
  }, [schemaClassStylesMap, annotationSets]);

  // ── Restore saved AOIs from /maps/{id}/aois on mount ────────────────────────
  // First-class AOIs live in their own table now; the legacy map_layers AOI block
  // above stays for backwards compatibility with maps that pre-date this endpoint.
  const { data: savedAoisData } = useQuery({
    queryKey: qk.mapAois.list(mapId),
    queryFn: () => mapAoisApi.listAois(mapId, 100, 0),
    enabled: !!mapId,
    staleTime: 30_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!savedAoisData?.items?.length) return;
    const currentLayers = useMapLayersStore.getState().layers;
    const currentBackendIds = useMapLayersStore.getState().backendLayerIds;

    // Reverse lookup so we can detect "this backend AOI is already represented
    // in the store under a timestamp-based frontend id" (happens immediately
    // after a fresh draw — the subscribe-create path mapped aoi-{ts} → aoi.id).
    const backendToFrontendId = new Map<string, string>();
    for (const [frontendId, backendId] of Object.entries(currentBackendIds)) {
      backendToFrontendId.set(backendId, frontendId);
    }

    for (const aoi of savedAoisData.items) {
      // Stable layer id derived from backend AOI id so reopens don't duplicate.
      const layerId = `aoi-${aoi.id}`;
      if (currentLayers[layerId]) continue;
      if (wasLayerLocallyRemoved(layerId)) continue;

      // If another frontend layer already maps to this backend AOI (the just-
      // drawn aoi-{timestamp} layer), don't create a second one — the frontend
      // layer already represents this AOI.
      const existingFrontendId = backendToFrontendId.get(aoi.id);
      if (existingFrontendId && currentLayers[existingFrontendId]) continue;

      // Track AOI→backend id mapping if we don't already have it
      if (!currentBackendIds[layerId]) setBackendLayerId(layerId, aoi.id);

      initLayer(layerId, 'aoi', { name: aoi.name, zIndex: aoi.z_index });
      const geometry = (aoi.geometry as import('@/types/geo').GeoJSONGeometry | null) ?? undefined;
      const bbox = aoi.bbox_4326 as [number, number, number, number];
      useMapLayersStore.setState((s) => ({
        layers: s.layers[layerId]
          ? {
              ...s.layers,
              [layerId]: {
                ...s.layers[layerId],
                aoiGeometry: geometry,
                aoiBbox: bbox,
                bounds: bbox,
              },
            }
          : s.layers,
      }));
      if (!aoi.visible) setLayerVisible(layerId, false);
      if (aoi.opacity !== 1) setLayerOpacity(layerId, aoi.opacity);

      // Restore previously-selected datasets so the AOI panel reflects backend state
      const selection = aoi.selection_config as
        | { dataset_ids?: string[]; dataset_item_ids?: string[] }
        | null;
      if (selection?.dataset_ids?.length) {
        useMapLayersStore.getState().setAoiSelectedDatasets(selection.dataset_ids);
      }
    }
  }, [savedAoisData?.items, initLayer, setBackendLayerId, setLayerVisible, setLayerOpacity]);

  // ── Persist new AOI layers to backend + delete removed ones ─────────────────
  // Uses the dedicated /maps/{id}/aois endpoints instead of generic map_layers.
  const aoiSyncedRef = useRef<Set<string>>(new Set());
  // Keep latest mapData accessible to the subscribe callback without forcing
  // the subscription to tear down and re-attach on every refetch.
  const mapDataRef = useRef(mapData);
  useEffect(() => { mapDataRef.current = mapData; }, [mapData]);
  useEffect(() => {
    const unsub = useMapLayersStore.subscribe(
      (s) => s.layers,
      (current, prev) => {
        if (!mapId) return;

        // Detect new AOI layers → POST /maps/{id}/aois
        for (const [id, layer] of Object.entries(current)) {
          if (layer.type !== 'aoi') continue;
          if (prev[id]) continue;
          if (aoiSyncedRef.current.has(id)) continue;
          if (useMapLayersStore.getState().backendLayerIds[id]) continue;
          const bbox = layer.aoiBbox;
          if (!bbox) continue; // bbox is required by backend
          aoiSyncedRef.current.add(id);

          // Capture any legacy map_layer rows for this AOI so we can clean them
          // up after a successful migration to /maps/{id}/aois.
          const legacyLayerIds = (mapDataRef.current?.layers ?? [])
            .filter((l) => l.source_config?.aoi_type === 'bbox' && l.source_config?.layer_id === id)
            .map((l) => l.id);

          getOrStartAoiCreate(id, () =>
            mapAoisApi.createAoi(mapId, {
              name: layer.name ?? 'AOI',
              bbox_4326: bbox,
              geometry: layer.aoiGeometry,
              visible: layer.visible,
              opacity: layer.opacity,
              z_index: layer.zIndex,
            }),
          )
            .then(async (aoi) => {
              setBackendLayerId(id, aoi.id);
              if (legacyLayerIds.length > 0) {
                await Promise.allSettled(
                  legacyLayerIds.map((mlid) => datasetsApi.deleteMapLayer(mapId, mlid)),
                );
                queryClient.invalidateQueries({ queryKey: qk.maps.detail(mapId) });
              }
              queryClient.invalidateQueries({ queryKey: qk.mapAois.list(mapId) });
            })
            .catch((err: unknown) => {
              aoiSyncedRef.current.delete(id);
              const msg = err instanceof Error ? err.message : String(err);
              toast.error(`Failed to save AOI: ${msg.slice(0, 100)}`);
            });
        }

        // Detect removed AOI layers → DELETE /maps/{id}/aois/{aoi_id}
        for (const id of Object.keys(prev)) {
          if (current[id]) continue;
          if (prev[id]?.type !== 'aoi') continue;
          const backendId = useMapLayersStore.getState().backendLayerIds[id];
          if (backendId) {
            mapAoisApi.deleteAoi(mapId, backendId).catch(() => {});
          }
          aoiSyncedRef.current.delete(id);
        }
      }
    );
    return unsub;
  }, [mapId, setBackendLayerId, queryClient]);

  // ── Persist new annotation-set layers from store to backend ────────────────
  const annSetLayerSyncedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const unsub = useMapLayersStore.subscribe(
      (s) => s.layers,
      (current, prev) => {
        if (!mapId) return;

        // Detect new annotation_set layers in store → save to backend
        for (const [id, layer] of Object.entries(current)) {
          if (layer.sourceType !== 'annotation_set' || !layer.annotationSetId) continue;
          if (prev[id]) continue;
          if (annSetLayerSyncedRef.current.has(id)) continue;
          if (useMapLayersStore.getState().backendLayerIds[id]) continue;
          annSetLayerSyncedRef.current.add(id);

          datasetsApi.addMapLayer(mapId, {
            name: layer.name ?? 'Annotations',
            layer_type: 'vector',
            source_type: 'annotation_set',
            annotation_set_id: layer.annotationSetId,
            opacity: layer.opacity,
            visible: layer.visible,
            z_index: layer.zIndex,
          }).then((bl) => {
            setBackendLayerId(id, bl.id);
          }).catch(() => {
            annSetLayerSyncedRef.current.delete(id);
          });
        }

        // Detect removed annotation_set layers → delete from backend
        for (const id of Object.keys(prev)) {
          if (current[id]) continue;
          if (prev[id]?.sourceType !== 'annotation_set') continue;
          const backendId = useMapLayersStore.getState().backendLayerIds[id];
          if (backendId) {
            datasetsApi.deleteMapLayer(mapId, backendId).catch(() => {});
          }
          annSetLayerSyncedRef.current.delete(id);
        }
      }
    );
    return unsub;
  }, [mapId, setBackendLayerId]);

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
            if (layer.type === 'aoi') {
              mapAoisApi.updateAoi(mapId, backendId, { visible: layer.visible }).catch(() => {});
            } else {
              datasetsApi.updateMapLayer(mapId, backendId, {
                visible: layer.visible,
              }).catch(() => {});
            }
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

    // Split AOIs (own endpoint) from map_layer-backed layers (batch endpoint).
    const layerUpdates: { id: string; opacity: number }[] = [];
    const aoiUpdates: { id: string; opacity: number }[] = [];
    Object.entries(layerState.layers).forEach(([id, l]) => {
      const backendId = backendIds[id];
      if (!backendId) return;
      if (l.type === 'aoi') {
        aoiUpdates.push({ id: backendId, opacity: l.opacity });
      } else {
        layerUpdates.push({ id: backendId, opacity: l.opacity });
      }
    });

    try {
      await Promise.all([
        mapsApi.autoSave(mapId, {
          view_state: {
            center: [center.lng, center.lat],
            zoom: map.getZoom(),
          },
          layers: layerUpdates.length > 0 ? layerUpdates : undefined,
        }),
        ...aoiUpdates.map((u) =>
          mapAoisApi.updateAoi(mapId, u.id, { opacity: u.opacity }).catch(() => undefined),
        ),
      ]);
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
    const state = useMapLayersStore.getState();
    const backendLayerIds = state.backendLayerIds;
    const itemLayerIds = new Set<string>();
    const backendIdsToDelete = new Set<string>();

    // Item layers currently in the store and linked to this dataset.
    for (const [id, layer] of Object.entries(state.layers)) {
      if (!id.startsWith('item-')) continue;
      if (layer.parentDatasetId !== datasetId) continue;
      itemLayerIds.add(id);
      const backendId = backendLayerIds[id];
      if (backendId) backendIdsToDelete.add(backendId);
    }

    // Fallback for legacy layers that may not have parentDatasetId in the store.
    for (const layer of mapData?.layers ?? []) {
      if (layer.source_type !== 'stac_item' || !layer.stac_item_id) continue;
      const linkedDatasetId =
        layer.dataset_id ??
        (typeof layer.source_config?.dataset_id === 'string'
          ? layer.source_config.dataset_id
          : null);
      if (linkedDatasetId !== datasetId) continue;
      itemLayerIds.add(getDatasetItemLayerId(layer.stac_item_id));
      backendIdsToDelete.add(layer.id);
    }

    const datasetBackendId =
      backendLayerIds[datasetId] ??
      mapData?.layers?.find((layer) => layer.source_type === 'dataset' && layer.dataset_id === datasetId)?.id;
    if (datasetBackendId) backendIdsToDelete.add(datasetBackendId);

    // Delete from backend first, then remove from UI.
    if (backendIdsToDelete.size > 0) {
      const results = await Promise.allSettled(
        [...backendIdsToDelete].map((backendId) => datasetsApi.deleteMapLayer(mapId, backendId)),
      );
      if (results.some((result) => result.status === 'rejected')) {
        toast.error('Failed to remove dataset from map');
        return; // Don't remove from UI if backend delete failed
      }
    }

    // Backend delete succeeded — now remove from UI.
    // removeLayer() marks each id as locally removed so the mapData re-sync effect
    // won't re-add them if mapData re-fetches before the backend DELETE propagates.
    itemLayerIds.forEach((layerId) => removeLayer(layerId));
    removeLayer(datasetId);

    toast.success('Dataset removed from map');
    await queryClient.invalidateQueries({ queryKey: qk.maps.detail(mapId) });
  }, [mapData?.layers, mapId, removeLayer, queryClient]);

  // ── Remove annotation set layer from map ──────────────────
  // Only removes the layer from THIS map's view — does NOT delete the annotation
  // set data. Use the annotation-sets management page to permanently delete sets.
  const handleRemoveAnnotationSet = useCallback(async (setId: string) => {
    const layerId = `annset-${setId}`;
    // Annotation sets are attached to a map via the map_annotation_sets mount
    // table (NOT map_layers), so listByMap keeps returning them — and the
    // useMapContext effect re-adds the layer after a refresh — unless we unmount.
    // A set may also have a legacy map_layers row (created by the sync effect),
    // so we clean up both. The unmount 404s when there's no mount row; that's a
    // valid "already detached" state, so we swallow it and still drop the layer.
    try {
      await annotationSetsApi.unmount(mapId, setId);
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status !== 404) {
        toast.error('Failed to remove annotation set from map');
        return; // Don't remove from UI if unmount failed
      }
      // 404 is ok — already unmounted, continue to clean up legacy rows
    }

    // Clean up legacy map_layer rows if they exist
    const backendId = useMapLayersStore.getState().backendLayerIds[layerId];
    if (backendId) {
      try {
        await datasetsApi.deleteMapLayer(mapId, backendId);
      } catch (err) {
        // Log but don't fail — the unmount already succeeded
        console.warn('Failed to clean up legacy annotation set layer:', err);
      }
    }

    // Backend unmount succeeded — now remove from UI
    removeLayer(layerId);
    toast.success('Annotation set removed from map');
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.annotationSets.listByMap(mapId) }),
      queryClient.invalidateQueries({ queryKey: qk.maps.detail(mapId) }),
    ]);
  }, [mapId, removeLayer, queryClient]);

  // ── Remove AOI ────────────────────────────────────────────
  const handleRemoveAoi = useCallback(async (aoiLayerId: string) => {
    const backendId = useMapLayersStore.getState().backendLayerIds[aoiLayerId];
    if (backendId) {
      try {
        await mapAoisApi.deleteAoi(mapId, backendId);
      } catch {
        toast.error('Failed to delete AOI');
        return; // Don't remove from UI if backend delete failed
      }
    }

    // Legacy cleanup: AOIs created before the dedicated /maps/{id}/aois endpoints
    // live in map_layers with source_config.aoi_type='bbox'. They have no
    // map_aoi backend id, so the call above is a no-op for them. Find any
    // matching legacy map_layer row and delete it via the map_layers endpoint
    // so the AOI doesn't reappear after the next mapData refetch.
    const legacyMatches = (mapData?.layers ?? []).filter(
      (l) => l.source_config?.aoi_type === 'bbox' && l.source_config?.layer_id === aoiLayerId,
    );
    if (legacyMatches.length > 0) {
      const results = await Promise.allSettled(
        legacyMatches.map((l) => datasetsApi.deleteMapLayer(mapId, l.id)),
      );
      if (results.some((r) => r.status === 'rejected')) {
        toast.error('Failed to clean up legacy AOI');
        return; // Don't remove from UI if cleanup failed
      }
    }

    // CASCADE DELETE: Remove all child layers nested under this AOI
    const state = useMapLayersStore.getState();
    const childLayerIds = Object.entries(state.layers)
      .filter(([_, layer]) => layer.parentAoiId === aoiLayerId)
      .map(([id]) => id);

    // Remove each child layer and mark as locally removed
    childLayerIds.forEach((childId) => {
      removeLayer(childId);
      markLayerLocallyRemoved(childId);
    });

    // Backend deletion succeeded — now remove AOI itself from UI
    removeLayer(aoiLayerId);
    markLayerLocallyRemoved(aoiLayerId);

    if (childLayerIds.length > 0) {
      toast.success(`AOI and ${childLayerIds.length} nested layer${childLayerIds.length !== 1 ? 's' : ''} removed from map`);
    } else {
      toast.success('AOI removed from map');
    }

    queryClient.invalidateQueries({ queryKey: qk.mapAois.list(mapId) });
    if (legacyMatches.length > 0) {
      queryClient.invalidateQueries({ queryKey: qk.maps.detail(mapId) });
    }
  }, [mapId, mapData?.layers, removeLayer, queryClient]);

  // ── Rename annotation set ─────────────────────────────────
  const handleRenameAnnotationSet = useCallback(async (setId: string, newName: string) => {
    try {
      await annotationSetsApi.rename(setId, newName);
      // Reflect immediately in the panel — the layer's displayed name falls back
      // to layer.name when the mounts metadata query hasn't loaded the annSet.
      useMapLayersStore.getState().renameLayer(`annset-${setId}`, newName);
      // Refresh the queries that feed the set's display name in the panel.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.annotationSets.listByMap(mapId) }),
        queryClient.invalidateQueries({ queryKey: qk.annotationSets.detail(setId) }),
        queryClient.invalidateQueries({ queryKey: ['annotation-sets'] }),
      ]);
    } catch {
      toast.error('Could not rename annotation set.');
    }
  }, [mapId, queryClient]);

  // ── Clear stale dataset collection tiles for multi-item datasets ──
  useEffect(() => {
    useMapLayersStore.setState((s) => {
      let changed = false;
      const nextLayers = { ...s.layers };

      datasets.forEach((d) => {
        const isSingleItemDataset = d.metadata?.file_count === 1;
        if (isSingleItemDataset) return;
        const layer = nextLayers[d.id];
        if (!layer?.tileUrl) return;
        nextLayers[d.id] = {
          ...layer,
          tileUrl: undefined,
          tileBounds: undefined,
          tileMinZoom: undefined,
          tileMaxZoom: undefined,
        };
        changed = true;
      });

      return changed ? { layers: nextLayers } : s;
    });
  }, [datasets]);

  // ── Auto-fetch TileJSON for single-item dataset overlays ──
  const tileJsonAttemptedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const currentLayers = useMapLayersStore.getState().layers;
    datasets.forEach((d) => {
      const isSingleItemDataset = d.metadata?.file_count === 1;
      if (!isSingleItemDataset) return;
      if (d.status !== 'ready' || !d.stac_collection_id) return;
      if (d.dataset_type !== 'imagery' && d.dataset_type !== 'segmentation_mask') return;
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
          
          const applyTile = (tileUrl: string) => {
            setLayerTileConfig(d.id, {
              tileUrl,
              tileBounds,
              tileMinZoom: tj.minzoom,
              tileMaxZoom: tj.maxzoom,
            });
          };

          // Segmentation masks with a value→class map render with class colors,
          // derived from the schema classes' styles (self-heals on color change).
          const rc = d.metadata?.rendering_config;
          if (rc?.class_map) {
            buildSegmentationColormapForMap(rc.class_map)
              .then((cmap) => applyTile(cmap ? applyColormapToTileUrl(tj.tiles[0], cmap) : tj.tiles[0]))
              .catch(() => applyTile(tj.tiles[0]));
          } else {
            applyTile(tj.tiles[0]);
          }

          // Store rendering config for band selection UI
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
      const setId = annSet.annotation_set_id;
      const layerId = `annset-${setId}`;
      if (!layers[layerId]) return;
      if (annSetFetchedRef.current.has(setId)) return;
      annSetFetchedRef.current.add(setId);

      fetchAnnSetFeatures(setId, layerId);

      // 4C: Register viewport callback for debounced reload on pan/zoom
      mm.registerViewportCallback(layerId, () => {
        fetchAnnSetFeatures(setId, layerId);
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

  // ── On-map annotation actions (verify / delete) ─────────────────────────────
  // The MapManager popup shows small verify/delete buttons on the clicked
  // annotation; the actual API calls run here so they get react-query refresh
  // and toasts. Verify MOVES the annotation into the map's human-verified
  // (map, schema) set (find-or-creating it); delete removes it. Both re-fetch
  // the affected sets. Mirrors FeaturePropertiesPanel's verify/delete.
  useEffect(() => {
    if (!mapReady) return;
    const mm = getMapManager();
    mm.setAnnotationActionHandler((action, ctx) => {
      const setId = ctx.annotationSetId;
      const annId = ctx.annotationId;
      if (!setId || !annId) return;
      if (action === 'delete') {
        annotationSetsApi.deleteFeature(setId, annId)
          .then(() => {
            toast.success('Annotation deleted');
            useMapLayersStore.getState().requestAnnotationSetRefresh(setId);
            void queryClient.invalidateQueries({ queryKey: qk.maps.detail(mapId) });
          })
          .catch(() => toast.error('Failed to delete annotation'));
      } else {
        annotationSetsApi.verifyFeature(setId, annId, mapId)
          .then(async (res) => {
            const store = useMapLayersStore.getState();
            const mm = getMapManager();
            const verifiedLayerId = `annset-${res.verified_set_id}`;
            // Source: drop the moved point from its original layer (only
            // single-slot refresh call, so it can't be clobbered).
            store.requestAnnotationSetRefresh(res.source_set_id);
            // Verified: add (new) or refresh-in-place (existing) via the manager.
            if (!store.layers[verifiedLayerId]) {
              let name = 'Verified annotations';
              try {
                const set = await annotationSetsApi.get(res.verified_set_id);
                name = set.name ?? name;
              } catch { /* keep default name */ }
              store.addAnnotationSetLayer({ setId: res.verified_set_id, name });
            } else {
              try {
                const fc = await annotationSetsApi.getFeatures(res.verified_set_id);
                mm.setLayerData(verifiedLayerId, fc);
              } catch { /* layer may have been removed */ }
            }
            void queryClient.invalidateQueries({ queryKey: qk.maps.detail(mapId) });
            toast.success(
              res.verified_set_created ? 'Verified — verified set created' : 'Annotation verified',
            );
          })
          .catch(() => toast.error('Failed to verify annotation'));
      }
    });
    return () => mm.setAnnotationActionHandler(null);
  }, [mapReady, queryClient, mapId]);

  // ── Temporal annotation filtering: show/hide annotation sets by timeline frame ──
  const timelineIndex = useMapLayersStore((s) => s.timelineIndex);
  const timelineItems = useMapLayersStore((s) => s.timelineItems);
  const setLayerVisibleForTimeline = useMapLayersStore((s) => s.setLayerVisible);

  useEffect(() => {
    if (!timelineEnabled || !timelineDatasetId || timelineItems.length === 0) return;
    const currentItem = timelineItems[timelineIndex];
    const currentStacItemId = currentItem?.stac_item_id ?? null;

    annotationSets.forEach((annSet) => {
      const layerId = `annset-${annSet.annotation_set_id}`;
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

  // ── AOI Timeline: show/hide annotation sets by AOI frame's stacItemIds ─────
  const aoiTimelineEnabled = useMapLayersStore((s) => s.aoiTimelineEnabled);
  const aoiTimelineIndex = useMapLayersStore((s) => s.aoiTimelineIndex);
  const aoiTimelineFrames = useMapLayersStore((s) => s.aoiTimelineFrames);
  const aoiTimelineDatasetIds = useMapLayersStore((s) => s.aoiTimelineDatasetIds);
  const aoiTimelineAnnotationSetIds = useMapLayersStore((s) => s.aoiTimelineAnnotationSetIds);
  const aoiTimelineShowAnnotations = useMapLayersStore((s) => s.aoiTimelineShowAnnotations);

  useEffect(() => {
    if (!aoiTimelineEnabled || aoiTimelineFrames.length === 0) return;
    const frame = aoiTimelineFrames[aoiTimelineIndex];
    if (!frame) return;

    // Raster-only mode: hide every annotation set linked to the AOI datasets.
    if (!aoiTimelineShowAnnotations) {
      const frameDsIds = new Set(aoiTimelineDatasetIds);
      annotationSets.forEach((annSet) => {
        const layerId = `annset-${annSet.annotation_set_id}`;
        if (!layers[layerId]) return;
        if (!annSet.dataset_id || frameDsIds.has(annSet.dataset_id)) {
          setLayerVisibleForTimeline(layerId, false);
        }
      });
      aoiTimelineAnnotationSetIds.forEach((setId) => {
        const layerId = `annset-${setId}`;
        if (layers[layerId]) setLayerVisibleForTimeline(layerId, false);
      });
      return;
    }

    const frameStacIds = new Set(frame.stacItemIds);

    // When a model series is explicitly selected for overlay (Temporal
    // Playback → "Annotation overlay"), restrict playback to exactly those
    // sets and drive visibility off each layer's own stacItemId — so it works
    // regardless of whether the set is in the map's mounts list.
    if (aoiTimelineAnnotationSetIds.length > 0) {
      aoiTimelineAnnotationSetIds.forEach((setId) => {
        const layerId = `annset-${setId}`;
        const layer = layers[layerId];
        if (!layer) return;
        const stacId = layer.stacItemId ?? null;
        const shouldShow = !stacId || frameStacIds.has(stacId);
        setLayerVisibleForTimeline(layerId, shouldShow);
      });
      return;
    }

    // Fallback (no explicit selection): toggle every mounted annotation set
    // linked to one of the AOI timeline datasets by matching the current frame.
    const frameDsIds = new Set(aoiTimelineDatasetIds);
    annotationSets.forEach((annSet) => {
      const layerId = `annset-${annSet.annotation_set_id}`;
      if (!layers[layerId]) return;
      if (annSet.dataset_id && frameDsIds.has(annSet.dataset_id)) {
        const shouldShow = !annSet.stac_item_id || frameStacIds.has(annSet.stac_item_id);
        setLayerVisibleForTimeline(layerId, shouldShow);
      }
    });
  }, [aoiTimelineEnabled, aoiTimelineIndex, aoiTimelineFrames, aoiTimelineDatasetIds, aoiTimelineAnnotationSetIds, aoiTimelineShowAnnotations, annotationSets, layers, setLayerVisibleForTimeline]);

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

  const handleAoiToolClick = useCallback(() => {
    if (aoiDrawMode) {
      // Turn off AOI mode
      setAoiDrawMode(false);
      useMapStore.getState().setActiveDrawTool(null);
      setActiveTool('select');
    } else {
      // Turn on AOI mode — use rectangle draw tool
      setAoiDrawMode(true);
      useMapStore.getState().setActiveDrawTool('rectangle');
      setActiveTool('rectangle');
      // If measurement was active, turn it off
      if (measurementActive) toggleMeasurement();
    }
  }, [aoiDrawMode, setAoiDrawMode, measurementActive, toggleMeasurement]);

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
  const _handleLayerMove = useCallback((layerId: string, direction: 'up' | 'down') => {
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
        aoiDrawMode={aoiDrawMode}
        onAoiToolClick={handleAoiToolClick}
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
          onRemoveAoi={handleRemoveAoi}
          onRenameAnnotationSet={handleRenameAnnotationSet}
        />

        <RightPanel topOffset={0} bottomOffset={0} mapId={mapId} projectId={projectId} datasets={datasets} />

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
        <TimelinePanel />

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
