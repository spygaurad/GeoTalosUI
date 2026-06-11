'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Database,
  Layers,
  Tags,
  Bot,
  BarChart3,
  Code2,
  Loader2,
  AlertCircle,
  Eye,
  EyeOff,
  Circle,
  Maximize2,
  X,
  Copy,
  Check,
  Download,
} from 'lucide-react';
import { usePipelineContext } from './PipelineContext';
import { downloadReportPdf } from './reportPdf';
import { datasetsApi } from '@/lib/api/datasets';
import { mapsApi } from '@/lib/api/maps';
import { modelsApi } from '@/lib/api/models';
import { annotationSetsApi } from '@/lib/api/annotation-sets';
import { automationApi } from '@/lib/api/automation';
import { qk } from '@/lib/query-keys';
import type { Dataset, ProjectMap, MLModel, AnnotationSet } from '@/types/api';

// ── Shared styles ──────────────────────────────────────────────────────────────

const CARD_BG = '#f8f4ed';
const CARD_BORDER = '#e8dcc8';
const TEXT_PRIMARY = '#2e3428';
const TEXT_SECONDARY = '#6b5d4e';
const TEXT_MUTED = '#9a8878';
const ACCENT = '#6cb4ee';

const cardStyle: React.CSSProperties = {
  backgroundColor: CARD_BG,
  border: `1px solid ${CARD_BORDER}`,
  borderRadius: '4px',
  padding: '6px 8px',
  marginBottom: '3px',
};

const badgeStyle = (bg: string, fg: string): React.CSSProperties => ({
  fontSize: '8px',
  fontWeight: 600,
  padding: '1px 5px',
  borderRadius: '3px',
  backgroundColor: bg,
  color: fg,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
});

// ── Loading / Error / Empty states ─────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-3" style={{ color: TEXT_MUTED }}>
      <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
      <span style={{ fontSize: '10px' }}>Loading...</span>
    </div>
  );
}

function ErrorState({ message }: { message?: string }) {
  return (
    <div className="flex items-center gap-1.5 py-2" style={{ color: '#b35e4c', fontSize: '10px' }}>
      <AlertCircle className="w-3 h-3 shrink-0" />
      <span>{message ?? 'Failed to load'}</span>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <p style={{ fontSize: '10px', color: TEXT_MUTED, fontStyle: 'italic', padding: '6px 0' }}>
      {text}
    </p>
  );
}

function SectionHeader({ icon: Icon, label, count }: { icon: React.ElementType; label: string; count?: number }) {
  return (
    <div className="flex items-center gap-1.5 mb-1.5">
      <Icon className="w-3 h-3" style={{ color: ACCENT }} />
      <span style={{ fontSize: '9px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: TEXT_SECONDARY }}>
        {label}
      </span>
      {count !== undefined && (
        <span style={{ fontSize: '9px', color: TEXT_MUTED, marginLeft: 'auto' }}>{count}</span>
      )}
    </div>
  );
}

// ── Status indicator ──────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  ready: '#5a9a5a',
  ingesting: '#c49a3c',
  pending: '#9a8878',
  failed: '#b35e4c',
};

function StatusDot({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? TEXT_MUTED;
  return <Circle className="w-2 h-2 shrink-0" style={{ color, fill: color }} />;
}

// ── Dataset Viewer ────────────────────────────────────────────────────────────

function DatasetViewer({ config }: { config: Record<string, unknown> }) {
  const { projectId } = usePipelineContext();
  const statusFilter = (config.status_filter as string) ?? 'all';

  const { data, isLoading, isError } = useQuery({
    queryKey: qk.datasets.list({
      project_id: projectId,
      ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
    }),
    queryFn: () =>
      datasetsApi.list({
        project_id: projectId,
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
      }),
    staleTime: 15_000,
  });

  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState />;

  const items = (data as unknown as { items?: Dataset[] })?.items ?? [];
  if (items.length === 0) return <EmptyState text="No datasets found" />;

  return (
    <div>
      <SectionHeader icon={Database} label="Datasets" count={items.length} />
      <div className="nowheel nodrag" style={{ maxHeight: '180px', overflowY: 'auto', overflowX: 'hidden' }}>
        {items.map((ds) => {
          const meta = ds.metadata as Record<string, unknown> | null;
          return (
            <div key={ds.id} style={cardStyle}>
              <div className="flex items-center gap-1.5 mb-0.5">
                <StatusDot status={ds.status} />
                <span
                  className="truncate"
                  style={{ fontSize: '10px', fontWeight: 600, color: TEXT_PRIMARY, maxWidth: '150px' }}
                >
                  {ds.name}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span style={badgeStyle(
                  ds.dataset_type === 'imagery' ? '#e8dcc8' : '#d4e8d4',
                  ds.dataset_type === 'imagery' ? '#7f5539' : '#3a6b3a',
                )}>
                  {ds.dataset_type}
                </span>
                <span style={{ fontSize: '9px', color: TEXT_MUTED }}>
                  {ds.status}
                </span>
                {meta?.file_count != null && (
                  <span style={{ fontSize: '9px', color: TEXT_MUTED, marginLeft: 'auto' }}>
                    {String(meta.file_count)} files
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Map Layers Viewer ──────────────────────────────────────────────────────────

function MapLayersViewer({ config }: { config: Record<string, unknown> }) {
  const mapId = config.map_id as string | undefined;

  const { data, isLoading, isError } = useQuery({
    queryKey: qk.maps.detail(mapId ?? ''),
    queryFn: () => mapsApi.get(mapId!),
    enabled: !!mapId,
    staleTime: 15_000,
  });

  if (!mapId) return <EmptyState text="Select a map to view layers" />;
  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState />;

  const map = data as ProjectMap | undefined;
  const layers = map?.layers ?? [];

  return (
    <div>
      <SectionHeader icon={Layers} label={map?.name ?? 'Map Layers'} count={layers.length} />
      {layers.length === 0 ? (
        <EmptyState text="No layers on this map" />
      ) : (
        <div className="nowheel nodrag" style={{ maxHeight: '180px', overflowY: 'auto', overflowX: 'hidden' }}>
          {layers.map((layer) => (
            <div key={layer.id} style={cardStyle}>
              <div className="flex items-center gap-1.5">
                {layer.visible ? (
                  <Eye className="w-2.5 h-2.5 shrink-0" style={{ color: '#5a9a5a' }} />
                ) : (
                  <EyeOff className="w-2.5 h-2.5 shrink-0" style={{ color: TEXT_MUTED }} />
                )}
                <span
                  className="truncate"
                  style={{ fontSize: '10px', fontWeight: 500, color: TEXT_PRIMARY, maxWidth: '140px' }}
                >
                  {layer.name}
                </span>
                <span style={{ fontSize: '9px', color: TEXT_MUTED, marginLeft: 'auto' }}>
                  z:{layer.z_index}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span style={badgeStyle('#dde8f0', '#2a5a8a')}>
                  {layer.source_type}
                </span>
                <span style={{ fontSize: '9px', color: TEXT_MUTED }}>
                  {Math.round((layer.opacity ?? 1) * 100)}% opacity
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Annotation Sets Viewer ─────────────────────────────────────────────────────

function AnnotationSetsViewer() {
  const { projectId } = usePipelineContext();

  const { data, isLoading, isError } = useQuery({
    queryKey: qk.annotationSets.listByProject(projectId),
    queryFn: () => annotationSetsApi.listByProject(projectId),
    staleTime: 15_000,
  });

  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState />;

  const items = (data as { items: AnnotationSet[] })?.items ?? [];
  if (items.length === 0) return <EmptyState text="No annotation sets" />;

  return (
    <div>
      <SectionHeader icon={Tags} label="Annotation Sets" count={items.length} />
      <div className="nowheel nodrag" style={{ maxHeight: '180px', overflowY: 'auto', overflowX: 'hidden' }}>
        {items.map((as_) => {
          const isAuto = !!as_.job_id;
          const schemaName = as_.schema?.name;
          return (
            <div key={as_.id} style={cardStyle}>
              <div className="flex items-center gap-1.5 mb-0.5">
                <span
                  className="truncate"
                  style={{ fontSize: '10px', fontWeight: 600, color: TEXT_PRIMARY, maxWidth: '150px' }}
                >
                  {as_.name}
                </span>
                {isAuto && (
                  <span style={badgeStyle('#f0e8d4', '#8a6d2a')}>auto</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {as_.annotation_count !== undefined && (
                  <span style={{ fontSize: '9px', color: TEXT_SECONDARY }}>
                    {as_.annotation_count} annotations
                  </span>
                )}
                {schemaName && (
                  <span style={{ fontSize: '9px', color: TEXT_MUTED, marginLeft: 'auto' }}>
                    {schemaName}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Models Viewer ──────────────────────────────────────────────────────────────

function ModelsViewer({ config }: { config: Record<string, unknown> }) {
  const typeFilter = (config.type_filter as string) ?? 'all';

  const filterParams = typeFilter !== 'all'
    ? { type: typeFilter as 'detection' | 'segmentation' | 'classification' }
    : undefined;

  const { data, isLoading, isError } = useQuery({
    queryKey: qk.models.list(filterParams),
    queryFn: () => modelsApi.list(filterParams),
    staleTime: 15_000,
  });

  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState />;

  const items = (data as unknown as { items?: MLModel[] })?.items ?? [];
  if (items.length === 0) return <EmptyState text="No models available" />;

  return (
    <div>
      <SectionHeader icon={Bot} label="Models" count={items.length} />
      <div className="nowheel nodrag" style={{ maxHeight: '180px', overflowY: 'auto', overflowX: 'hidden' }}>
        {items.map((model) => {
          // const colors = MODEL_TYPE_COLORS[model.type] ?? { bg: '#e8e8e8', fg: '#555' };
          const colors =  { bg: '#e8e8e8', fg: '#555' };
          return (
            <div key={model.id} style={cardStyle}>
              <div className="flex items-center gap-1.5 mb-0.5">
                <span
                  className="truncate"
                  style={{ fontSize: '10px', fontWeight: 600, color: TEXT_PRIMARY, maxWidth: '130px' }}
                >
                  {model.name}
                </span>
                <span style={{ fontSize: '9px', color: TEXT_MUTED, marginLeft: 'auto' }}>
                  v{model.version}
                </span>
              </div>
              <span style={badgeStyle(colors.bg, colors.fg)}>{model.type}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Stats Viewer ───────────────────────────────────────────────────────────────

function StatsViewer() {
  return (
    <div>
      <SectionHeader icon={BarChart3} label="Stats" />
      <div
        className="flex flex-col gap-1"
        style={{ padding: '4px 0' }}
      >
        <p style={{ fontSize: '10px', color: TEXT_MUTED, fontStyle: 'italic' }}>
          Connect an upstream node to display metrics.
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {[
            { label: 'Metric', value: '\u2014' },
            { label: 'Count', value: '\u2014' },
            { label: 'Mean', value: '\u2014' },
            { label: 'Max', value: '\u2014' },
          ].map((s) => (
            <div
              key={s.label}
              style={{
                ...cardStyle,
                textAlign: 'center',
                marginBottom: 0,
              }}
            >
              <div style={{ fontSize: '12px', fontWeight: 700, color: ACCENT }}>{s.value}</div>
              <div style={{ fontSize: '8px', color: TEXT_MUTED, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── JSON Inspector ────────────────────────────────────────────────────────────

function JsonViewer() {
  return (
    <div>
      <SectionHeader icon={Code2} label="JSON Inspector" />
      <div
        className="nowheel nodrag"
        style={{
          backgroundColor: '#1e2218',
          borderRadius: '4px',
          padding: '8px',
          fontFamily: 'monospace',
          fontSize: '9px',
          color: 'rgba(245,237,224,0.6)',
          lineHeight: 1.5,
          maxHeight: '140px',
          overflowY: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
      >
        {`{\n  "status": "waiting",\n  "hint": "Connect an upstream node\\nto inspect its output JSON"\n}`}
      </div>
    </div>
  );
}

// ── Report Viewer ─────────────────────────────────────────────────────────────
// Compact in-canvas summary for a `generate_report` backend step, plus a
// pop-out modal with 5the full breakdown and a raw-JSON tab. Pulls data from
// the most recent run.

export interface ReportSection {
  annotation_set_id?: string;
  name?: string;
  schema?: string | null;
  source_type?: string;
  model?: string | null;
  created_at?: string | null;
  missing?: boolean;
  totals?: {
    annotation_count?: number;
    total_area_sqm?: number;
    total_area_hectares?: number;
    avg_confidence?: number | null;
    confidence_buckets?: Record<string, number>;
    area_stats?: { min_sqm: number | null; max_sqm: number | null; median_sqm: number | null };
  };
  per_class?: Array<{
    class: string;
    count: number;
    area_sqm: number;
    area_hectares?: number;
    avg_confidence: number | null;
    area_stats?: { min_sqm: number | null; max_sqm: number | null; median_sqm: number | null };
    confidence_buckets?: Record<string, number>;
  }>;
  rows?: Array<{
    annotation_id: string;
    class: string;
    confidence: number | null;
    area_sqm: number;
  }>;
}

export interface ReportMetricsClass {
  class_id: string;
  class_name: string;
  gt_pixels: number;
  pred_pixels: number;
  true_positive: number;
  false_positive: number;
  false_negative: number;
  iou: number | null;
  precision: number | null;
  recall: number | null;
  f1_score: number | null;
  present_in_gt: boolean;
  present_in_prediction: boolean;
}

export interface ReportMetrics {
  type?: string;
  ground_truth?: { dataset_id?: string; name?: string };
  prediction?: { dataset_id?: string; name?: string };
  per_class?: ReportMetricsClass[];
  overall?: {
    class_count?: number;
    pixel_accuracy?: number | null;
    foreground_accuracy?: number | null;
    mean_iou?: number | null;
    evaluated_pixels?: number;
    foreground_pixels?: number;
  };
  grid?: { grid_from?: string; crs?: string | null; width?: number; height?: number };
}

export interface ReportPayload {
  title?: string;
  generated_at?: string;
  summary?: {
    annotation_set_count?: number;
    total_annotations?: number;
    total_area_sqm?: number;
    total_area_hectares?: number;
    metrics_count?: number;
  };
  sections?: ReportSection[];
  metrics?: ReportMetrics[];
}

/**
 * Pull a report payload out of a run step's `output_data`. Steps wrap it as
 * `{ report: {...} }`; some emit the report object directly. Returns null when
 * the output isn't report-shaped.
 */
export function extractReportPayload(
  output: Record<string, unknown> | null | undefined,
): ReportPayload | null {
  if (!output) return null;
  const candidate = ((output as { report?: unknown }).report ?? output) as ReportPayload;
  if (candidate && (Array.isArray(candidate.sections) || Array.isArray(candidate.metrics) || candidate.summary))
    return candidate;
  return null;
}

interface ReportViewerProps {
  nodeId: string;
  /** Node category color — tints the report node's buttons/active tabs. */
  accent?: string;
}

export function ReportViewer({ nodeId, accent = '#7f5539' }: ReportViewerProps) {
  const { pipelineId } = usePipelineContext();
  const [open, setOpen] = useState(false);

  const { data: runsPage, isLoading: runsLoading } = useQuery({
    queryKey: qk.automation.pipelineRuns(pipelineId ?? ''),
    queryFn: () => automationApi.listPipelineRuns(pipelineId!),
    enabled: !!pipelineId,
    staleTime: 5_000,
  });

  const latestRunId = runsPage?.items?.[0]?.id;

  const { data: runDetail, isLoading: detailLoading } = useQuery({
    queryKey: qk.automation.runDetail(latestRunId ?? ''),
    queryFn: () => automationApi.getRunDetail(latestRunId!),
    enabled: !!latestRunId,
    staleTime: 5_000,
  });

  if (!pipelineId) return <EmptyState text="Save the pipeline first to view reports." />;
  if (runsLoading || detailLoading) return <LoadingState />;
  if (!latestRunId) return <EmptyState text="Run the pipeline to generate a report." />;

  const step = runDetail?.steps?.find((s) => s.node_id === nodeId);
  if (!step) return <EmptyState text="No data yet — this node hasn't run." />;
  if (step.status === 'failed') return <ErrorState message={step.error ?? 'Step failed'} />;
  if (step.status !== 'completed' || !step.output_data) return <EmptyState text={`Step status: ${step.status}`} />;

  const report = ((step.output_data as { report?: unknown }).report ?? step.output_data) as ReportPayload;
  const sections = Array.isArray(report?.sections) ? report.sections! : [];
  const metrics = Array.isArray(report?.metrics) ? report.metrics! : [];
  const summary = report?.summary;

  return (
    <div>
      <SectionHeader icon={Code2} label="Report" count={sections.length + metrics.length} />

      {/* Compact summary line */}
      {summary && (
        <div
          style={{
            fontSize: '10px',
            color: TEXT_PRIMARY,
            marginBottom: '6px',
            fontWeight: 600,
          }}
        >
          {(summary.total_annotations ?? 0).toLocaleString()} annotations
          {' · '}
          {displayHectares(summary.total_area_hectares, summary.total_area_sqm).toFixed(2)} ha
          {' · '}
          {sections.length} set{sections.length === 1 ? '' : 's'}
          {metrics.length > 0 && ` · ${metrics.length} metric${metrics.length === 1 ? '' : 's'}`}
        </div>
      )}

      {/* Per-section + metrics mini-cards */}
      <div className="nowheel nodrag" style={{ maxHeight: '160px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {sections.map((sec, i) => (
          <SectionMiniCard key={sec.annotation_set_id ?? i} section={sec} />
        ))}
        {metrics.map((m, i) => (
          <MetricsMiniCard key={`metrics-${i}`} metrics={m} />
        ))}
        {sections.length === 0 && metrics.length === 0 && (
          <div style={{ fontSize: '10px', color: TEXT_SECONDARY, fontStyle: 'italic' }}>
            Report has no sections.
          </div>
        )}
      </div>

      {/* View full report button */}
      <button
        type="button"
        className="nodrag"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          marginTop: '6px',
          width: '100%',
          padding: '4px 6px',
          fontSize: '10px',
          fontWeight: 600,
          background: accent,
          color: '#f5ede0',
          border: 'none',
          borderRadius: '3px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '4px',
        }}
      >
        <Maximize2 className="w-2.5 h-2.5" />
        View Full Report
      </button>

      {open && <ReportModal report={report} accent={accent} onClose={() => setOpen(false)} />}
    </div>
  );
}

function SectionMiniCard({ section }: { section: ReportSection }) {
  if (section.missing) {
    return (
      <div style={{ ...cardStyle, color: '#b35e4c' }}>
        <span>Set {String(section.annotation_set_id ?? '').slice(0, 8)}… (missing)</span>
      </div>
    );
  }
  const count = section.totals?.annotation_count ?? 0;
  const hectares = displayHectares(section.totals?.total_area_hectares, section.totals?.total_area_sqm);
  const top = section.per_class?.[0];
  const topPct = top && count > 0 ? Math.round((top.count / count) * 100) : null;
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '4px' }}>
        <span
          className="truncate"
          style={{ fontSize: '10px', fontWeight: 600, color: TEXT_PRIMARY }}
          title={section.name ?? section.annotation_set_id}
        >
          {section.name ?? section.annotation_set_id?.slice(0, 8) ?? 'Set'}
        </span>
        <span style={{ fontSize: '9px', color: TEXT_SECONDARY, whiteSpace: 'nowrap' }}>
          {count.toLocaleString()} · {hectares.toFixed(2)} ha
        </span>
      </div>
      {top && (
        <div style={{ fontSize: '9px', color: TEXT_SECONDARY, marginTop: '1px' }}>
          {top.class}: {top.count.toLocaleString()}
          {topPct !== null && ` (${topPct}%)`}
        </div>
      )}
    </div>
  );
}

function MetricsMiniCard({ metrics }: { metrics: ReportMetrics }) {
  const o = metrics.overall ?? {};
  const best = (metrics.per_class ?? []).reduce<ReportMetricsClass | null>(
    (acc, c) => (c.iou !== null && (acc === null || (acc.iou ?? -1) < c.iou) ? c : acc),
    null,
  );
  const title = metrics.prediction?.name
    ? `${metrics.prediction.name} vs ${metrics.ground_truth?.name ?? 'GT'}`
    : 'Raster metrics';
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '4px' }}>
        <span className="truncate" style={{ fontSize: '10px', fontWeight: 600, color: TEXT_PRIMARY }} title={title}>
          {title}
        </span>
        <span style={{ fontSize: '9px', whiteSpace: 'nowrap', color: scoreColor(o.mean_iou) }}>
          mIoU {fmtRatio(o.mean_iou)}
        </span>
      </div>
      <div style={{ fontSize: '9px', color: TEXT_SECONDARY, marginTop: '1px' }}>
        acc {fmtPct(o.pixel_accuracy)}
        {best && best.iou !== null && ` · best ${best.class_name} ${fmtRatio(best.iou)}`}
      </div>
    </div>
  );
}

// ── Report Modal ──────────────────────────────────────────────────────────────

/**
 * The reusable inner body of a report: per-section tab strip + the active
 * section's detail (stat tiles, per-class table, individual rows) or the raw
 * JSON tab. Used both by the in-canvas ReportModal and the run-results popup.
 */
export function ReportBody({ report, accent = '#7f5539' }: { report: ReportPayload; accent?: string }) {
  const tabs = useMemo(() => {
    const sections = Array.isArray(report?.sections) ? report.sections! : [];
    const metrics = Array.isArray(report?.metrics) ? report.metrics! : [];
    return [
      ...sections.map((sec, i) => ({
        key: sec.annotation_set_id ?? `section-${i}`,
        label: sec.name ?? `Section ${i + 1}`,
        kind: 'section' as const,
        section: sec,
        metric: null as ReportMetrics | null,
      })),
      ...metrics.map((m, i) => ({
        key: `metrics-${i}`,
        label: metrics.length > 1 ? `Metrics ${i + 1}` : 'Metrics',
        kind: 'metrics' as const,
        section: null as ReportSection | null,
        metric: m,
      })),
      { key: '__json__', label: 'Raw JSON', kind: 'json' as const, section: null as ReportSection | null, metric: null as ReportMetrics | null },
    ];
  }, [report]);
  const [activeKey, setActiveKey] = useState(tabs[0]?.key);
  const active = tabs.find((t) => t.key === activeKey) ?? tabs[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Tab strip */}
      <div
        style={{
          display: 'flex',
          gap: '2px',
          borderBottom: `1px solid ${CARD_BORDER}`,
          overflowX: 'auto',
          flexShrink: 0,
        }}
      >
        {tabs.map((tab) => {
          const isActive = tab.key === active?.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveKey(tab.key)}
              style={{
                padding: '6px 12px',
                border: 'none',
                borderBottom: `2px solid ${isActive ? accent : 'transparent'}`,
                background: 'transparent',
                color: isActive ? accent : TEXT_SECONDARY,
                fontSize: '12px',
                fontWeight: isActive ? 600 : 500,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab body */}
      <div style={{ paddingTop: '14px', overflow: 'auto', flex: 1 }}>
        {active?.kind === 'section' && active.section && <SectionDetail section={active.section} />}
        {active?.kind === 'metrics' && active.metric && <MetricsDetail metrics={active.metric} />}
        {active?.kind === 'json' && <RawJsonView report={report} />}
      </div>
    </div>
  );
}

/** Compact summary line for a report (annotations · area · set count). */
export function ReportSummaryLine({ report }: { report: ReportPayload }) {
  const sections = Array.isArray(report?.sections) ? report.sections! : [];
  const setCount = report.summary?.annotation_set_count ?? sections.length;
  return (
    <span>
      {(report.summary?.total_annotations ?? 0).toLocaleString()} annotations ·{' '}
      {displayHectares(report.summary?.total_area_hectares, report.summary?.total_area_sqm).toFixed(2)} ha · {setCount} set
      {setCount === 1 ? '' : 's'}
      {report.generated_at && <> · generated {new Date(report.generated_at).toLocaleString()}</>}
    </span>
  );
}

function ReportModal({ report, onClose, accent = '#7f5539' }: { report: ReportPayload; onClose: () => void; accent?: string }) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const content = (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 17, 12, 0.55)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(960px, 100%)',
          maxHeight: '90vh',
          backgroundColor: '#faf5ec',
          borderRadius: '8px',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
          color: TEXT_PRIMARY,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 18px',
            borderBottom: `1px solid ${CARD_BORDER}`,
          }}
        >
          <div>
            <div style={{ fontSize: '15px', fontWeight: 700 }}>{report.title ?? 'Annotation Report'}</div>
            <div style={{ fontSize: '11px', color: TEXT_SECONDARY, marginTop: '2px' }}>
              <ReportSummaryLine report={report} />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              onClick={() => downloadReportPdf(report)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '11px',
                fontWeight: 600,
                color: '#f5ede0',
                background: accent,
                border: 'none',
                borderRadius: '4px',
                padding: '6px 10px',
                cursor: 'pointer',
              }}
            >
              <Download className="w-3 h-3" />
              Download PDF
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close report"
              style={{
                padding: '6px',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: TEXT_SECONDARY,
                borderRadius: '4px',
              }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tabs + body */}
        <div style={{ padding: '6px 18px 16px', overflow: 'hidden', flex: 1, display: 'flex' }}>
          <ReportBody report={report} accent={accent} />
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(content, document.body);
}

function SectionDetail({ section }: { section: ReportSection }) {
  if (section.missing) {
    return <div style={{ color: '#b35e4c' }}>Annotation set not found in DB (id: {section.annotation_set_id}).</div>;
  }
  const t = section.totals ?? {};
  const buckets = t.confidence_buckets;
  return (
    <div>
      {/* Header chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' }}>
        {section.model && <Chip label="Model" value={section.model} />}
        {section.schema && <Chip label="Schema" value={section.schema} />}
        {section.source_type && <Chip label="Source" value={section.source_type} />}
        {section.created_at && (
          <Chip label="Created" value={new Date(section.created_at).toLocaleString()} />
        )}
      </div>

      {/* 3-stat grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '14px' }}>
        <StatTile
          label="Annotations"
          primary={(t.annotation_count ?? 0).toLocaleString()}
        />
        <StatTile
          label="Total Area"
          primary={`${displayHectares(t.total_area_hectares, t.total_area_sqm).toFixed(2)} ha`}
          secondary={`${(t.total_area_sqm ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} m²`}
        />
        <StatTile
          label="Avg Confidence"
          primary={t.avg_confidence !== null && t.avg_confidence !== undefined ? t.avg_confidence.toFixed(3) : '—'}
          secondary={buckets ? buckets ? confidenceSparkline(buckets) : undefined : undefined}
        />
      </div>

      {/* Per-class table */}
      {section.per_class && section.per_class.length > 0 && (
        <div>
          <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
            Per Class
          </div>
          <div style={{ overflowX: 'auto', border: `1px solid ${CARD_BORDER}`, borderRadius: '4px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
              <thead style={{ backgroundColor: CARD_BG }}>
                <tr>
                  <Th>Class</Th>
                  <Th align="right">Count</Th>
                  <Th align="right">Area (ha)</Th>
                  <Th align="right">Avg Conf</Th>
                  <Th>Conf Distribution</Th>
                  <Th align="right">Area min / med / max (m²)</Th>
                </tr>
              </thead>
              <tbody>
                {section.per_class.map((row) => (
                  <tr key={row.class} style={{ borderTop: `1px solid ${CARD_BORDER}` }}>
                    <Td><strong>{row.class}</strong></Td>
                    <Td align="right">{row.count.toLocaleString()}</Td>
                    <Td align="right">{(row.area_hectares ?? row.area_sqm / 10_000).toFixed(3)}</Td>
                    <Td align="right">{row.avg_confidence !== null ? row.avg_confidence.toFixed(3) : '—'}</Td>
                    <Td>
                      <span style={{ fontFamily: 'monospace', letterSpacing: '1px', color: '#7f5539' }}>
                        {row.confidence_buckets ? confidenceSparkline(row.confidence_buckets) : '—'}
                      </span>
                      {row.confidence_buckets && (
                        <span style={{ fontSize: '9px', color: TEXT_SECONDARY, marginLeft: '6px' }}>
                          {bucketLegend(row.confidence_buckets)}
                        </span>
                      )}
                    </Td>
                    <Td align="right">
                      {row.area_stats
                        ? `${fmtNum(row.area_stats.min_sqm)} / ${fmtNum(row.area_stats.median_sqm)} / ${fmtNum(row.area_stats.max_sqm)}`
                        : '—'}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Optional rows */}
      {section.rows && section.rows.length > 0 && (
        <details style={{ marginTop: '14px' }}>
          <summary style={{ cursor: 'pointer', fontSize: '12px', fontWeight: 600, color: TEXT_PRIMARY }}>
            Individual annotations ({section.rows.length.toLocaleString()})
          </summary>
          <div style={{ marginTop: '6px', overflow: 'auto', maxHeight: '320px', border: `1px solid ${CARD_BORDER}`, borderRadius: '4px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
              <thead style={{ backgroundColor: CARD_BG, position: 'sticky', top: 0 }}>
                <tr>
                  <Th>Annotation ID</Th>
                  <Th>Class</Th>
                  <Th align="right">Conf</Th>
                  <Th align="right">Area (m²)</Th>
                </tr>
              </thead>
              <tbody>
                {section.rows.map((r) => (
                  <tr key={r.annotation_id} style={{ borderTop: `1px solid ${CARD_BORDER}` }}>
                    <Td><code style={{ fontSize: '10px' }}>{r.annotation_id.slice(0, 8)}…</code></Td>
                    <Td>{r.class}</Td>
                    <Td align="right">{r.confidence !== null ? r.confidence.toFixed(3) : '—'}</Td>
                    <Td align="right">{r.area_sqm.toFixed(2)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

function fmtRatio(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : v.toFixed(3);
}

function fmtPct(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`;
}

/** Color an IoU/score value green→amber→red for quick scanning. */
function scoreColor(v: number | null | undefined): string {
  if (v === null || v === undefined) return TEXT_SECONDARY;
  if (v >= 0.7) return '#3f7d4f';
  if (v >= 0.4) return '#9a7d2c';
  return '#b35e4c';
}

function MetricsDetail({ metrics }: { metrics: ReportMetrics }) {
  const o = metrics.overall ?? {};
  const perClass = (metrics.per_class ?? [])
    .slice()
    .sort((a, b) => (b.iou ?? -1) - (a.iou ?? -1));
  const gtName = metrics.ground_truth?.name;
  const predName = metrics.prediction?.name;

  return (
    <div>
      {/* GT vs Model header chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' }}>
        {gtName && <Chip label="Ground Truth" value={gtName} />}
        {predName && <Chip label="Model Output" value={predName} />}
        {metrics.grid?.grid_from && <Chip label="Grid" value={metrics.grid.grid_from} />}
        {metrics.grid?.crs && <Chip label="CRS" value={metrics.grid.crs} />}
      </div>

      {/* Overall stat grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '14px' }}>
        <StatTile label="Mean IoU" primary={fmtRatio(o.mean_iou)} />
        <StatTile label="Pixel Accuracy" primary={fmtPct(o.pixel_accuracy)} />
        <StatTile
          label="Foreground Acc."
          primary={fmtPct(o.foreground_accuracy)}
          secondary={o.class_count !== undefined ? `${o.class_count} classes` : undefined}
        />
      </div>

      {/* Per-class metrics table */}
      {perClass.length > 0 && (
        <div>
          <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>Per Class</div>
          <div style={{ overflowX: 'auto', border: `1px solid ${CARD_BORDER}`, borderRadius: '4px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
              <thead style={{ backgroundColor: CARD_BG }}>
                <tr>
                  <Th>Class</Th>
                  <Th align="right">IoU</Th>
                  <Th align="right">Precision</Th>
                  <Th align="right">Recall</Th>
                  <Th align="right">F1</Th>
                  <Th align="right">GT px</Th>
                  <Th align="right">Pred px</Th>
                </tr>
              </thead>
              <tbody>
                {perClass.map((row) => {
                  const onlyGt = row.present_in_gt && !row.present_in_prediction;
                  const onlyPred = !row.present_in_gt && row.present_in_prediction;
                  return (
                    <tr key={row.class_id} style={{ borderTop: `1px solid ${CARD_BORDER}` }}>
                      <Td>
                        <strong>{row.class_name}</strong>
                        {onlyGt && (
                          <span style={{ fontSize: '9px', color: TEXT_SECONDARY, marginLeft: '6px' }}>
                            GT only
                          </span>
                        )}
                        {onlyPred && (
                          <span style={{ fontSize: '9px', color: TEXT_SECONDARY, marginLeft: '6px' }}>
                            pred only
                          </span>
                        )}
                      </Td>
                      <Td align="right">
                        <span style={{ fontWeight: 600, color: scoreColor(row.iou) }}>{fmtRatio(row.iou)}</span>
                      </Td>
                      <Td align="right">{fmtRatio(row.precision)}</Td>
                      <Td align="right">{fmtRatio(row.recall)}</Td>
                      <Td align="right">{fmtRatio(row.f1_score)}</Td>
                      <Td align="right">{row.gt_pixels.toLocaleString()}</Td>
                      <Td align="right">{row.pred_pixels.toLocaleString()}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function RawJsonView({ report }: { report: ReportPayload }) {
  const [copied, setCopied] = useState(false);
  const pretty = useMemo(() => {
    try {
      return JSON.stringify(report, null, 2);
    } catch {
      return String(report);
    }
  }, [report]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pretty);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '6px' }}>
        <button
          type="button"
          onClick={copy}
          style={{
            padding: '4px 10px',
            fontSize: '11px',
            border: `1px solid ${CARD_BORDER}`,
            background: CARD_BG,
            borderRadius: '4px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copied' : 'Copy JSON'}
        </button>
      </div>
      <pre
        style={{
          backgroundColor: '#1e2218',
          color: 'rgba(245,237,224,0.85)',
          padding: '12px',
          borderRadius: '6px',
          fontSize: '11px',
          lineHeight: 1.55,
          fontFamily: 'monospace',
          overflow: 'auto',
          maxHeight: '60vh',
          margin: 0,
        }}
      >
        {pretty}
      </pre>
    </div>
  );
}

// ── Modal helpers ─────────────────────────────────────────────────────────────

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        fontSize: '11px',
        padding: '3px 8px',
        background: CARD_BG,
        border: `1px solid ${CARD_BORDER}`,
        borderRadius: '999px',
        color: TEXT_PRIMARY,
      }}
    >
      <span style={{ color: TEXT_SECONDARY, fontWeight: 500 }}>{label}:</span>
      <strong>{value}</strong>
    </span>
  );
}

function StatTile({ label, primary, secondary }: { label: string; primary: string; secondary?: string }) {
  return (
    <div
      style={{
        background: CARD_BG,
        border: `1px solid ${CARD_BORDER}`,
        borderRadius: '6px',
        padding: '10px 12px',
      }}
    >
      <div style={{ fontSize: '10px', color: TEXT_SECONDARY, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div style={{ fontSize: '20px', fontWeight: 700, marginTop: '2px' }}>{primary}</div>
      {secondary && (
        <div style={{ fontSize: '10px', color: TEXT_SECONDARY, marginTop: '2px' }}>{secondary}</div>
      )}
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th style={{
      padding: '6px 10px',
      textAlign: align ?? 'left',
      fontWeight: 600,
      fontSize: '10px',
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
      color: TEXT_SECONDARY,
    }}>{children}</th>
  );
}

function Td({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <td style={{ padding: '6px 10px', textAlign: align ?? 'left', verticalAlign: 'top' }}>{children}</td>
  );
}

/**
 * Aggregate hectares to display. The backend sometimes leaves the *aggregate*
 * `total_area_hectares` at 0 while populating `total_area_sqm`, so we derive
 * ha from m² (1 ha = 10,000 m²) when hectares is missing or zero.
 */
function displayHectares(hectares?: number | null, sqm?: number | null): number {
  if (hectares && hectares > 0) return hectares;
  if (sqm && sqm > 0) return sqm / 10_000;
  return 0;
}

const SPARK_GLYPHS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
function confidenceSparkline(buckets: Record<string, number>): string {
  const order = ['0.00-0.50', '0.50-0.70', '0.70-0.85', '0.85-1.00'];
  const values = order.map((k) => buckets[k] ?? 0);
  const max = Math.max(...values, 1);
  return values
    .map((v) => {
      if (v === 0) return SPARK_GLYPHS[0];
      const ratio = v / max;
      const idx = Math.min(SPARK_GLYPHS.length - 1, Math.max(1, Math.round(ratio * (SPARK_GLYPHS.length - 1))));
      return SPARK_GLYPHS[idx];
    })
    .join('');
}

function bucketLegend(buckets: Record<string, number>): string {
  const order = ['0.00-0.50', '0.50-0.70', '0.70-0.85', '0.85-1.00'];
  return order.map((k) => buckets[k] ?? 0).join(' / ');
}

function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  if (n >= 100) return n.toFixed(0);
  if (n >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

// ── Main dispatcher ───────────────────────────────────────────────────────────

interface DisplayNodeContentProps {
  nodeType: string;
  config: Record<string, unknown>;
}

export function DisplayNodeContent({ nodeType, config }: DisplayNodeContentProps) {
  switch (nodeType) {
    case 'view_datasets':
      return <DatasetViewer config={config} />;
    case 'view_map_layers':
      return <MapLayersViewer config={config} />;
    case 'view_annotation_sets':
      return <AnnotationSetsViewer />;
    case 'view_models':
      return <ModelsViewer config={config} />;
    case 'view_stats':
      return <StatsViewer />;
    case 'view_json':
      return <JsonViewer />;
    default:
      return null;
  }
}
