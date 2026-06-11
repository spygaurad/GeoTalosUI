/**
 * Module registration entry point.
 * Import this file once (in MapEditorShell) to register all map modules.
 */
import { registerMapModule } from '../core/registry';
import { TilesModule } from './tiles';
import { AnnotationsModule } from './annotations';
import { AoiModule } from './aoi';
import { TimelineModule } from './timeline';
import { MeasurementModule } from './measurement';
import { RightPanelModule } from './right-panel';
import { LeftPanelModule } from './left-panel';
import { LibraryModule } from './library';

const allModules = [
  TilesModule,
  AnnotationsModule,
  AoiModule,
  TimelineModule,
  MeasurementModule,
  RightPanelModule,
  LeftPanelModule,
  LibraryModule,
];

// Register all modules (order resolved by dependency graph)
allModules.forEach(registerMapModule);

export {
  TilesModule,
  AnnotationsModule,
  AoiModule,
  TimelineModule,
  MeasurementModule,
  RightPanelModule,
  LeftPanelModule,
  LibraryModule,
};
