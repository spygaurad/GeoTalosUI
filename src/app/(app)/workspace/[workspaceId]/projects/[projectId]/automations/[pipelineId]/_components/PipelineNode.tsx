'use client';

import { memo, useCallback, useState } from 'react';
import { Handle, Position, type NodeProps, useReactFlow } from '@xyflow/react';
import { useQuery } from '@tanstack/react-query';
import {
  Zap,
  Calendar,
  Hand,
  Database,
  Filter,
  Tags,
  Search,
  Bot,
  Play,
  Wand2,
  PenTool,
  GitCompare,
  BarChart3,
  Calculator,
  Target,
  Shield,
  Grid3X3,
  Map,
  Download,
  FileText,
  Mail,
  Webhook,
  Merge,
  Image,
  Loader2,
  ChevronDown,
  Layers,
  Eye,
  Bell,
  LineChart,
  AlertTriangle,
  Radar,
  Combine,
  Cloud,
  Clock,
  CheckSquare,
  Brain,
  Users,
  Award,
  ArrowRightLeft,
  ListChecks,
  ToggleLeft,
  Monitor,
  Code2,
  type LucideIcon,
} from 'lucide-react';
import { CATEGORY_META } from '../../_constants';
import { usePipelineContext } from './PipelineContext';
import { isDisplayNode } from './frontend-display-nodes';
import { DisplayNodeContent } from './DisplayNodeContent';
import { datasetsApi } from '@/lib/api/datasets';
import { mapsApi } from '@/lib/api/maps';
import { modelsApi } from '@/lib/api/models';
import { annotationSetsApi } from '@/lib/api/annotation-sets';
import { qk } from '@/lib/query-keys';
import type { HandleDef } from '@/types/api';

// ── Icon mapping — keys match backend node type strings (#3, #9) ─────────────

const NODE_ICONS: Record<string, LucideIcon> = {
  // Triggers
  manual_trigger: Hand,
  schedule_trigger: Calendar,
  dataset_ingested_trigger: Zap,
  annotation_created_trigger: PenTool,
  threshold_breach_trigger: AlertTriangle,
  // Data sources
  select_dataset: Database,
  select_dataset_items: Filter,
  select_annotation_set: Tags,
  stac_search: Search,
  select_model: Bot,
  // ML / Annotation
  run_inference: Play,
  post_processing: Wand2,
  create_annotation_set: PenTool,
  cascading_models: Brain,
  active_learning_selector: Target,
  // Analysis
  change_detection: GitCompare,
  band_math: BarChart3,
  zonal_statistics: Calculator,
  timeseries_analysis: LineChart,
  anomaly_detection: Radar,
  object_state_tracking: Eye,
  // Quality
  ground_truth_comparison: Target,
  iou_threshold_gate: Shield,
  confusion_matrix: Grid3X3,
  inter_annotator_agreement: Users,
  consensus_builder: CheckSquare,
  annotator_scoring: Award,
  // Output
  overlay_on_map: Map,
  overlay_dataset_on_map: Layers,
  before_after_comparison: ArrowRightLeft,
  export_annotations: Download,
  export_dataset_items: Download,
  generate_report: FileText,
  send_email: Mail,
  send_webhook: Webhook,
  in_app_notification: Bell,
  // Data operations
  filter_annotations: Filter,
  merge_annotation_sets: Merge,
  patch_selector: Image,
  area_calculation: Calculator,
  duplicate_detection: Target,
  spatial_rule_checker: Shield,
  style_assignment: PenTool,
  aoi_filter: Filter,
  review_queue: ListChecks,
  status_transition: ToggleLeft,
  // Advanced
  multi_sensor_fusion: Combine,
  cloud_masking: Cloud,
  temporal_compositing: Clock,
  compliance_check: CheckSquare,
  self_improving_alert: Brain,
  domain_adaptation: Brain,
  hypothesis_test: BarChart3,
  // Display (frontend-only)
  view_datasets: Database,
  view_map_layers: Layers,
  view_annotation_sets: Tags,
  view_models: Bot,
  view_stats: BarChart3,
  view_json: Code2,
};

// ── Handle type colors ────────────────────────────────────────────────────────

const HANDLE_COLORS: Record<string, string> = {
  trigger_data: '#c4985c',
  dataset: '#a8c4a0',
  dataset_items: '#7fb07f',
  annotation_set: '#d4b896',
  annotations: '#d4b896',
  model: '#8ab4d4',
  raw_predictions: '#d4a08a',
  processed_predictions: '#c49a7a',
  raster_result: '#8ab4d4',
  matched_pairs: '#c49ac4',
  metrics_report: '#c49ac4',
  quality_metrics: '#c49ac4',
  stats_report: '#b0a0c4',
  map_layer: '#7fb07f',
  download_url: '#b0a090',
  tracked_objects: '#06B6D4',
  string: '#6B7280',
  any: '#9a8878',
  display: '#6cb4ee',
};

function getHandleColor(type: string): string {
  return HANDLE_COLORS[type] ?? '#9a8878';
}

// ── Node data type ────────────────────────────────────────────────────────────

export interface PipelineNodeData {
  nodeType: string;
  label: string;
  category: string;
  description: string;
  inputs: HandleDef[];
  outputs: HandleDef[];
  config: Record<string, unknown>;
  config_schema?: Record<string, unknown>;
  status?: 'implemented' | 'placeholder';
  icon?: string;
  patchPreviewUrl?: string;
  [key: string]: unknown;
}

// ── Entity Picker (x-picker dropdowns) ────────────────────────────────────────

const PICKER_CONFIG: Record<string, {
  label: string;
  useItems: (projectId: string) => { data: { items?: Array<{ id: string; name: string }> } | undefined; isLoading: boolean };
}> = {
  dataset: {
    label: 'Dataset',
    useItems: (projectId) => {
      const { data, isLoading } = useQuery({
        queryKey: qk.datasets.list({ project_id: projectId, status: 'ready' }),
        queryFn: () => datasetsApi.list({ project_id: projectId, status: 'ready' }),
        staleTime: 30_000,
      });
      return { data: data as { items?: Array<{ id: string; name: string }> } | undefined, isLoading };
    },
  },
  map: {
    label: 'Map',
    useItems: (projectId) => {
      const { data, isLoading } = useQuery({
        queryKey: qk.maps.list(projectId),
        queryFn: () => mapsApi.list(projectId),
        staleTime: 30_000,
      });
      return { data: data as { items?: Array<{ id: string; name: string }> } | undefined, isLoading };
    },
  },
  model: {
    label: 'Model',
    useItems: () => {
      const { data, isLoading } = useQuery({
        queryKey: qk.models.list(),
        queryFn: () => modelsApi.list(),
        staleTime: 30_000,
      });
      return { data: data as { items?: Array<{ id: string; name: string }> } | undefined, isLoading };
    },
  },
  annotation_set: {
    label: 'Annotation Set',
    useItems: (projectId) => {
      const { data, isLoading } = useQuery({
        queryKey: qk.annotationSets.listByProject(projectId),
        queryFn: () => annotationSetsApi.listByProject(projectId),
        staleTime: 30_000,
      });
      return { data: data as { items?: Array<{ id: string; name: string }> } | undefined, isLoading };
    },
  },
};

function EntityPicker({
  pickerType,
  label,
  value,
  onChange,
}: {
  pickerType: string;
  label: string;
  value: unknown;
  onChange: (val: unknown) => void;
}) {
  const { projectId } = usePipelineContext();
  const cfg = PICKER_CONFIG[pickerType];

  if (!cfg) {
    return (
      <div style={{ fontSize: '10px', color: '#6b5d4e' }}>
        <div style={{ marginBottom: '1px' }}>{label}</div>
        <input
          type="text"
          value={(value as string) ?? ''}
          onChange={(e) => { e.stopPropagation(); onChange(e.target.value); }}
          onMouseDown={(e) => e.stopPropagation()}
          placeholder={`Enter ${pickerType} ID...`}
          style={fieldStyle}
        />
      </div>
    );
  }

  const { data, isLoading } = cfg.useItems(projectId);
  const items = data?.items ?? [];

  return (
    <div style={{ fontSize: '10px', color: '#6b5d4e' }}>
      <div style={{ marginBottom: '1px' }}>{label}</div>
      <div className="relative">
        <select
          value={(value as string) ?? ''}
          onChange={(e) => { e.stopPropagation(); onChange(e.target.value || null); }}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            ...fieldStyle,
            appearance: 'none',
            paddingRight: '18px',
            cursor: 'pointer',
            color: value ? '#2e3428' : '#9a8878',
          }}
        >
          <option value="">
            {isLoading ? 'Loading...' : `Select ${cfg.label.toLowerCase()}...`}
          </option>
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <div
          className="absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ color: '#9a8878' }}
        >
          {isLoading
            ? <Loader2 className="w-2.5 h-2.5 animate-spin" />
            : <ChevronDown className="w-2.5 h-2.5" />
          }
        </div>
      </div>
    </div>
  );
}

// ── Shared field styles ───────────────────────────────────────────────────────

const fieldStyle = {
  fontSize: '10px',
  border: '1px solid #d4c0a8',
  backgroundColor: '#fdf8f2',
  color: '#2e3428',
  borderRadius: '3px',
  outline: 'none',
  width: '100%',
  padding: '2px 5px',
  lineHeight: '16px',
} as const;

// ── Inline config field ─────────────────────────────────────────────────────

function InlineField({
  fieldKey,
  schema,
  value,
  onChange,
}: {
  fieldKey: string;
  schema: Record<string, unknown>;
  value: unknown;
  onChange: (val: unknown) => void;
}) {
  const label = (schema.title as string) ?? (schema.label as string) ?? fieldKey;
  const type = schema.type as string;
  const xPicker = schema['x-picker'] as string | undefined;

  // x-picker → entity dropdown
  if (xPicker) {
    return (
      <EntityPicker
        pickerType={xPicker}
        label={label}
        value={value}
        onChange={onChange}
      />
    );
  }

  if (type === 'boolean') {
    return (
      <label
        className="flex items-center justify-between gap-1"
        style={{ fontSize: '10px', color: '#6b5d4e', height: '20px' }}
      >
        <span>{label}</span>
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => { e.stopPropagation(); onChange(e.target.checked); }}
          className="accent-[#7f5539]"
          style={{ width: '12px', height: '12px' }}
        />
      </label>
    );
  }

  // JSON Schema enum → select dropdown
  const enumOptions = schema.enum as string[] | undefined;
  if (enumOptions) {
    return (
      <div style={{ fontSize: '10px', color: '#6b5d4e' }}>
        <div style={{ marginBottom: '1px' }}>{label}</div>
        <div className="relative">
          <select
            value={(value as string) ?? (schema.default as string) ?? ''}
            onChange={(e) => { e.stopPropagation(); onChange(e.target.value); }}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              ...fieldStyle,
              appearance: 'none',
              paddingRight: '18px',
              cursor: 'pointer',
            }}
          >
            {enumOptions.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
          <div
            className="absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: '#9a8878' }}
          >
            <ChevronDown className="w-2.5 h-2.5" />
          </div>
        </div>
      </div>
    );
  }

  if (type === 'number' || type === 'integer' || type === 'float' || type === 'int') {
    const min = (schema.minimum ?? schema.min) as number | undefined;
    const max = (schema.maximum ?? schema.max) as number | undefined;
    const step = (type === 'integer' || type === 'int') ? 1 : 0.01;
    return (
      <div style={{ fontSize: '10px', color: '#6b5d4e' }}>
        <div style={{ marginBottom: '1px' }}>{label}</div>
        <input
          type="number"
          value={(value as number) ?? (schema.default as number) ?? ''}
          onChange={(e) => {
            e.stopPropagation();
            const parsed = (type === 'integer' || type === 'int') ? parseInt(e.target.value) : parseFloat(e.target.value);
            onChange(isNaN(parsed) ? '' : parsed);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          min={min}
          max={max}
          step={step}
          style={fieldStyle}
        />
      </div>
    );
  }

  // type: "array" → tag-like multi-select
  if (type === 'array') {
    const items = schema.items as Record<string, unknown> | undefined;
    const itemEnum = items?.enum as string[] | undefined;

    if (itemEnum) {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div style={{ fontSize: '10px', color: '#6b5d4e' }}>
          <div style={{ marginBottom: '1px' }}>{label}</div>
          <div
            className="flex flex-wrap gap-1"
            style={{ padding: '2px 0' }}
          >
            {itemEnum.map((opt) => {
              const isSelected = selected.includes(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(isSelected
                      ? selected.filter((s) => s !== opt)
                      : [...selected, opt]
                    );
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  style={{
                    fontSize: '9px',
                    padding: '1px 5px',
                    borderRadius: '3px',
                    border: `1px solid ${isSelected ? '#7f5539' : '#d4c0a8'}`,
                    backgroundColor: isSelected ? '#7f5539' : '#fdf8f2',
                    color: isSelected ? '#f5ede0' : '#6b5d4e',
                    cursor: 'pointer',
                    lineHeight: '14px',
                  }}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    // Fallback: comma-separated text input
    return (
      <div style={{ fontSize: '10px', color: '#6b5d4e' }}>
        <div style={{ marginBottom: '1px' }}>{label}</div>
        <input
          type="text"
          value={Array.isArray(value) ? (value as string[]).join(', ') : (value as string) ?? ''}
          onChange={(e) => {
            e.stopPropagation();
            onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean));
          }}
          onMouseDown={(e) => e.stopPropagation()}
          placeholder="comma-separated values"
          style={fieldStyle}
        />
      </div>
    );
  }

  // Default: string text input
  return (
    <div style={{ fontSize: '10px', color: '#6b5d4e' }}>
      <div style={{ marginBottom: '1px' }}>{label}</div>
      <input
        type="text"
        value={(value as string) ?? ''}
        onChange={(e) => { e.stopPropagation(); onChange(e.target.value); }}
        onMouseDown={(e) => e.stopPropagation()}
        style={fieldStyle}
      />
    </div>
  );
}

// ── Header tooltip ────────────────────────────────────────────────────────────

function NodeTooltip({ description, category }: { description: string; category: string }) {
  const cat = CATEGORY_META[category];
  return (
    <div
      style={{
        position: 'absolute',
        top: '-4px',
        left: '50%',
        transform: 'translate(-50%, -100%)',
        width: '200px',
        backgroundColor: '#1e2218',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: '5px',
        padding: '6px 8px',
        zIndex: 100,
        boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
        pointerEvents: 'none',
      }}
    >
      <p style={{ fontSize: '9px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: cat?.color ?? '#c4985c', marginBottom: '3px' }}>
        {cat?.label ?? category}
      </p>
      <p style={{ fontSize: '10px', color: 'rgba(245,237,224,0.65)', lineHeight: 1.35, margin: 0 }}>
        {description}
      </p>
      <div
        style={{
          position: 'absolute',
          bottom: '-4px',
          left: '50%',
          transform: 'translateX(-50%) rotate(45deg)',
          width: '7px',
          height: '7px',
          backgroundColor: '#1e2218',
          border: '1px solid rgba(255,255,255,0.12)',
          borderLeft: 'none',
          borderTop: 'none',
        }}
      />
    </div>
  );
}

// ── Layout constants ──────────────────────────────────────────────────────────

const HEADER_H = 32;
const PORT_ROW_H = 20;
const DOT_SIZE = 6;
const CONNECTOR_SIZE = 14;
const CONFIG_ROW_H = 38;
const SEPARATOR_H = 6;
const PATCH_PREVIEW_H = 100;
const BODY_PAD = 6;
const NODE_WIDTH = 240;
const BODY_PAD_X = 10;

// ── Component ─────────────────────────────────────────────────────────────────

function PipelineNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as PipelineNodeData;
  const { nodeType, label, category, description, inputs, outputs, config, config_schema, status, icon, patchPreviewUrl } = nodeData;
  const cat = CATEGORY_META[category] ?? { label: category, color: '#9a8878', bgColor: '#2e2e2e' };
  // Use backend icon field if available, fall back to nodeType lookup (#9)
  const Icon = (icon ? NODE_ICONS[icon] : undefined) ?? NODE_ICONS[nodeType] ?? Zap;
  const { setNodes } = useReactFlow();
  const [showTooltip, setShowTooltip] = useState(false);

  const configSchema = config_schema ?? {};
  const properties = (configSchema.properties ?? configSchema) as Record<string, Record<string, unknown>>;
  const configEntries = Object.entries(properties).filter(
    ([, v]) => typeof v === 'object' && v !== null && 'type' in v,
  );
  const isPatchSelector = nodeType === 'patch_selector';
  const isPlaceholder = status === 'placeholder';

  const isDisplay = isDisplayNode(nodeType);
  const hasInputs = inputs.length > 0;
  const hasOutputs = outputs.length > 0;
  const hasConfig = configEntries.length > 0 || isPatchSelector;

  const portRowCount = Math.max(inputs.length, outputs.length);
  const hasPortSection = portRowCount > 0;

  const portSectionTop = HEADER_H + BODY_PAD;
  const inputYs = inputs.map((_, i) => portSectionTop + i * PORT_ROW_H + PORT_ROW_H / 2);
  const outputYs = outputs.map((_, i) => portSectionTop + i * PORT_ROW_H + PORT_ROW_H / 2);

  const onConfigChange = useCallback(
    (key: string, value: unknown) => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== id) return n;
          const d = n.data as unknown as PipelineNodeData;
          return {
            ...n,
            data: { ...d, config: { ...d.config, [key]: value } },
          };
        }),
      );
    },
    [id, setNodes],
  );

  const boundaryHandle = (
    side: 'left' | 'right',
    topPx: number,
    color: string,
  ): React.CSSProperties => ({
    position: 'absolute',
    top: `${topPx}px`,
    [side]: `${-CONNECTOR_SIZE / 2}px`,
    width: `${CONNECTOR_SIZE}px`,
    height: `${CONNECTOR_SIZE}px`,
    transform: 'translateY(-50%)',
    background: '#fefcf9',
    border: `1.5px solid ${color}`,
    borderRadius: '3px',
    cursor: 'crosshair',
    zIndex: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '11px',
    fontWeight: 700,
    lineHeight: 1,
    color,
  });

  return (
    <div
      className="relative"
      style={{
        width: `${NODE_WIDTH}px`,
        backgroundColor: '#fefcf9',
        border: `1.5px solid ${selected ? cat.color : '#d4c0a8'}`,
        borderRadius: '6px',
        boxShadow: selected
          ? `0 0 0 2px ${cat.color}30, 0 4px 20px rgba(46,52,40,0.12)`
          : '0 1px 4px rgba(46,52,40,0.06)',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        fontFamily: 'var(--font-sans, system-ui)',
        overflow: 'visible',
        opacity: isPlaceholder ? 0.65 : 1,
      }}
    >
      {/* ── Header with tooltip ── */}
      <div
        className="flex items-center gap-2 px-3 relative drag-handle__pipeline"
        style={{
          height: `${HEADER_H}px`,
          backgroundColor: cat.bgColor,
          borderRadius: '4.5px 4.5px 0 0',
          cursor: 'grab',
        }}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        <div
          className="shrink-0 w-5 h-5 rounded flex items-center justify-center"
          style={{ backgroundColor: `${cat.color}25` }}
        >
          <Icon className="w-3 h-3" style={{ color: cat.color }} />
        </div>
        <span
          className="truncate"
          style={{ fontSize: '11px', fontWeight: 600, color: cat.color, letterSpacing: '-0.01em' }}
        >
          {label}
        </span>
        {isPlaceholder && (
          <span
            className="ml-auto shrink-0 px-1.5 py-0.5 rounded"
            style={{ fontSize: '8px', fontWeight: 600, color: '#b0a090', backgroundColor: 'rgba(255,255,255,0.1)' }}
          >
            SOON
          </span>
        )}
        {showTooltip && <NodeTooltip description={description} category={category} />}
      </div>

      {/* ── Body ── */}
      <div style={{ padding: `${BODY_PAD}px ${BODY_PAD_X}px` }}>

        {/* ── 1. Ports section ── */}
        {hasPortSection && (
          <div style={{ display: 'flex', gap: '4px', minHeight: `${portRowCount * PORT_ROW_H}px` }}>
            <div style={{ flex: 1 }}>
              {inputs.map((input) => (
                <div
                  key={input.handle}
                  className="flex items-center gap-1.5"
                  style={{ height: `${PORT_ROW_H}px`, fontSize: '10px', color: '#6b5d4e' }}
                >
                  <div
                    className="shrink-0 rounded-full"
                    style={{
                      width: `${DOT_SIZE}px`,
                      height: `${DOT_SIZE}px`,
                      backgroundColor: getHandleColor(input.type),
                    }}
                  />
                  <span className="truncate">{input.label ?? input.handle.replace(/_/g, ' ')}</span>
                  {input.required && <span style={{ color: '#b35e4c', fontSize: '9px' }}>*</span>}
                </div>
              ))}
            </div>
            <div style={{ flex: 1 }}>
              {outputs.map((output) => (
                <div
                  key={output.handle}
                  className="flex items-center justify-end gap-1.5"
                  style={{ height: `${PORT_ROW_H}px`, fontSize: '10px', color: '#6b5d4e' }}
                >
                  <span className="truncate">{output.label ?? output.handle.replace(/_/g, ' ')}</span>
                  <div
                    className="shrink-0 rounded-full"
                    style={{
                      width: `${DOT_SIZE}px`,
                      height: `${DOT_SIZE}px`,
                      backgroundColor: getHandleColor(output.type),
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Separator after ports */}
        {hasPortSection && (hasConfig || isDisplay) && (
          <div style={{ height: `${SEPARATOR_H}px`, display: 'flex', alignItems: 'center' }}>
            <div style={{ width: '100%', borderTop: '1px solid #ede0d4' }} />
          </div>
        )}

        {/* ── Display node: live data card ── */}
        {isDisplay ? (
          <>
            {/* Config fields that display nodes might have (e.g. map picker, filters) */}
            {configEntries.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginBottom: '4px' }}>
                {configEntries.map(([key, schema]) => (
                  <div key={key} style={{ minHeight: `${CONFIG_ROW_H - 4}px` }}>
                    <InlineField
                      fieldKey={key}
                      schema={schema}
                      value={config[key]}
                      onChange={(val) => onConfigChange(key, val)}
                    />
                  </div>
                ))}
              </div>
            )}
            {/* Separator between config and live data */}
            {configEntries.length > 0 && (
              <div style={{ height: `${SEPARATOR_H}px`, display: 'flex', alignItems: 'center' }}>
                <div style={{ width: '100%', borderTop: '1px solid #ede0d4' }} />
              </div>
            )}
            {/* Frontend-only badge */}
            <div className="flex items-center gap-1 mb-1.5">
              <Monitor className="w-2.5 h-2.5" style={{ color: '#6cb4ee' }} />
              <span style={{ fontSize: '8px', fontWeight: 600, color: '#6cb4ee', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Live preview
              </span>
              <span
                className="ml-auto"
                style={{
                  fontSize: '7px',
                  fontWeight: 500,
                  color: '#9a8878',
                  backgroundColor: '#f0e8d4',
                  padding: '1px 4px',
                  borderRadius: '2px',
                }}
              >
                frontend only
              </span>
            </div>
            <DisplayNodeContent nodeType={nodeType} config={config} />
          </>
        ) : (
          <>
            {/* ── 2. Config fields (non-display nodes) ── */}
            {configEntries.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {configEntries.map(([key, schema]) => (
                  <div key={key} style={{ minHeight: `${CONFIG_ROW_H - 4}px` }}>
                    <InlineField
                      fieldKey={key}
                      schema={schema}
                      value={config[key]}
                      onChange={(val) => onConfigChange(key, val)}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* ── 3. Patch preview ── */}
            {isPatchSelector && (
              <>
                {configEntries.length > 0 && (
                  <div style={{ height: `${SEPARATOR_H}px`, display: 'flex', alignItems: 'center' }}>
                    <div style={{ width: '100%', borderTop: '1px solid #ede0d4' }} />
                  </div>
                )}
                <div
                  style={{
                    height: `${PATCH_PREVIEW_H}px`,
                    borderRadius: '4px',
                    overflow: 'hidden',
                    border: '1px solid #d4c0a8',
                    backgroundColor: '#2e3428',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {patchPreviewUrl ? (
                    <img
                      src={patchPreviewUrl}
                      alt="Patch preview"
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <div style={{ textAlign: 'center', color: '#656d4a', fontSize: '10px' }}>
                      <Image className="mx-auto mb-1" style={{ width: '20px', height: '20px', opacity: 0.5 }} />
                      <div style={{ opacity: 0.6 }}>COG patch preview</div>
                      <div style={{ opacity: 0.35, fontSize: '9px' }}>will load on run</div>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Fallback */}
            {!hasInputs && !hasOutputs && !hasConfig && (
              <p style={{ fontSize: '10px', color: '#b0a090', fontStyle: 'italic' }}>
                No configuration needed
              </p>
            )}
          </>
        )}
      </div>

      {/* ── Input handles ── */}
      {inputs.map((input, i) => {
        const color = getHandleColor(input.type);
        return (
          <Handle
            key={`in-${input.handle}`}
            type="target"
            position={Position.Left}
            id={input.handle}
            style={boundaryHandle('left', inputYs[i], color)}
          >
            <span style={{ pointerEvents: 'none', userSelect: 'none' }}>−</span>
          </Handle>
        );
      })}

      {/* ── Output handles ── */}
      {outputs.map((output, i) => {
        const color = getHandleColor(output.type);
        return (
          <Handle
            key={`out-${output.handle}`}
            type="source"
            position={Position.Right}
            id={output.handle}
            style={boundaryHandle('right', outputYs[i], color)}
          >
            <span style={{ pointerEvents: 'none', userSelect: 'none' }}>+</span>
          </Handle>
        );
      })}
    </div>
  );
}

export default memo(PipelineNodeComponent);
