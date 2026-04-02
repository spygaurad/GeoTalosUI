/**
 * Fallback category metadata — used when the node catalog API hasn't loaded yet
 * or for categories the API doesn't provide styling for.
 * Once the catalog loads, prefer catalog-provided colors.
 */
export const CATEGORY_META: Record<string, { label: string; color: string; bgColor: string }> = {
  trigger:       { label: 'Triggers',        color: '#c4985c', bgColor: '#3a2c1e' },
  data_source:   { label: 'Data Sources',    color: '#a8c4a0', bgColor: '#1e2e28' },
  ml_annotation: { label: 'ML / Annotation', color: '#d4b896', bgColor: '#2e2418' },
  analysis:      { label: 'Analysis',        color: '#8ab4d4', bgColor: '#1e2838' },
  quality:       { label: 'Quality / IoU',   color: '#c49ac4', bgColor: '#2e1e2e' },
  output:        { label: 'Output',          color: '#7fb07f', bgColor: '#1e2e1e' },
  data_ops:      { label: 'Data Operations', color: '#b0a090', bgColor: '#28241c' },
  // Backend categories may use different keys
  iou_quality:      { label: 'Quality / IoU',   color: '#c49ac4', bgColor: '#2e1e2e' },
  map_overlay:      { label: 'Map Overlay',      color: '#7fb07f', bgColor: '#1e2e1e' },
  data_operations:  { label: 'Data Operations',  color: '#b0a090', bgColor: '#28241c' },
  triggers:         { label: 'Triggers',          color: '#c4985c', bgColor: '#3a2c1e' },
  advanced:         { label: 'Advanced',          color: '#9a8878', bgColor: '#2e2e2e' },
  display:          { label: 'Display',           color: '#6cb4ee', bgColor: '#1a2636' },
};
