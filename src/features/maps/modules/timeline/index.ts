/**
 * Timeline Module
 *
 * Controls temporal filtering of dataset items by date range.
 * Interacts with tile layers to show/hide items based on the active time window.
 */
import type { MapModule } from '../../core/types';
import { createTimelineSlice } from './slice';
import { useTimelineSync } from './sync';

export const TimelineModule: MapModule = {
  id: 'timeline',
  name: 'Timeline',
  dependencies: ['tiles'],
  createSlice: createTimelineSlice,
  createSyncHook: () => useTimelineSync,
};
