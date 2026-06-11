/**
 * Timeline Slice
 *
 * Manages single-dataset temporal playback state: item list,
 * current index, play/pause, speed, and date-range filtering.
 */

import type { DatasetItem } from '@/types/api';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createTimelineSlice(set: any, get: any) {
  return {
    // ── State ──────────────────────────────────────────────────────────────
    timelineEnabled: false,
    timelineDatasetId: null as string | null,
    timelineItems: [] as DatasetItem[],
    timelineIndex: 0,
    timelinePlaying: false,
    timelineSpeed: 2000,
    timelineRange: null as [string, string] | null,
    timelineOriginalTileUrl: null as string | null,

    // ── Actions ────────────────────────────────────────────────────────────
    openTimeline: (datasetId: string) => {
      const layer = get().layers[datasetId];
      const originalUrl = layer?.tileUrl ?? null;
      set({
        // Close AOI timeline if open
        aoiTimelineEnabled: false,
        aoiTimelineAoiId: null,
        aoiTimelinePlaying: false,
        // Open single-dataset timeline
        timelineEnabled: true,
        timelineDatasetId: datasetId,
        timelineItems: [],
        timelineIndex: 0,
        timelinePlaying: false,
        timelineRange: null,
        timelineOriginalTileUrl: originalUrl,
      });
    },

    closeTimeline: () =>
      set({
        timelineEnabled: false,
        timelineDatasetId: null,
        timelineItems: [],
        timelineIndex: 0,
        timelinePlaying: false,
        timelineRange: null,
      }),

    setTimelineItems: (items: DatasetItem[]) =>
      set({ timelineItems: items }),

    setTimelineIndex: (index: number) =>
      set({ timelineIndex: index, timelinePlaying: false }),

    stepTimeline: (direction: 'next' | 'prev') =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      set((s: any) => {
        if (s.timelineItems.length === 0) return s;

        const filtered = s.timelineRange
          ? s.timelineItems.filter((item: DatasetItem) => {
              if (!item.datetime) return true;
              const d = new Date(item.datetime).getTime();
              const [from, to] = s.timelineRange!;
              if (from && d < new Date(from).getTime()) return false;
              if (to && d > new Date(to + 'T23:59:59').getTime()) return false;
              return true;
            })
          : s.timelineItems;

        if (filtered.length === 0) return s;

        const currentItem = s.timelineItems[s.timelineIndex];
        let filteredIdx = filtered.findIndex((it: DatasetItem) => it.id === currentItem?.id);
        if (filteredIdx === -1) filteredIdx = 0;

        let nextFilteredIdx: number;
        if (direction === 'next') nextFilteredIdx = (filteredIdx + 1) % filtered.length;
        else nextFilteredIdx = (filteredIdx - 1 + filtered.length) % filtered.length;

        const nextItem = filtered[nextFilteredIdx];
        const newIndex = s.timelineItems.findIndex((it: DatasetItem) => it.id === nextItem.id);
        return { timelineIndex: newIndex >= 0 ? newIndex : 0 };
      }),

    toggleTimelinePlay: () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      set((s: any) => ({ timelinePlaying: !s.timelinePlaying })),

    setTimelineSpeed: (ms: number) =>
      set({ timelineSpeed: ms }),

    setTimelineRange: (range: [string, string] | null) =>
      set({ timelineRange: range }),
  };
}
