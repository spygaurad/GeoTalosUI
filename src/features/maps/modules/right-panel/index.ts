/**
 * Right Panel Module
 *
 * Manages the right sidebar state: which panel is open, feature inspection,
 * annotation set details, dataset item details, and layer style editing.
 */
import type { MapModule } from '../../core/types';
import { createRightPanelSlice } from './slice';

export const RightPanelModule: MapModule = {
  id: 'right-panel',
  name: 'Right Panel',
  createSlice: createRightPanelSlice,
};
