/**
 * AOI (Area of Interest) Module
 *
 * Manages AOI polygon layers and their clipped child layers.
 * AOI child layers use dedicated panes created dynamically (aoi-clip-{id}).
 */
import type { MapModule } from '../../core/types';
import { createAoiSlice } from './slice';
import { createAoiManagerExtension } from './manager';
import { useAoiTimelineSync } from './sync';
import { createAuthTileLayer } from '../../shared/auth';

export const AoiModule: MapModule = {
  id: 'aoi',
  name: 'Area of Interest',
  dependencies: ['tiles'],
  createSlice: createAoiSlice,
  // AOI child layers use dedicated panes created dynamically (aoi-clip-{id})
  createManagerExtension: (ctx) =>
    createAoiManagerExtension(ctx, (url, config, paneName) =>
      createAuthTileLayer(ctx.L, url, config, paneName),
    ),
  createSyncHook: () => useAoiTimelineSync,
};
