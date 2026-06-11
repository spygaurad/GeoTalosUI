/**
 * Left Panel Module
 *
 * Houses the layer list, layer ordering, and visibility toggles.
 * UI-only module — no state slice (uses core layer state), no manager extension.
 * Components will be moved here in a later phase.
 */
import type { MapModule } from '../../core/types';

export const LeftPanelModule: MapModule = {
  id: 'left-panel',
  name: 'Left Panel',
};
