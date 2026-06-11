/**
 * Feature Type Registry
 *
 * Maps feature-type strings to schema + optional live-update logic.
 * Every overlay on the map (built-in layers, uploaded datasets, external services)
 * registers here. The sidebar renders any registered type without core code changes.
 *
 * Usage:
 *   import { registerFeatureType, getFeatureConfig } from '@/features/maps/featureRegistry';
 *   registerFeatureType('powerLine', { label: 'Power Line', schema: [...], applyUpdate: ... });
 */

export interface PropertySchema {
  name: string;
  label: string;
  /** Rendering hint for the sidebar form */
  ui: 'color' | 'slider' | 'number' | 'select' | 'text' | 'textarea';
  /** If true, field is displayed but not editable */
  readOnly?: boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  unit?: string;
}

export interface FeatureTypeConfig {
  /** Human-readable name shown in the panel header */
  label: string;
  /** Lucide icon name (optional; panel defaults per layerType) */
  icon?: string;
  /** Ordered list of properties to display/edit */
  schema: PropertySchema[];
  /**
   * Apply a live property change to the Leaflet layer.
   * Typed as `unknown` to keep this module server-safe (no Leaflet import).
   * Implementations cast to L.Path / L.Marker etc. as needed.
   */
  applyUpdate?: (layer: unknown, property: string, value: unknown) => void;
}

// ── Registry storage ──────────────────────────────────────────────────────────
const _registry = new Map<string, FeatureTypeConfig>();

export function registerFeatureType(type: string, config: FeatureTypeConfig): void {
  _registry.set(type, config);
}

export function getFeatureConfig(type: string): FeatureTypeConfig | undefined {
  return _registry.get(type);
}

export function getAllFeatureTypes(): ReadonlyMap<string, FeatureTypeConfig> {
  return _registry;
}

// ── Shared helpers ────────────────────────────────────────────────────────────
function pathApplyUpdate(layer: unknown, prop: string, value: unknown): void {
  const path = layer as { setStyle?: (s: Record<string, unknown>) => void };
  if (typeof path.setStyle === 'function') {
    path.setStyle({ [prop]: value });
  }
}

const ANNOTATION_STYLE_SCHEMA: PropertySchema[] = [
  { name: 'color',       label: 'Stroke color',  ui: 'color' },
  { name: 'weight',      label: 'Line width',    ui: 'slider', min: 1, max: 10, step: 0.5, unit: 'px' },
  { name: 'fillColor',   label: 'Fill color',    ui: 'color' },
  { name: 'fillOpacity', label: 'Fill opacity',  ui: 'slider', min: 0, max: 1, step: 0.05 },
  {
    name: 'dashArray', label: 'Line style', ui: 'select',
    options: [
      { value: '',      label: 'Solid' },
      { value: '8 4',   label: 'Dashed' },
      { value: '2 4',   label: 'Dotted' },
      { value: '16 6',  label: 'Long dash' },
    ],
  },
];

// ── Built-in annotation types ─────────────────────────────────────────────────
registerFeatureType('annotation-point', {
  label: 'Point',
  icon: 'MapPin',
  schema: [
    { name: 'label',       label: 'Label',       ui: 'text',  readOnly: true },
    { name: 'latitude',    label: 'Latitude',    ui: 'text',  readOnly: true },
    { name: 'longitude',   label: 'Longitude',   ui: 'text',  readOnly: true },
    { name: 'confidence',  label: 'Confidence',  ui: 'text',  readOnly: true },
    { name: 'status',      label: 'Status',      ui: 'text',  readOnly: true },
    { name: 'source',      label: 'Source',      ui: 'text',  readOnly: true },
  ],
  applyUpdate: pathApplyUpdate,
});

registerFeatureType('annotation-polyline', {
  label: 'Line',
  icon: 'Minus',
  schema: [
    { name: 'label',      label: 'Label',    ui: 'text', readOnly: true },
    { name: 'length',     label: 'Length',   ui: 'text', readOnly: true },
    { name: 'vertices',   label: 'Vertices', ui: 'text', readOnly: true },
    { name: 'bearing',    label: 'Bearing',  ui: 'text', readOnly: true },
    ...ANNOTATION_STYLE_SCHEMA.filter((s) => !['fillColor', 'fillOpacity'].includes(s.name)),
  ],
  applyUpdate: pathApplyUpdate,
});

registerFeatureType('annotation-polygon', {
  label: 'Polygon',
  icon: 'Pentagon',
  schema: [
    { name: 'label',      label: 'Label',     ui: 'text', readOnly: true },
    { name: 'area',       label: 'Area',      ui: 'text', readOnly: true },
    { name: 'perimeter',  label: 'Perimeter', ui: 'text', readOnly: true },
    { name: 'vertices',   label: 'Vertices',  ui: 'text', readOnly: true },
    ...ANNOTATION_STYLE_SCHEMA,
  ],
  applyUpdate: pathApplyUpdate,
});

registerFeatureType('annotation-rectangle', {
  label: 'Rectangle',
  icon: 'RectangleHorizontal',
  schema: [
    { name: 'label',      label: 'Label',     ui: 'text', readOnly: true },
    { name: 'area',       label: 'Area',      ui: 'text', readOnly: true },
    { name: 'perimeter',  label: 'Perimeter', ui: 'text', readOnly: true },
    ...ANNOTATION_STYLE_SCHEMA,
  ],
  applyUpdate: pathApplyUpdate,
});

registerFeatureType('annotation-circle', {
  label: 'Circle',
  icon: 'Circle',
  schema: [
    { name: 'label',    label: 'Label',    ui: 'text', readOnly: true },
    { name: 'radius',   label: 'Radius',   ui: 'text', readOnly: true },
    { name: 'diameter', label: 'Diameter', ui: 'text', readOnly: true },
    { name: 'area',     label: 'Area',     ui: 'text', readOnly: true },
    { name: 'center',   label: 'Center',   ui: 'text', readOnly: true },
    ...ANNOTATION_STYLE_SCHEMA,
  ],
  applyUpdate: pathApplyUpdate,
});

// Fallback for annotations where geometry type is not yet known
registerFeatureType('annotation', {
  label: 'Annotation',
  icon: 'MapPin',
  schema: [
    { name: 'label',      label: 'Label',      ui: 'text', readOnly: true },
    { name: 'confidence', label: 'Confidence', ui: 'text', readOnly: true },
    { name: 'status',     label: 'Status',     ui: 'text', readOnly: true },
    { name: 'source',     label: 'Source',     ui: 'text', readOnly: true },
    ...ANNOTATION_STYLE_SCHEMA,
  ],
  applyUpdate: pathApplyUpdate,
});

// ── Built-in non-annotation types ─────────────────────────────────────────────
registerFeatureType('tracking', {
  label: 'Tracked Object',
  icon: 'Activity',
  schema: [
    { name: 'object_type',       label: 'Type',           ui: 'text', readOnly: true },
    { name: 'status',            label: 'Status',         ui: 'text', readOnly: true },
    { name: 'priority',          label: 'Priority',       ui: 'text', readOnly: true },
    { name: 'severity',          label: 'Severity',       ui: 'text', readOnly: true },
    { name: 'confidence_score',  label: 'Confidence',     ui: 'text', readOnly: true },
    { name: 'observation_count', label: 'Observations',   ui: 'text', readOnly: true },
    { name: 'first_observed_at', label: 'First observed', ui: 'text', readOnly: true },
    { name: 'last_observed_at',  label: 'Last observed',  ui: 'text', readOnly: true },
  ],
});

registerFeatureType('alert', {
  label: 'Alert',
  icon: 'Bell',
  schema: [
    { name: 'title',      label: 'Title',    ui: 'text',     readOnly: true },
    { name: 'alert_type', label: 'Type',     ui: 'text',     readOnly: true },
    { name: 'severity',   label: 'Severity', ui: 'text',     readOnly: true },
    { name: 'status',     label: 'Status',   ui: 'text',     readOnly: true },
    { name: 'confidence', label: 'Confidence', ui: 'text',   readOnly: true },
    { name: 'message',    label: 'Message',  ui: 'textarea', readOnly: true },
    { name: 'created_at', label: 'Created',  ui: 'text',     readOnly: true },
  ],
});

registerFeatureType('dataset', {
  label: 'Dataset Feature',
  icon: 'Tag',
  schema: [
    { name: 'name',       label: 'Name',   ui: 'text', readOnly: true },
    { name: 'item_count', label: 'Items',  ui: 'text', readOnly: true },
    { name: 'status',     label: 'Status', ui: 'text', readOnly: true },
  ],
});
