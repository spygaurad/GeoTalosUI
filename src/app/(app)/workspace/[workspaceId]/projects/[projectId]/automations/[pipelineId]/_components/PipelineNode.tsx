'use client';

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Handle, Position, type NodeProps, useReactFlow } from '@xyflow/react';
import { useQuery } from '@tanstack/react-query';
import {
  Zap,
  Hand,
  Database,
  Filter,
  Tags,
  Search,
  Bot,
  Play,
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
  Shapes,
  Grid2x2,
  Ruler,
  type LucideIcon,
} from 'lucide-react';
import { CATEGORY_META } from '../../_constants';
import { usePipelineContext } from './PipelineContext';
import { isDisplayNode } from './frontend-display-nodes';
import { DisplayNodeContent, ReportViewer } from './DisplayNodeContent';
import { datasetsApi } from '@/lib/api/datasets';
import { mapsApi } from '@/lib/api/maps';
import { modelsApi } from '@/lib/api/models';
import { annotationSetsApi } from '@/lib/api/annotation-sets';
import { annotationSchemasApi } from '@/lib/api/annotation-schemas';
import { stylesApi } from '@/lib/api/annotation-styles';
import { mapAoisApi } from '@/lib/api/map-aois';
import { qk } from '@/lib/query-keys';
import type { HandleDef } from '@/types/api';

// ── Icon mapping — keys match backend node type strings (#3, #9) ─────────────

const NODE_ICONS: Record<string, LucideIcon> = {
  // Triggers
  trigger: Hand,
  dataset_ingested_trigger: Zap,
  annotation_created_trigger: PenTool,
  threshold_breach_trigger: AlertTriangle,
  // Data sources
  select_data_source: Database,
  select_annotation_set: Tags,
  stac_search: Search,
  search_map_aoi_resources: Search,
  load_saved_map_aoi_timeline: Clock,
  // ML / Annotation
  run_inference: Play,
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
  aggregate_model_runs: Combine,
  multi_model_iou_comparison: GitCompare,
  before_after_comparison: ArrowRightLeft,
  generate_report: FileText,
  export_annotations: Download,
  export_dataset_items: Download,
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
  aoi_filter: Filter,
  review_queue: ListChecks,
  status_transition: ToggleLeft,
  vectorize_raster_mask: Shapes,
  rasterize_annotation_set: Grid2x2,
  // Quality / IoU
  raster_mask_metrics: Ruler,
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
  map_selection: '#3B82F6',
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

type PickerItem = { id: string; name: string };
type PickerResult = { data: { items?: PickerItem[] } | undefined; isLoading: boolean };

const PICKER_CONFIG: Record<string, {
  label: string;
  multi?: boolean;
  /** Name of another config field this picker depends on (e.g. dataset_items
   *  needs dataset_id selected first). Without a value the query is skipped. */
  dependsOn?: string;
  useItems: (projectId: string, dependentValue?: string) => PickerResult;
}> = {
  dataset: {
    label: 'Dataset',
    useItems: (projectId) => {
      const { data, isLoading } = useQuery({
        queryKey: qk.datasets.list({ project_id: projectId, status: 'ready' }),
        queryFn: () => datasetsApi.list({ project_id: projectId, status: 'ready' }),
        staleTime: 30_000,
      });
      return { data: data as { items?: PickerItem[] } | undefined, isLoading };
    },
  },
  dataset_items: {
    label: 'Dataset Items',
    multi: true,
    dependsOn: 'dataset_id',
    useItems: (_projectId, datasetId) => {
      const { data, isLoading } = useQuery({
        queryKey: qk.datasets.items(datasetId ?? '', { page_size: 500 }),
        queryFn: () => datasetsApi.listItems(datasetId!, { page_size: 500 }),
        enabled: !!datasetId,
        staleTime: 30_000,
      });
      // DatasetItem has filename + stac_item_id, not "name" — adapt the shape.
      const items = (data?.items ?? []).map((it) => ({
        id: it.id,
        name: it.filename || it.stac_item_id || it.id.slice(0, 8),
      }));
      return { data: { items }, isLoading };
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
      return { data: data as { items?: PickerItem[] } | undefined, isLoading };
    },
  },
  map_aoi: {
    label: 'Saved AOI',
    dependsOn: 'map_id',
    useItems: (_projectId, mapId) => {
      const { data, isLoading } = useQuery({
        queryKey: qk.mapAois.list(mapId ?? ''),
        queryFn: () => mapAoisApi.listAois(mapId!),
        enabled: !!mapId,
        staleTime: 30_000,
      });
      return { data: data as { items?: PickerItem[] } | undefined, isLoading };
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
      return { data: data as { items?: PickerItem[] } | undefined, isLoading };
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
      return { data: data as { items?: PickerItem[] } | undefined, isLoading };
    },
  },
  annotation_schema: {
    label: 'Annotation Schema',
    useItems: () => {
      const { data, isLoading } = useQuery({
        queryKey: qk.annotationSchemas.list(),
        queryFn: () => annotationSchemasApi.list(),
        staleTime: 30_000,
      });
      return { data: data as { items?: PickerItem[] } | undefined, isLoading };
    },
  },
  annotation_class: {
    label: 'Classes',
    multi: true,
    dependsOn: 'schema_id',
    useItems: (_projectId, schemaId) => {
      const { data, isLoading } = useQuery({
        queryKey: qk.annotationSchemas.classes(schemaId ?? ''),
        queryFn: () => annotationSchemasApi.getClasses(schemaId!),
        enabled: !!schemaId,
        staleTime: 30_000,
      });
      // AnnotationClass already has id + name — shape matches PickerItem.
      return { data: data as { items?: PickerItem[] } | undefined, isLoading };
    },
  },
  style: {
    label: 'Style',
    useItems: () => {
      const { data, isLoading } = useQuery({
        queryKey: ['styles'],
        queryFn: () => stylesApi.list(),
        staleTime: 30_000,
      });
      return { data: data as { items?: PickerItem[] } | undefined, isLoading };
    },
  },
};

function EntityPicker({
  pickerType,
  label,
  value,
  onChange,
  parentConfig,
  onMenuOpenChange,
  accent = '#7f5539',
}: {
  pickerType: string;
  label: string;
  value: unknown;
  onChange: (val: unknown) => void;
  parentConfig: Record<string, unknown>;
  onMenuOpenChange?: (open: boolean) => void;
  /** Node category color — used to tint in-node buttons/controls. */
  accent?: string;
}) {
  const { projectId } = usePipelineContext();
  const cfg = PICKER_CONFIG[pickerType];

  if (!cfg) {
    return (
      <div style={{ fontSize: '10px', color: '#6b5d4e' }}>
        <div style={{ marginBottom: '1px' }}>{label}</div>
        <input
          type="text"
          className="nodrag"
          value={(value as string) ?? ''}
          onChange={(e) => { e.stopPropagation(); onChange(e.target.value); }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          placeholder={`Enter ${pickerType} ID...`}
          style={fieldStyle}
        />
      </div>
    );
  }

  const dependentValue = cfg.dependsOn
    ? (parentConfig[cfg.dependsOn] as string | undefined)
    : undefined;
  const { data, isLoading } = cfg.useItems(projectId, dependentValue);
  const items = data?.items ?? [];

  // Block multi-select rendering until the parent dependency is set.
  if (cfg.dependsOn && !dependentValue) {
    return (
      <div style={{ fontSize: '10px', color: '#6b5d4e' }}>
        <div style={{ marginBottom: '1px' }}>{label}</div>
        <div
          style={{
            ...fieldStyle,
            color: '#9a8878',
            cursor: 'not-allowed',
            backgroundColor: '#f5ede0',
          }}
        >
          Select {cfg.dependsOn.replace(/_/g, ' ')} first
        </div>
      </div>
    );
  }

  if (cfg.multi) {
    return (
      <MultiEntityPicker
        label={label}
        items={items}
        isLoading={isLoading}
        value={value}
        onChange={onChange}
        onOpenChange={onMenuOpenChange}
        accent={accent}
      />
    );
  }

  return (
    <div style={{ fontSize: '10px', color: '#6b5d4e' }}>
      <div style={{ marginBottom: '1px' }}>{label}</div>
      <div className="relative">
        <select
          className="nodrag"
          value={(value as string) ?? ''}
          onChange={(e) => { e.stopPropagation(); onChange(e.target.value || null); }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
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

// ── Multi-select picker (id list of named items) ─────────────────────────────

function MultiEntityPicker({
  label,
  items,
  isLoading,
  value,
  onChange,
  onOpenChange,
  accent = '#7f5539',
}: {
  label: string;
  items: PickerItem[];
  isLoading: boolean;
  value: unknown;
  onChange: (val: unknown) => void;
  /** Node category color — used to tint in-node buttons/controls. */
  accent?: string;
  /** Lets the parent node lift its ReactFlow z-index while the menu is open so
   *  the expanded list paints above neighbouring nodes. */
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = Array.isArray(value) ? (value as string[]) : [];
  const selectedSet = new Set(selected);
  // Name lookup — using a plain object because `Map` is shadowed by the
  // Lucide icon import in this module.
  const byId: Record<string, PickerItem> = {};
  for (const it of items) byId[it.id] = it;
  const summary = selected.length === 0
    ? `All ${label.toLowerCase()}`
    : selected.length === 1
      ? byId[selected[0]]?.name ?? '1 item'
      : `${selected.length} items selected`;

  const setOpenState = useCallback((next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  }, [onOpenChange]);

  const toggle = (id: string) => {
    const next = selectedSet.has(id)
      ? selected.filter((s) => s !== id)
      : [...selected, id];
    onChange(next);
  };

  // Close on outside click. The menu renders inline (in normal flow) rather
  // than in a portal/fixed overlay: a portaled fixed element forced Chrome to
  // re-rasterise ReactFlow's scaled viewport layer, leaving the node blurry
  // until the next pane transform (a drag). Inline content — like the native
  // <select> used for "Select Model" — stays crisp.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpenState(false);
    };
    const id = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open, setOpenState]);

  // Restore the parent node's z-index if this picker unmounts while open.
  useEffect(() => () => onOpenChange?.(false), [onOpenChange]);

  return (
    <div ref={rootRef} style={{ fontSize: '11px', color: '#6b5d4e', position: 'relative' }}>
      <div style={{ marginBottom: '1px' }}>{label}</div>
      <button
        type="button"
        className="nodrag"
        onClick={(e) => { e.stopPropagation(); setOpenState(!open); }}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          ...fieldStyle,
          textAlign: 'left',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '4px',
          color: selected.length > 0 ? '#2e3428' : '#9a8878',
        }}
      >
        <span className="truncate">{summary}</span>
        {isLoading
          ? <Loader2 className="w-2.5 h-2.5 animate-spin shrink-0" style={{ color: '#9a8878' }} />
          : <ChevronDown className="w-2.5 h-2.5 shrink-0" style={{ color: '#9a8878' }} />}
      </button>
      {open && (
        <div
          className="nodrag nowheel"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          style={{
            marginTop: '3px',
            border: '1px solid #d4c0a8',
            backgroundColor: '#fdf8f2',
            borderRadius: '3px',
            maxHeight: '180px',
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: '2px',
            boxSizing: 'border-box',
          }}
        >
          {items.length === 0 ? (
            <div style={{ padding: '5px 6px', fontSize: '12px', color: '#9a8878' }}>
              {isLoading ? 'Loading…' : 'No items'}
            </div>
          ) : (
            <>
              {selected.length > 0 && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onChange([]); }}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '4px 6px',
                    color: accent,
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '12px',
                    borderBottom: '1px solid #ede0d4',
                    marginBottom: '2px',
                  }}
                >
                  Clear (use whole dataset)
                </button>
              )}
              {items.map((item) => {
                const checked = selectedSet.has(item.id);
                return (
                  <label
                    key={item.id}
                    className="flex items-center"
                    onMouseDown={(e) => e.stopPropagation()}
                    style={{
                      padding: '5px 4px',
                      cursor: 'pointer',
                      borderRadius: '2px',
                      backgroundColor: checked ? '#f0e8d4' : 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      boxSizing: 'border-box',
                      gap: '6px',
                    }}
                  >
                    <input
                      type="checkbox"
                      className="nodrag"
                      checked={checked}
                      onChange={(e) => { e.stopPropagation(); toggle(item.id); }}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      style={{ width: '13px', height: '13px', flexShrink: 0 }}
                    />
                    <span
                      className="truncate"
                      title={item.name}
                      style={{
                        fontSize: '12px',
                        lineHeight: '1.4',
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      {item.name}
                    </span>
                  </label>
                );
              })}
            </>
          )}
        </div>
      )}
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

// ── Model prompt override (run_inference node) ───────────────────────────────
// Prompted models (adapter declares `prompt_key_map.text_prompt`, e.g. SAM3)
// can't infer a label from the image like YOLO — the user explicitly picks an
// output class from the model's bound schema and types a comma-separated text
// prompt. Both are written to the node config as `output_class_id` +
// `prompt_payload.text_prompt` — the SAME keys the AOI inference job sends
// (see AoiInferencePanel + map-aois.createInferenceJob) — so the run_inference
// executor forwards them verbatim (force_class_id + per-patch prompt).
//
// YOLO and other non-prompted models render nothing here (labels are intrinsic).
function Sam3PromptFields({
  modelId,
  config,
  onConfigChange,
}: {
  modelId: string | undefined;
  config: Record<string, unknown>;
  onConfigChange: (key: string, value: unknown) => void;
}) {
  // Resolve the selected model to detect prompt support + its bound schema.
  // Reuses the model picker's cached list query — no extra request.
  const { data: modelsResp } = useQuery({
    queryKey: qk.models.list(),
    queryFn: () => modelsApi.list(),
    staleTime: 30_000,
  });
  const model = modelsResp?.items?.find((m) => m.id === modelId);

  const adapterCfg = (model?.output_config?.adapter_config ?? {}) as Record<string, unknown>;
  const promptKeyMap = (adapterCfg.prompt_key_map ?? {}) as Record<string, unknown>;
  const supportsTextPrompt = typeof promptKeyMap.text_prompt === 'string';
  const schemaId = model?.annotation_schema_id ?? null;

  const { data: classesResp, isLoading } = useQuery({
    queryKey: ['pipeline-node', 'schema-classes', schemaId],
    queryFn: () => annotationSchemasApi.getClasses(schemaId as string),
    enabled: supportsTextPrompt && !!schemaId,
    staleTime: 30_000,
  });
  const classes = classesResp?.items ?? [];

  // When the chosen model can't take prompts (YOLO) or none is selected, drop
  // any stale prompt/class config so it isn't sent for the wrong model. Gated
  // on the model list having resolved (and the model being found when an id is
  // set) so we never wipe a valid saved value while the query is still loading.
  const modelResolved = !!modelsResp && (!modelId || !!model);
  useEffect(() => {
    if (!modelResolved || (modelId && supportsTextPrompt)) return;
    if (config.output_class_id !== undefined) onConfigChange('output_class_id', undefined);
    if (config.prompt_payload !== undefined) onConfigChange('prompt_payload', undefined);
  }, [
    modelResolved, modelId, supportsTextPrompt,
    config.output_class_id, config.prompt_payload, onConfigChange,
  ]);

  // Local raw text for the prompt field. We must NOT re-derive the input value
  // from the parsed list on every keystroke: splitting/trimming mid-type eats
  // spaces and trailing commas as you type them. Keep the raw string locally,
  // write the parsed list to config, and only re-sync from config when it
  // changes externally (e.g. loading a saved pipeline / switching model).
  const promptList =
    (config.prompt_payload as { text_prompt?: string[] } | undefined)?.text_prompt ?? [];
  const canonicalPrompt = promptList.join(', ');
  const [promptText, setPromptText] = useState(canonicalPrompt);
  useEffect(() => {
    const parsedLocal = promptText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .join(', ');
    if (canonicalPrompt !== parsedLocal) setPromptText(canonicalPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canonicalPrompt]);

  // Only prompted models get the override UI.
  if (!modelId || !supportsTextPrompt) return null;

  const outputClassId = (config.output_class_id as string | undefined) ?? '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      <div style={{ height: `${SEPARATOR_H}px`, display: 'flex', alignItems: 'center' }}>
        <div style={{ width: '100%', borderTop: '1px solid #ede0d4' }} />
      </div>

      {/* Output class — drives the forced label for every prediction. */}
      <div style={{ fontSize: '10px', color: '#6b5d4e' }}>
        <div style={{ marginBottom: '1px' }}>Output class</div>
        {schemaId == null ? (
          <div style={{ ...fieldStyle, color: '#9a8878' }}>No schema bound to model</div>
        ) : (
          <div className="relative">
            <select
              className="nodrag"
              value={outputClassId}
              onChange={(e) => {
                e.stopPropagation();
                onConfigChange('output_class_id', e.target.value || null);
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              style={{ ...fieldStyle, appearance: 'none', paddingRight: '18px', cursor: 'pointer' }}
            >
              <option value="">{isLoading ? 'Loading…' : '— pick a class —'}</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <div
              className="absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: '#9a8878' }}
            >
              <ChevronDown className="w-2.5 h-2.5" />
            </div>
          </div>
        )}
      </div>

      {/* Text prompt — comma-separated phrases forwarded to the model. */}
      <div style={{ fontSize: '10px', color: '#6b5d4e' }}>
        <div style={{ marginBottom: '1px' }}>Prompt</div>
        <input
          type="text"
          className="nodrag"
          value={promptText}
          onChange={(e) => {
            e.stopPropagation();
            setPromptText(e.target.value);
            const list = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
            onConfigChange('prompt_payload', { text_prompt: list });
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          placeholder="e.g. mining, bulldozer"
          style={fieldStyle}
        />
      </div>
    </div>
  );
}

// ── Inline config field ─────────────────────────────────────────────────────

function InlineField({
  fieldKey,
  schema,
  value,
  onChange,
  parentConfig,
  onMenuOpenChange,
  accent = '#7f5539',
}: {
  fieldKey: string;
  schema: Record<string, unknown>;
  value: unknown;
  onChange: (val: unknown) => void;
  parentConfig: Record<string, unknown>;
  onMenuOpenChange?: (open: boolean) => void;
  /** Node category color — used to tint in-node buttons/controls. */
  accent?: string;
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
        parentConfig={parentConfig}
        onMenuOpenChange={onMenuOpenChange}
        accent={accent}
      />
    );
  }

  if (type === 'boolean') {
    return (
      <label
        className="nodrag flex items-center justify-between gap-1"
        style={{ fontSize: '10px', color: '#6b5d4e', height: '20px' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <span>{label}</span>
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => { e.stopPropagation(); onChange(e.target.checked); }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className="nodrag"
          style={{ width: '12px', height: '12px', accentColor: accent }}
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
            className="nodrag"
            value={(value as string) ?? (schema.default as string) ?? ''}
            onChange={(e) => { e.stopPropagation(); onChange(e.target.value); }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              ...fieldStyle,
              appearance: 'none',
              paddingRight: '18px',
              cursor: 'pointer',
            }}
          >
            {enumOptions.map((opt, i) => {
              const labels = schema['x-enum-labels'] as string[] | undefined;
              return (
                <option key={opt} value={opt}>{labels?.[i] ?? opt}</option>
              );
            })}
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
          className="nodrag"
          value={(value as number) ?? (schema.default as number) ?? ''}
          onChange={(e) => {
            e.stopPropagation();
            const parsed = (type === 'integer' || type === 'int') ? parseInt(e.target.value) : parseFloat(e.target.value);
            onChange(isNaN(parsed) ? '' : parsed);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
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
                  className="nodrag"
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
                    border: `1px solid ${isSelected ? accent : '#d4c0a8'}`,
                    backgroundColor: isSelected ? accent : '#fdf8f2',
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
          className="nodrag"
          value={Array.isArray(value) ? (value as string[]).join(', ') : (value as string) ?? ''}
          onChange={(e) => {
            e.stopPropagation();
            onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean));
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          placeholder="comma-separated values"
          style={fieldStyle}
        />
      </div>
    );
  }

  // string with format: date-time → native datetime picker
  if (schema.format === 'date-time') {
    return (
      <div style={{ fontSize: '10px', color: '#6b5d4e' }}>
        <div style={{ marginBottom: '1px' }}>{label}</div>
        <input
          type="datetime-local"
          className="nodrag"
          value={(value as string) ?? ''}
          onChange={(e) => { e.stopPropagation(); onChange(e.target.value); }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
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
        className="nodrag"
        value={(value as string) ?? ''}
        onChange={(e) => { e.stopPropagation(); onChange(e.target.value); }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
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

  // Lift this node above its neighbours while an inline dropdown is open so the
  // expanded list isn't painted under adjacent nodes. We toggle the z-index on
  // ReactFlow's own node wrapper via the DOM rather than through `setNodes` —
  // mutating the nodes array mid-interaction desyncs ReactFlow's drag handling
  // and leaves nodes "stuck" to the cursor.
  const nodeRootRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  useLayoutEffect(() => {
    const wrapper = nodeRootRef.current?.closest('.react-flow__node') as HTMLElement | null;
    if (!wrapper) return;
    // Reapplied after every render so a config re-render (which resets the
    // wrapper's inline z-index) doesn't drop the open menu behind neighbours.
    wrapper.style.zIndex = menuOpen ? '1000' : '';
  });

  const configSchema = config_schema ?? {};
  const properties = (configSchema.properties ?? configSchema) as Record<string, Record<string, unknown>>;
  // `output_class_id` + `prompt_payload` are declared on the run_inference
  // backend schema, but the raw generic inputs are unusable (a bare UUID text
  // box and an object field with no editor). run_inference renders them via the
  // rich `Sam3PromptFields` widget instead (driven by the selected model's
  // adapter), so hide the raw keys from the generic loop.
  const hidePromptKeys = nodeType === 'run_inference';
  // `x-visible-when: { field: value }` hides a field until a sibling field holds
  // the given value (e.g. the trigger node only shows the cron box when
  // mode === 'recurring'). Defaults are applied so a field whose controller is
  // still unset behaves as its default.
  const isVisible = (v: Record<string, unknown>) => {
    const cond = v['x-visible-when'] as Record<string, unknown> | undefined;
    if (!cond) return true;
    return Object.entries(cond).every(([depKey, want]) => {
      const current =
        config[depKey] ?? (properties[depKey] as Record<string, unknown> | undefined)?.default;
      return current === want;
    });
  };
  const configEntries = Object.entries(properties).filter(
    ([k, v]) =>
      typeof v === 'object' && v !== null && 'type' in v &&
      !(hidePromptKeys && (k === 'output_class_id' || k === 'prompt_payload')) &&
      isVisible(v as Record<string, unknown>),
  );
  const isPatchSelector = nodeType === 'patch_selector';
  const isReport = nodeType === 'generate_report';
  const isRunInference = nodeType === 'run_inference';
  const isPlaceholder = status === 'placeholder';

  // The model picker's config key (backend usually names it `model_id`). Derive
  // it from the schema's x-picker so the SAM3 prompt fields read the chosen
  // model regardless of the exact field name.
  const modelFieldKey =
    configEntries.find(
      ([, v]) => (v as Record<string, unknown>)['x-picker'] === 'model',
    )?.[0] ?? 'model_id';
  const selectedModelId = config[modelFieldKey] as string | undefined;

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
      ref={nodeRootRef}
      className="relative"
      style={{
        width: `${isReport ? 340 : NODE_WIDTH}px`,
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
                      parentConfig={config}
                      onMenuOpenChange={setMenuOpen}
                      accent={cat.color}
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
                      parentConfig={config}
                      onMenuOpenChange={setMenuOpen}
                      accent={cat.color}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* ── 3. Model prompt fields (run_inference, prompted models only) ──
                  Driven by the selected model's adapter; renders its own leading
                  separator and nothing for YOLO-style models, so no dangling
                  divider appears. */}
            {isRunInference && (
              <Sam3PromptFields
                modelId={selectedModelId}
                config={config}
                onConfigChange={onConfigChange}
              />
            )}

            {/* ── 4. Report viewer (generate_report) ── */}
            {isReport && (
              <>
                {configEntries.length > 0 && (
                  <div style={{ height: `${SEPARATOR_H}px`, display: 'flex', alignItems: 'center' }}>
                    <div style={{ width: '100%', borderTop: '1px solid #ede0d4' }} />
                  </div>
                )}
                <ReportViewer nodeId={id} accent={cat.color} />
              </>
            )}

            {/* ── 5. Patch preview ── */}
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
