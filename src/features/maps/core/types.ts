/**
 * Core types for the modular MapManager architecture.
 *
 * Every map feature (AOI, annotations, timeline, measurement, etc.) implements
 * the MapModule interface. The core system composes modules at runtime.
 */

import type L from 'leaflet';

// ── Zustand slice types ─────────────────────────────────────────────────────

/** Generic Zustand set/get/api for slice creators */
export type SetState = (
  partial: Record<string, unknown> | ((state: Record<string, unknown>) => Record<string, unknown>),
) => void;
export type GetState = () => Record<string, unknown>;
export type StoreApi = { setState: SetState; getState: GetState; subscribe: Function };

/** Zustand slice creator — returns state + actions for one module */
export type SliceCreator = (
  set: SetState,
  get: GetState,
  api: StoreApi,
) => Record<string, unknown>;

// ── Leaflet pane declaration ────────────────────────────────────────────────

export interface PaneDefinition {
  /** Pane name (used in Leaflet layer options) */
  name: string;
  /** CSS z-index for stacking order */
  zIndex: number;
}

// ── Feature type registration ───────────────────────────────────────────────

export interface PropertySchema {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'color' | 'slider' | 'select';
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
}

export interface FeatureTypeConfig {
  label: string;
  icon?: string;
  schema: PropertySchema[];
  applyUpdate?: (layer: unknown, key: string, value: unknown) => void;
}

// ── Manager context (passed to module extensions) ───────────────────────────

export interface ManagerContext {
  /** The Leaflet map instance */
  map: L.Map;
  /** The Leaflet module reference (for creating layers, markers, etc.) */
  L: typeof import('leaflet');
  /** Shared layer storage — modules register their Leaflet layers here */
  leafletLayers: Map<string, L.Layer>;
  /** Raw data store for GeoJSON/feature data */
  dataStore: Map<string, unknown>;
  /** Tracks which layer IDs are currently added to the map */
  onMap: Set<string>;
  /** Pointer markers for layers (zoom-aware eye icons) */
  pointerLayers: Map<string, L.Marker>;
  /** Read the current Zustand store state */
  getStore: () => Record<string, unknown>;
  /** Access another module's manager extension methods */
  getExtension: <T>(moduleId: string) => T;
}

// ── Layer factory ───────────────────────────────────────────────────────────

/**
 * A layer factory function. Given a config, returns a Leaflet layer or null
 * if this factory doesn't handle this config type.
 */
export type LayerFactory = (
  config: Record<string, unknown>,
  ctx: ManagerContext,
) => L.Layer | null;

// ── MapModule interface (the standard contract) ─────────────────────────────

/**
 * A MapModule encapsulates a self-contained map feature.
 *
 * Each module can provide:
 * - A Zustand state slice (state + actions)
 * - MapManager extension methods (imperative Leaflet logic)
 * - A sync hook (store → manager reactive bridge)
 * - Leaflet pane declarations
 * - Feature type registrations
 *
 * Modules are registered via `registerMapModule()` and composed by the core.
 */
export interface MapModule {
  /** Unique identifier, e.g. 'annotations', 'aoi', 'measurement' */
  readonly id: string;

  /** Human-readable name for debugging/logging */
  readonly name: string;

  /** Dependencies on other modules (by id). Core resolves initialization order. */
  readonly dependencies?: string[];

  /**
   * Zustand slice creator. Returns state + actions for this module.
   * All slices compose into a single store — cross-slice reads use `get()`.
   */
  createSlice?: SliceCreator;

  /**
   * MapManager extension factory. Called during MapManager.init() with the
   * shared context. Returns methods that get merged onto the manager.
   *
   * Methods can reference each other and the shared infrastructure
   * (leafletLayers, dataStore, onMap) via the ManagerContext.
   */
  createManagerExtension?: (ctx: ManagerContext) => Record<string, Function>;

  /**
   * Layer factory. Given a LayerConfig, returns a Leaflet layer if this
   * module handles this type, or null to pass to the next module.
   */
  layerFactory?: LayerFactory;

  /**
   * Sync hook factory. Returns a React hook that subscribes to this
   * module's store fields and dispatches to MapManager.
   * Called inside the composed useMapSync().
   */
  createSyncHook?: () => () => void;

  /**
   * Leaflet pane definitions required by this module.
   * Created during MapManager.init() before any layers are added.
   */
  panes?: PaneDefinition[];

  /**
   * Feature type registrations. Extends the feature registry at module load.
   */
  featureTypes?: Array<{ type: string; config: FeatureTypeConfig }>;
}
