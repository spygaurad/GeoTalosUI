'use client';

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
} from 'lucide-react';
import { usePipelineContext } from './PipelineContext';
import { datasetsApi } from '@/lib/api/datasets';
import { mapsApi } from '@/lib/api/maps';
import { modelsApi } from '@/lib/api/models';
import { annotationSetsApi } from '@/lib/api/annotation-sets';
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
      <div style={{ maxHeight: '180px', overflowY: 'auto', overflowX: 'hidden' }}>
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
                  ds.dataset_type === 'raster' ? '#e8dcc8' : '#d4e8d4',
                  ds.dataset_type === 'raster' ? '#7f5539' : '#3a6b3a',
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
        <div style={{ maxHeight: '180px', overflowY: 'auto', overflowX: 'hidden' }}>
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
      <div style={{ maxHeight: '180px', overflowY: 'auto', overflowX: 'hidden' }}>
        {items.map((as_) => {
          const isAuto = !!as_.created_by_job_id;
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

const MODEL_TYPE_COLORS: Record<string, { bg: string; fg: string }> = {
  detection:      { bg: '#e8dcd4', fg: '#8a4a2a' },
  segmentation:   { bg: '#d4e0e8', fg: '#2a5a7a' },
  classification: { bg: '#e0d4e8', fg: '#6a2a8a' },
};

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
      <div style={{ maxHeight: '180px', overflowY: 'auto', overflowX: 'hidden' }}>
        {items.map((model) => {
          const colors = MODEL_TYPE_COLORS[model.type] ?? { bg: '#e8e8e8', fg: '#555' };
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
