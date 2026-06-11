/**
 * Annotations Module
 *
 * Handles annotation sets, drawing tools, and annotation geometry display.
 * Depends on the tiles module for base pane ordering.
 */
import type { MapModule } from '../../core/types';
import { createAnnotationSlice } from './slice';
import { createAnnotationsManagerExtension } from './manager';
import { useAnnotationSync } from './sync';

export const AnnotationsModule: MapModule = {
  id: 'annotations',
  name: 'Annotations',
  dependencies: ['tiles'],
  createSlice: createAnnotationSlice,
  panes: [
    { name: 'awakeforest-annotations', zIndex: 150 },
  ],
  createManagerExtension: (ctx) => createAnnotationsManagerExtension(ctx),
  createSyncHook: () => useAnnotationSync,
};
