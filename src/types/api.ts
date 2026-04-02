import type { GeoJSONGeometry } from './geo';

// --- Organizations & Users ---
export interface Organization {
  id: string;
  clerk_org_id: string;
  name: string;
  settings: Record<string, unknown>;
  created_at: string;
}

export interface User {
  id: string;
  clerk_user_id: string;
  email: string;
  name: string;
}

// --- Projects ---
export interface Project {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// --- Maps (work units inside a project) ---
export interface MapViewState {
  center: [number, number]; // [lng, lat]
  zoom: number;
  bearing?: number;
  pitch?: number;
}

/** Layer as returned by GET /maps/{id} → layers[] */
export interface MapApiLayer {
  id: string;
  name: string;
  layer_type: string;
  source_type: 'dataset' | 'stac_item' | 'tile_service' | 'annotation_set';
  dataset_id: string | null;
  stac_item_id: string | null;
  tile_service_url: string | null;
  annotation_set_id: string | null;
  source_config: Record<string, unknown> | null;
  z_index: number;
  visible: boolean;
  opacity: number;
  style_override: Record<string, unknown> | null;
}

export interface ProjectMap {
  id: string;
  project_id: string;
  organization_id: string;
  name: string;
  description: string | null;
  /** Present on GET /maps/{id} detail response. Absent in list responses. */
  view_state?: MapViewState | null;
  /** Fully populated on GET /maps/{id}. Absent in list responses. */
  layers?: MapApiLayer[];
  base_style?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectMember {
  project_id: string;
  user_id: string;
  role: 'admin' | 'member' | 'viewer';
  user: Pick<User, 'id' | 'email' | 'name'>;
}

// --- Datasets ---
/** Actual status values returned by the API. */
export type DatasetStatus = 'pending' | 'ingesting' | 'ready' | 'failed';

export interface DatasetTemporalExtent {
  lower: string;
  upper: string;
  bounds: string;
}

export interface DatasetMetadata {
  gsd_max?: number;
  gsd_min?: number;
  band_count?: string[];
  file_count?: number;
  native_crs?: string[];
  total_size_bytes?: number;
  rendering_config?: RenderingConfig | null;
}

// ── Rendering / Band metadata (from titiler ingestion) ──────────────────────

export interface BandInfo {
  index: number;
  dtype: string;
  colorinterp: string;
  description: string;
  spectral_name: string | null;
  stats: {
    min: number;
    max: number;
    mean: number;
    p2: number;
    p98: number;
  };
}

export interface RenderingPreset {
  label: string;
  params: Record<string, string>;
}

export interface RenderingConfig {
  version: number;
  dtype: string;
  band_count: number;
  nodata_value: number | null;
  colorinterp: string[];
  bands: BandInfo[];
  data_category: string;
  default_preset: string;
  presets: Record<string, RenderingPreset>;
}

export interface Dataset {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  dataset_type: 'raster' | 'vector';
  status: DatasetStatus;
  stac_collection_id: string | null;
  /** Spatial footprint of the dataset — same field that was previously `spatial_extent`. */
  geometry: GeoJSONGeometry | null;
  temporal_extent: DatasetTemporalExtent | null;
  metadata: DatasetMetadata | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface DatasetItem {
  id: string;
  dataset_id: string;
  stac_item_id: string;
  stac_collection_id: string;
  filename: string;
  geometry: GeoJSONGeometry;
  datetime: string;
  properties_cache: Record<string, unknown>;
}

export type DatasetRelationshipType =
  | 'derived_from'
  | 'supersedes'
  | 'supplements'
  | 'same_area_different_sensor'
  | 'temporal_continuation';

// --- Annotation Schemas & Classes ---

/** Persistent style definition from the backend Style table. */
export interface StyleDefinition {
  id: string;
  name: string;
  type: string;
  definition: {
    fillColor: string;
    strokeColor: string;
    strokeWidth: number;
    fillOpacity: number;
    [key: string]: unknown;
  };
}

export interface AnnotationSchema {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  version: number;
  geometry_types: string[];      // ['Point', 'Polygon', ...]
  properties_schema: Record<string, unknown> | null;
  classes: AnnotationClass[];
  created_at: string;
  updated_at: string;

}

export interface AnnotationClass {
  id: string;
  schema_id: string;
  parent_id: string | null;
  name: string;
  path: string | null;           // ltree: "species.Bird.Sparrow"
  style: StyleDefinition | null; // embedded from Style table
  properties: Record<string, unknown> | null;
}

// --- Annotation Sets ---

export interface AnnotationSet {
  id: string;
  map_id: string;
  schema_id: string | null;
  dataset_id: string | null;
  stac_item_id: string | null;
  name: string;
  description: string | null;
  created_by_user_id: string | null;
  created_by_job_id: string | null;
  annotation_count?: number;
  schema?: AnnotationSchema | null;
  created_at: string;
  updated_at: string;
}

/** Who created an annotation — user (manual draw) or job (ML output). */
export type AnnotationCreatedBy = 'user' | 'job';

/** A single annotation feature within an AnnotationSet. */
export interface AnnotationFeature {
  id: string;
  annotation_set_id: string;
  class_id: string;
  geometry: GeoJSONGeometry;
  confidence: number | null;
  properties: Record<string, unknown> | null;
  created_by: AnnotationCreatedBy;
  created_by_id: string;
  created_at: string;
  updated_at: string;
}

// --- Annotations (legacy flat model) ---
export type AnnotationStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'archived';
export type AnnotationSource = 'manual' | 'model' | 'import';
export type AnnotationChangeType = 'create' | 'update' | 'delete' | 'bulk_update';

export interface Annotation {
  id: string;
  organization_id: string;
  dataset_item_id: string;
  geometry: GeoJSONGeometry;
  pixel_coords: Record<string, unknown> | null;
  label: string;
  confidence: number | null;
  source: AnnotationSource;
  track_id: string | null;
  status: AnnotationStatus;
  version: number;
  is_current: boolean;
  parent_version_id: string | null;
  properties: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AnnotationVersion {
  id: string;
  annotation_id: string;
  version: number;
  geometry: GeoJSONGeometry;
  label: string;
  confidence: number | null;
  change_type: AnnotationChangeType;
  changed_by: string | null;
  created_at: string;
}

export interface LabelSchema {
  id: string;
  organization_id: string;
  project_id: string;
  name: string;
  labels: { name: string; color: string; description?: string }[];
  created_at: string;
}

// --- Tracking ---
export type ObjectType =
  | 'deforestation_front'
  | 'fire_perimeter'
  | 'building'
  | 'water_body'
  | 'custom';
export type TrackedObjectStatus = 'active' | 'resolved' | 'archived' | 'merged';
export type Priority = 'critical' | 'high' | 'medium' | 'low';

export interface TrackedObject {
  id: string;
  organization_id: string;
  project_id: string;
  object_type: ObjectType;
  status: TrackedObjectStatus;
  priority: Priority;
  severity: 'critical' | 'warning' | 'info';
  confidence_score: number | null;
  merged_into_id: string | null;
  first_observed_at: string | null;
  last_observed_at: string | null;
  observation_count: number;
  latest_geometry: GeoJSONGeometry | null;
  alert_threshold: Record<string, unknown>;
  created_at: string;
}

export interface TrackedObjectObservation {
  id: string;
  tracked_object_id: string;
  annotation_id: string | null;
  stac_item_id: string | null;
  observation_datetime: string;
  geometry: GeoJSONGeometry;
  properties: Record<string, unknown>;
  sensor: string | null;
}

// --- ML Models ---
export type ModelType = 'detection' | 'segmentation' | 'classification';

export interface MLModel {
  id: string;
  organization_id: string;
  name: string;
  type: ModelType;
  version: string;
  artifact_uri: string;
  config: Record<string, unknown>;
  created_at: string;
}

// --- Alerts ---
export type AlertType =
  | 'area_change'
  | 'ndvi_drop'
  | 'new_detection'
  | 'boundary_breach'
  | 'threshold_exceeded';
export type AlertSeverity = 'critical' | 'warning' | 'info';
export type AlertStatus = 'open' | 'acknowledged' | 'resolved';

export interface Alert {
  id: string;
  organization_id: string;
  tracked_object_id: string | null;
  alert_type: AlertType;
  severity: AlertSeverity;
  title: string;
  geometry: GeoJSONGeometry;
  trigger_data: Record<string, unknown>;
  status: AlertStatus;
  stac_item_id: string | null;
  created_at: string;
}

export interface AlertSubscription {
  id: string;
  organization_id: string;
  user_id: string;
  aoi_geometry: GeoJSONGeometry;
  object_types: ObjectType[];
  min_severity: AlertSeverity;
  channels: { email?: string[]; webhook?: string[] };
  cooldown_minutes: number;
  last_notified_at: string | null;
  created_at: string;
}

// --- Basemaps & Bookmarks ---
export type LayerType = 'vector' | 'raster_tile' | 'xyz_tile' | 'wms' | 'geojson';

export interface BasemapLayer {
  id: string;
  organization_id: string;
  name: string;
  layer_type: LayerType;
  url: string;
  attribution: string | null;
  config: Record<string, unknown>;
  created_at: string;
}

export interface SpatialBookmark {
  id: string;
  organization_id: string;
  name: string;
  center: GeoJSONGeometry; // Point
  zoom: number;
  bearing: number;
  pitch: number;
  visible_layers: string[];
  filters: Record<string, unknown>;
  created_at: string;
}

// --- API Keys ---
export interface ApiKey {
  id: string;
  organization_id: string;
  user_id: string;
  name: string;
  key_prefix: string; // first 8 chars only — never full key
  permissions: Record<string, unknown>;
  expires_at: string | null;
  created_at: string;
}

export interface ApiKeyCreated extends ApiKey {
  plaintext_key: string; // returned ONCE on creation only
}

// --- Audit Log ---
export interface AuditLogEntry {
  id: string;
  organization_id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

// --- Map Layer State ---

export interface LayerStyle {
  fillColor: string;
  fillOpacity: number; // 0–1
  strokeColor: string;
  strokeWidth: number;
  strokeEnabled: boolean;
  labelField?: string;
  categorizeField?: string;
}

export type MapLayerType =
  | 'dataset'
  | 'annotation'
  | 'tracking'
  | 'alerts'
  | 'project_ref'
  | 'basemap';

export interface MapLayerEntry {
  id: string;
  name: string;
  type: MapLayerType;
  visible: boolean;
  style: LayerStyle;
  /** For project_ref layers — the project being referenced */
  sourceProjectId?: string;
  sourceProjectName?: string;
  /** For dataset layers */
  datasetId?: string;
}

/** A pointer from one project's map to another project's data layer. Backend entity. */
export interface ProjectLayerRef {
  id: string;
  map_project_id: string;
  source_project_id: string;
  source_type: 'datasets' | 'annotations' | 'tracking' | 'alerts';
  source_item_id?: string;
  name: string;
  style: LayerStyle;
  created_at: string;
}

// --- Automation Pipelines ---

export type PipelineTriggerType = 'manual' | 'schedule' | 'event';
export type PipelineStatus = 'draft' | 'active' | 'paused' | 'archived';
export type PipelineRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type PipelineRunStepStatus =
  | 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  | 'waiting_for_job';

export interface HandleDef {
  handle: string;
  type: string;
  required?: boolean;
  multiple?: boolean;
  label?: string;
}

export interface NodeCatalogEntry {
  type: string;
  category: string;
  label: string;
  description: string;
  icon?: string;
  inputs: HandleDef[];
  outputs: HandleDef[];
  config_schema: Record<string, unknown>;
  status: 'implemented' | 'placeholder';
  frontend_preview: boolean;
  color?: string;
  min_width?: number;
}

export interface HandleTypeInfo {
  type: string;
  label: string;
  description: string;
  color: string;
}

export interface NodeCatalogCategory {
  name: string;
  label: string;
  icon: string;
  nodes: NodeCatalogEntry[];
}

export interface NodeCatalogResponse {
  categories: NodeCatalogCategory[];
  handle_types: HandleTypeInfo[];
}

export interface ReactFlowGraph {
  nodes: ReactFlowNode[];
  edges: ReactFlowEdge[];
  viewport?: { x: number; y: number; zoom: number } | null;
}

export interface ReactFlowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: {
    config: Record<string, unknown>;
    label?: string;
    [key: string]: unknown;
  };
  width?: number;
  height?: number;
}

export interface ReactFlowEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
  animated?: boolean;
  label?: string;
}

export interface Pipeline {
  id: string;
  organization_id: string;
  project_id: string | null;
  name: string;
  description: string | null;
  trigger_type: PipelineTriggerType;
  trigger_config: Record<string, unknown> | null;
  graph: ReactFlowGraph;
  status: PipelineStatus;
  node_count: number;
  last_run_at: string | null;
  last_run_status: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PipelineRun {
  id: string;
  pipeline_id: string;
  organization_id: string;
  project_id: string | null;
  status: PipelineRunStatus;
  trigger_type: string;
  trigger_data: Record<string, unknown> | null;
  total_steps: number;
  completed_steps: number;
  failed_steps: number;
  progress: number;
  triggered_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  created_at: string;
}

export interface RunDetailRead extends PipelineRun {
  steps: PipelineRunStep[];
  graph_snapshot: ReactFlowGraph;
}

export interface PipelineRunStep {
  id: string;
  run_id: string;
  node_id: string;
  node_type: string;
  node_label: string | null;
  status: PipelineRunStepStatus;
  config: Record<string, unknown> | null;
  input_data: Record<string, unknown> | null;
  output_data: Record<string, unknown> | null;
  active_output_handle: string | null;
  celery_task_id: string | null;
  waiting_for_job_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  error: string | null;
  attempt: number;
  max_retries: number;
  created_at: string;
}

export interface GraphValidationResult {
  valid: boolean;
  errors: GraphValidationIssue[];
  warnings: GraphValidationIssue[];
  execution_order: string[];
  node_count: number;
  edge_count: number;
}

export interface GraphValidationIssue {
  node_id: string;
  error_type: 'missing_input' | 'type_mismatch' | 'cycle' | 'unknown_node_type' | 'disconnected_node' | 'placeholder_node';
  message: string;
}
