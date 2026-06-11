import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useMapLayersStore } from '@/stores/mapLayersStore';
import { mapAoisApi } from '@/lib/api/map-aois';
import { qk } from '@/lib/query-keys';
import type { AoiTimelineFrame } from '@/features/maps/types';

/**
 * Hook that fetches timeline data for an AOI from backend endpoint.
 * Replaces STAC-based approach with direct API call to /maps/{map_id}/aois/{aoi_id}/timeline
 *
 * Pushes frames to store when they arrive.
 */
export function useAoiTimeline(mapId?: string) {
  const aoiTimelineEnabled = useMapLayersStore((s) => s.aoiTimelineEnabled);
  // `aoiTimelineAoiId` is the **frontend layer id** (e.g. "aoi-{backendUUID}")
  // so child-layer lookups via `parentAoiId` keep working. Translate it to the
  // backend AOI UUID before hitting `/maps/{id}/aois/{aoi_id}/timeline`.
  const aoiTimelineLayerId = useMapLayersStore((s) => s.aoiTimelineAoiId);
  const backendAoiId = useMapLayersStore((s) =>
    s.aoiTimelineAoiId ? s.backendLayerIds[s.aoiTimelineAoiId] : null,
  );
  // Track how many frames the store currently holds. A re-open (re-run from the
  // panel) resets this to 0 while `aoiTimelineEnabled` is still true and the
  // timeline query is a cache hit — so the push-effect below must re-fire on
  // this transition, not just on its own query inputs.
  const storeFrameCount = useMapLayersStore((s) => s.aoiTimelineFrames.length);

  // Fetch timeline data from backend
  const { data: timeline, isLoading, isError } = useQuery({
    queryKey: qk.mapAois.timeline(mapId || '', backendAoiId || ''),
    queryFn: () => mapAoisApi.getTimeline(mapId!, backendAoiId!),
    enabled: aoiTimelineEnabled && !!mapId && !!backendAoiId,
    staleTime: 60_000,
    retry: 1,
  });

  // Build frames from dataset items (already sorted by backend)
  const frames: AoiTimelineFrame[] = useMemo(() => {
    if (!timeline?.dataset_items) return [];

    // Group items by unique datetime
    const framesByDatetime = new Map<string, AoiTimelineFrame>();

    for (const item of timeline.dataset_items) {
      const datetime = item.item_datetime || item.created_at;
      let frame = framesByDatetime.get(datetime);

      if (!frame) {
        frame = {
          datetime,
          items: [],
          stacItemIds: [],
        };
        framesByDatetime.set(datetime, frame);
      }

      frame.items.push({
        datasetId: item.dataset_id,
        itemId: item.id,
        stacItemId: item.stac_item_id,
      });
      frame.stacItemIds.push(item.stac_item_id);
    }

    // Return as sorted array (backend should already be sorted, but ensure it)
    return Array.from(framesByDatetime.values()).sort((a, b) =>
      new Date(a.datetime).getTime() - new Date(b.datetime).getTime()
    );
  }, [timeline?.dataset_items]);

  // Debug logging
  useEffect(() => {
    if (aoiTimelineEnabled) {
      console.log('[useAoiTimeline]', {
        enabled: aoiTimelineEnabled,
        layerId: aoiTimelineLayerId,
        backendAoiId,
        mapId,
        loading: isLoading,
        error: isError,
        frameCount: frames.length,
      });
    }
  }, [aoiTimelineEnabled, aoiTimelineLayerId, backendAoiId, mapId, isLoading, isError, frames.length]);

  // Push frames to store when they arrive — or re-push after a re-open cleared
  // them. `storeFrameCount` is in the deps so that when openAoiTimeline() resets
  // the store to [] (while this hook's cache-hit query keeps the same `frames`
  // reference and `isLoading=false`), this effect still re-fires and repopulates.
  useEffect(() => {
    if (!aoiTimelineEnabled) return;
    if (isLoading) {
      // Genuine first load: surface the loading state.
      if (storeFrameCount !== 0) useMapLayersStore.getState().setAoiTimelineFrames([]);
      return;
    }
    // Only write when the store is empty, so we don't clobber the user's current
    // frame index on unrelated re-renders or loop forever.
    if (frames.length > 0 && storeFrameCount === 0) {
      useMapLayersStore.getState().setAoiTimelineFrames(frames);
    }
  }, [aoiTimelineEnabled, frames, isLoading, storeFrameCount]);
}
