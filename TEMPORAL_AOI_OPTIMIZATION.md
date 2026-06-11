# Temporal AOI Playback Optimization — Backend Integration Plan

## ✅ Verified Backend Endpoints

The three new endpoints were confirmed in `/GeoTalosProd/app/api/v1/endpoints/map_aois.py`:

### 1. GET `/maps/{map_id}/aois/{aoi_id}/timeline`
- **Line 248-259** of map_aois.py
- **Returns**: `MapAOITimelineRead` with dataset items sorted by timestamp
- **What it does**: Resolves AOI's selected dataset items, filters by AOI bbox, sorts by `item_datetime`
- **Replaces**: Current STAC API queries per dataset + client-side STAC feature parsing

```python
# Returns:
{
  "aoi_id": "uuid",
  "bbox_4326": [minx, miny, maxx, maxy],
  "dataset_items": [DatasetItemRead]  # Pre-sorted by datetime
}
```

### 2. POST `/maps/{map_id}/aois/{aoi_id}/timeline/prepare`
- **Line 262-293** of map_aois.py
- **Returns**: `MapAOITimelineManifestRead` with frame manifest cached in Redis
- **What it does**: Builds frame structure server-side + caches manifest key for later retrieval
- **Replaces**: Client-side `buildFrames()` logic (currently in useAoiTimeline.ts line 22-62)

```python
# Returns:
{
  "aoi_id": "uuid",
  "manifest_key": "str",  # Redis cache key for prefetching
  "frame_count": 42,
  "bbox_4326": [...],
  "render_config": {...},
  "frames": [...]  # Frame list (can be used for timeline scrubber)
}
```

### 3. POST `/maps/{map_id}/aois/{aoi_id}/tilejson`
- **Line 296-333** of map_aois.py
- **Returns**: TileJSON with TiTiler mosaic ID for the AOI's selected items
- **What it does**: Registers all AOI dataset items as a TiTiler mosaic, returns TileJSON
- **Replaces**: Current frame-by-frame tile URL fetching + multi-item mosaic construction

```python
# Request body:
{
  "assets": "optional",
  "preset": "optional",
  "rescale": "optional",
  "asset_bidx": "optional"
}

# Returns TileJSON + extra fields:
{
  ...standard_tilejson...,
  "aoi_id": "uuid",
  "bbox_4326": [...],
  "item_ids": [...]
}
```

---

## 📊 Current Inefficiencies (useAoiTimeline.ts)

| Issue | Location | Impact |
|-------|----------|--------|
| **N STAC queries** | Line 140-152 | One per dataset, waits for all to resolve |
| **Client-side frame building** | Line 22-62 | Rebuilds frames on every query change |
| **No caching** | Throughout | Frame structure recalculated on playback restart |
| **Per-frame tile fetching** | aoi/sync.ts L142, L179 | Blocks frame swap on tile config lookup |
| **Dual-fetch for multi-item frames** | aoi/sync.ts L177-182 | Calls `getMultiItemTileJson()` dynamically |

---

## 🎯 Proposed UI Changes

### Phase 1: Replace STAC-based timeline with API endpoint

**File**: `src/features/maps/hooks/useAoiTimeline.ts`

**Replace current implementation with:**
```typescript
import { useQuery } from '@tanstack/react-query';
import { mapAoisApi } from '@/lib/api/map-aois';  // NEW
import { qk } from '@/lib/query-keys';

export function useAoiTimeline() {
  const enabled = useMapLayersStore((s) => s.aoiTimelineEnabled);
  const aoiId = useMapLayersStore((s) => s.aoiTimelineAoiId);
  const mapId = useMapLayersStore((s) => s.activeMapId);

  const { data: timeline } = useQuery({
    queryKey: qk.mapAois.timeline(mapId, aoiId),  // NEW key factory
    queryFn: () => mapAoisApi.getTimeline(mapId, aoiId),  // Single call, all items
    enabled: enabled && !!aoiId && !!mapId,
    staleTime: 60_000,
  });

  // Build frames from API response (no STAC parsing)
  const frames = useMemo(() => {
    if (!timeline?.dataset_items) return [];
    return timeline.dataset_items.map((item) => ({
      datetime: item.item_datetime || item.created_at,
      items: [{ datasetId: item.dataset_id, itemId: item.id }],
      stacItemIds: [item.stac_item_id],
    }));
  }, [timeline?.dataset_items]);

  // Push to store
  useEffect(() => {
    if (frames.length > 0) {
      useMapLayersStore.getState().setAoiTimelineFrames(frames);
    }
  }, [frames]);
}
```

**Why this is better:**
- ✅ Single API call instead of N STAC queries
- ✅ Items already sorted by backend
- ✅ No STAC feature parsing
- ✅ Server handles bbox filtering

---

### Phase 2: Pre-cache frame manifest on AOI timeline open

**File**: `src/features/maps/modules/aoi/sync.ts` OR new hook `useAoiTimelinePreload.ts`

**Add new hook:**
```typescript
export function useAoiTimelinePrefetch() {
  const enabled = useMapLayersStore((s) => s.aoiTimelineEnabled);
  const aoiId = useMapLayersStore((s) => s.aoiTimelineAoiId);
  const mapId = useMapLayersStore((s) => s.activeMapId);

  // Call /timeline/prepare once when AOI timeline is enabled
  useEffect(() => {
    if (!enabled || !aoiId || !mapId) return;

    mapAoisApi.prepareTimeline(mapId, aoiId)
      .then(manifest => {
        console.log(`AOI timeline cached: ${manifest.frame_count} frames`);
        // Store manifest_key in store for later reference (optional)
        // useMapLayersStore.getState().setAoiTimelineManifest(manifest);
      })
      .catch(err => console.error('Failed to prepare timeline:', err));
  }, [enabled, aoiId, mapId]);
}
```

**Why this matters:**
- ✅ Builds frame manifest server-side (Redis cache)
- ✅ Subsequent frame accesses are faster
- ✅ Reduces per-frame computation

---

### Phase 3: Simplify tile loading with upfront TileJSON

**File**: `src/features/maps/modules/aoi/sync.ts` (lines 136-205)

**Current approach** (inefficient):
- On each frame change → fetch tile URL for that frame's STAC items
- Multi-item frame → calls `getMultiItemTileJson()` which registers mosaic on-demand

**New approach:**
```typescript
// Call once when AOI timeline opens
const { data: aoiTileJson } = useQuery({
  queryKey: qk.mapAois.tilejson(mapId, aoiId),
  queryFn: () => mapAoisApi.getTileJSON(mapId, aoiId, {
    assets: aoiRenderConfig?.assets,
    rescale: aoiRenderConfig?.rescale,
    asset_bidx: aoiRenderConfig?.asset_bidx,
  }),
  enabled: enabled && !!aoiId && !!mapId,
});

// Use single TileJSON URL for all frames
// (TiTiler mosaic already includes all items, temporal filtering is UI-side only)
```

**Changes in sync logic:**
```typescript
// Instead of:
// 1. Fetch tile URL for frame[idx] items
// 2. Build mosaic for multi-item frames
// 3. Update tile layer

// Do:
// 1. Use pre-loaded aoiTileJson.tiles[0] as the base
// 2. Apply AOI bbox + render config as tile URL params
// 3. Update tile layer (same operation, but URL was pre-computed)
```

**Why this is faster:**
- ✅ TileJSON created once, reused for all frames
- ✅ No frame-dependent tile registration
- ✅ Renders immediately on frame change

---

## 📋 Implementation Checklist

- [ ] **Create API module** `src/lib/api/map-aois.ts`
  - [ ] `getTimeline(mapId, aoiId)` → GET endpoint
  - [ ] `prepareTimeline(mapId, aoiId)` → POST endpoint
  - [ ] `getTileJSON(mapId, aoiId, config)` → POST endpoint

- [ ] **Add query keys** `src/lib/query-keys.ts`
  - [ ] `qk.mapAois.timeline(mapId, aoiId)`
  - [ ] `qk.mapAois.tilejson(mapId, aoiId)`

- [ ] **Update endpoints** `src/lib/api/endpoints.ts`
  - [ ] Add map AOI endpoints under `EP.maps` (or new `EP.mapAois`)

- [ ] **Refactor useAoiTimeline.ts**
  - [ ] Remove STAC queries
  - [ ] Use GET /timeline
  - [ ] Simplify frame building (no STAC parsing)

- [ ] **Add prefetch hook** `useAoiTimelinePrefetch.ts`
  - [ ] Call POST /timeline/prepare when timeline opens

- [ ] **Simplify aoi/sync.ts**
  - [ ] Remove per-frame tile URL fetching (lines 142, 179)
  - [ ] Use single TileJSON for all frames
  - [ ] Keep frame swap logic the same

- [ ] **Test timeline playback**
  - [ ] Frame scrubbing speed
  - [ ] Auto-play smoothness
  - [ ] No flashing/lag on frame transitions

---

## 🚀 Expected Performance Gains

| Scenario | Current | Optimized | Gain |
|----------|---------|-----------|------|
| **Open AOI timeline** | N STAC queries (500ms-2s) | 1 API call (50-100ms) | **10-20x faster** |
| **First frame display** | Fetch tile URL (100-300ms) | Pre-loaded TileJSON (0ms) | **Instant** |
| **Frame transition** | Fetch + register tile (200-500ms) | Apply URL params (0ms) | **Smoother playback** |
| **Multi-dataset frames** | Mosaic registration on-demand (1s+) | Pre-registered mosaic (0ms) | **No stalls** |

---

## 📝 Notes

1. **Backward compatibility**: Old single-dataset timeline (timelineEnabled + timelineItems) continues working unchanged
2. **Render config**: AOI's render_config (bands, rescale, etc.) is already captured in TiTiler mosaic
3. **Prefetch optional**: POST /timeline/prepare can be optional for basic playback; needed only for smooth prefetch
4. **Frame filtering**: Date range filtering stays in UI (TimelinePanel); no backend change needed

---

## Questions for User

1. Should the prefetch (POST /timeline/prepare) happen automatically on open, or on-demand?
2. Do you want to store the `manifest_key` in store for future manifest retrieval, or keep it ephemeral?
3. Should the TileJSON request include render config params upfront, or apply them dynamically?
