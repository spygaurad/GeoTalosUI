/**
 * Library Module
 *
 * Provides the dataset/layer library panel for adding new layers to the map.
 * UI-only module — uses core layer state for add operations.
 * Components will be moved here in a later phase.
 */
import type { MapModule } from '../../core/types';

export const LibraryModule: MapModule = {
  id: 'library',
  name: 'Library',
};
