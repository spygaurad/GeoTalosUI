/**
 * Frontend-only display nodes.
 *
 * These nodes live entirely on the client — they fetch data via existing
 * API hooks and render rich preview cards on the canvas.  They are
 * stripped from the graph before save/run so the backend never sees them.
 */
import type { NodeCatalogEntry, NodeCatalogCategory } from '@/types/api';

export const FRONTEND_NODE_CATEGORY = 'display';

/** All display-node type strings — used to filter them out of backend payloads */
export const DISPLAY_NODE_TYPES = new Set([
  'view_datasets',
  'view_map_layers',
  'view_annotation_sets',
  'view_models',
  'view_stats',
  'view_json',
]);

export function isDisplayNode(nodeType: string): boolean {
  return DISPLAY_NODE_TYPES.has(nodeType);
}

const DISPLAY_NODES: NodeCatalogEntry[] = [
  {
    type: 'view_datasets',
    category: FRONTEND_NODE_CATEGORY,
    label: 'Dataset Viewer',
    description: 'Lists all project datasets with status, type, and metadata in a live card.',
    icon: 'view_datasets',
    inputs: [],
    outputs: [],
    config_schema: {
      properties: {
        status_filter: {
          type: 'string',
          title: 'Status filter',
          enum: ['all', 'ready', 'ingesting', 'pending', 'failed'],
          default: 'all',
        },
      },
    },
    status: 'implemented',
    frontend_preview: true,
  },
  {
    type: 'view_map_layers',
    category: FRONTEND_NODE_CATEGORY,
    label: 'Map Layers Viewer',
    description: 'Shows all layers on a project map — name, source type, visibility, and opacity.',
    icon: 'view_map_layers',
    inputs: [],
    outputs: [],
    config_schema: {
      properties: {
        map_id: {
          type: 'string',
          title: 'Map',
          'x-picker': 'map',
        },
      },
    },
    status: 'implemented',
    frontend_preview: true,
  },
  {
    type: 'view_annotation_sets',
    category: FRONTEND_NODE_CATEGORY,
    label: 'Annotation Sets Viewer',
    description: 'Lists annotation sets for this project with counts and schema info.',
    icon: 'view_annotation_sets',
    inputs: [],
    outputs: [],
    config_schema: {},
    status: 'implemented',
    frontend_preview: true,
  },
  {
    type: 'view_models',
    category: FRONTEND_NODE_CATEGORY,
    label: 'Models Viewer',
    description: 'Shows available ML models with type, version, and artifact info.',
    icon: 'view_models',
    inputs: [],
    outputs: [],
    config_schema: {
      properties: {
        type_filter: {
          type: 'string',
          title: 'Type filter',
          enum: ['all', 'detection', 'segmentation', 'classification'],
          default: 'all',
        },
      },
    },
    status: 'implemented',
    frontend_preview: true,
  },
  {
    type: 'view_stats',
    category: FRONTEND_NODE_CATEGORY,
    label: 'Stats Viewer',
    description: 'Displays numeric metrics or stats from an upstream node output as key-value cards.',
    icon: 'view_stats',
    inputs: [
      { handle: 'data_in', type: 'any', label: 'Data', required: false },
    ],
    outputs: [],
    config_schema: {},
    status: 'implemented',
    frontend_preview: true,
  },
  {
    type: 'view_json',
    category: FRONTEND_NODE_CATEGORY,
    label: 'JSON Inspector',
    description: 'Raw JSON viewer — displays any upstream node output for debugging.',
    icon: 'view_json',
    inputs: [
      { handle: 'data_in', type: 'any', label: 'Data', required: false },
    ],
    outputs: [],
    config_schema: {},
    status: 'implemented',
    frontend_preview: true,
  },
];

export const DISPLAY_CATEGORY: NodeCatalogCategory = {
  name: FRONTEND_NODE_CATEGORY,
  label: 'Display',
  icon: 'monitor',
  nodes: DISPLAY_NODES,
};
