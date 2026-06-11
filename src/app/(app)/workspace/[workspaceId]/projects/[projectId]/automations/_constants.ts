/**
 * Fallback category metadata — used when the node catalog API hasn't loaded yet
 * or for categories the API doesn't provide styling for.
 * Once the catalog loads, prefer catalog-provided colors.
 */
// Color is assigned per HIGH-LEVEL GROUP, not per sub-category, so every node
// in a group shares one color: Data=blue, Model=golden, Map=green, Utilities=pink.
// Keep each category's color in sync with its group in HIGH_LEVEL_GROUPS below.
const GROUP_COLORS = {
  data:      { color: '#5b9bd5', bgColor: '#18283c' }, // blue
  model:     { color: '#d4a96a', bgColor: '#2e2418' }, // golden brown
  map:       { color: '#5fb37f', bgColor: '#16271d' }, // green
  utilities: { color: '#b85c8a', bgColor: '#2e1e2a' }, // pink (darker)
} as const;

export const CATEGORY_META: Record<string, { label: string; color: string; bgColor: string }> = {
  // ── Data (blue) ──
  data_source:   { label: 'Data Sources',    ...GROUP_COLORS.data },
  // ── Model (golden) ──
  ml_annotation: { label: 'ML / Annotation', ...GROUP_COLORS.model },
  quality:       { label: 'Quality / IoU',   ...GROUP_COLORS.model },
  iou_quality:   { label: 'Quality / IoU',   ...GROUP_COLORS.model },
  // ── Map (green) ──
  map_overlay:   { label: 'Map Overlay',     ...GROUP_COLORS.map },
  // ── Utilities (pink) ──
  trigger:         { label: 'Triggers',        ...GROUP_COLORS.utilities },
  triggers:        { label: 'Triggers',        ...GROUP_COLORS.utilities },
  analysis:        { label: 'Analysis',        ...GROUP_COLORS.utilities },
  output:          { label: 'Output',          ...GROUP_COLORS.utilities },
  data_ops:        { label: 'Data Operations', ...GROUP_COLORS.utilities },
  data_operations: { label: 'Data Operations', ...GROUP_COLORS.utilities },
  advanced:        { label: 'Advanced',        ...GROUP_COLORS.utilities },
  display:         { label: 'Display',         ...GROUP_COLORS.utilities },
};

/**
 * High-level groups shown at the top of the node catalog.
 * Each group rolls up one or more backend categories. The order of
 * `categories` here also dictates sub-section order inside the group.
 */
export interface HighLevelGroup {
  key: string;
  label: string;
  color: string;
  description: string;
  categories: string[];
}

export const HIGH_LEVEL_GROUPS: HighLevelGroup[] = [
  {
    key: 'data',
    label: 'Data',
    color: GROUP_COLORS.data.color,
    description: 'Sources for datasets, annotation sets, and STAC items',
    categories: ['data_source'],
  },
  {
    key: 'model',
    label: 'Model',
    color: GROUP_COLORS.model.color,
    description: 'ML model selection, inference, post-processing, and quality assessment',
    categories: ['ml_annotation', 'iou_quality'],
  },
  {
    key: 'map',
    label: 'Map',
    color: GROUP_COLORS.map.color,
    description: 'Map overlays, visualization, and exports',
    categories: ['map_overlay'],
  },
  {
    key: 'utilities',
    label: 'Utilities',
    color: GROUP_COLORS.utilities.color,
    description: 'Data operations, analysis, triggers, notifications, advanced workflows, and display widgets',
    categories: ['data_operations', 'analysis', 'triggers', 'output', 'advanced', 'display'],
  },
];

/** Map backend category key → high-level group key (for category lookup). */
export const CATEGORY_TO_GROUP: Record<string, string> = HIGH_LEVEL_GROUPS.reduce(
  (acc, group) => {
    for (const cat of group.categories) acc[cat] = group.key;
    return acc;
  },
  {} as Record<string, string>,
);
