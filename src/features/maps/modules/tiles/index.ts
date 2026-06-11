/**
 * Tiles Module
 *
 * Manages basemap and data tile layers (XYZ, WMS, COG).
 * Owns the two foundational map panes that all other layers sit above.
 */
import type { MapModule } from '../../core/types';
import { createTilesManagerExtension } from './manager';

export const TilesModule: MapModule = {
  id: 'tiles',
  name: 'Tile Layers',
  panes: [
    { name: 'awakeforest-basemap', zIndex: 0 },
    { name: 'awakeforest-data', zIndex: 100 },
  ],
  createManagerExtension: (ctx) => createTilesManagerExtension(ctx),
};
