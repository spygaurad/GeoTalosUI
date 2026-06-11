/**
 * Measurement Module
 *
 * Provides distance and area measurement tools on the map.
 * Standalone module with no external dependencies.
 */
import type { MapModule } from '../../core/types';
import { createMeasurementSlice } from './slice';

export const MeasurementModule: MapModule = {
  id: 'measurement',
  name: 'Measurement',
  createSlice: createMeasurementSlice,
  // Measurement logic stays in core MapManager
};
