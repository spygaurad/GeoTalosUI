'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { projectsApi } from '@/lib/api/projects';
import { mapsApi } from '@/lib/api/maps';
import { datasetsApi } from '@/lib/api/datasets';
import { qk } from '@/lib/query-keys';
import {
  ChevronRight,
  Plus,
  Map,
  Database,
  Tags,
  Activity,
  Users,
  Clock,
  ExternalLink,
  CheckCircle2,
  Loader2,
  AlertCircle,
  UploadCloud,
  Cpu,
  Workflow,
} from 'lucide-react';
import type { ProjectMap, Dataset, ProjectMember, Pipeline, PipelineStatus, PipelineTriggerType } from '@/types/api';
import type { Job, JobStatus } from '@/types/common';
import { automationApi } from '@/lib/api/automation';

// ── Topographic SVG ──────────────────────────────────────────────────────────

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

const PALETTES = [
  { bg: '#2e3428', c: '#c4985c', b1: '#414833', b2: '#4a5240' },
  { bg: '#3a2c1e', c: '#d4b896', b1: '#5a3e2a', b2: '#6b4c33' },
  { bg: '#1e2e28', c: '#a8c4a0', b1: '#2a4030', b2: '#365040' },
  { bg: '#2a2618', c: '#c4b480', b1: '#3a3420', b2: '#48422a' },
];

function TopoThumb({
  name,
  tall = false,
}: {
  name: string;
  tall?: boolean;
}) {
  const seed = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const rng = seededRandom(seed);
  const pal = PALETTES[seed % PALETTES.length];

  const cx = 50 + rng() * 60 - 30;
  const cy = 45 + rng() * 30 - 15;
  const W = 320, H = tall ? 220 : 140;
  const radii = [70, 54, 38, 24, 13].map((r) => r + rng() * 8 - 4);

  const blobs = Array.from({ length: 4 }, () => ({
    cx: 30 + rng() * (W - 60),
    cy: 20 + rng() * (H - 40),
    rx: 18 + rng() * 28,
    ry: 14 + rng() * 22,
  }));

  const boxX = 25 + rng() * 50, boxY = 20 + rng() * 30;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-full"
      aria-hidden="true"
    >
      <rect width={W} height={H} fill={pal.bg} />
      {blobs.map((b, i) => (
        <ellipse
          key={i}
          cx={b.cx} cy={b.cy}
          rx={b.rx} ry={b.ry}
          fill={i % 2 === 0 ? pal.b1 : pal.b2}
          opacity={0.82 + i * 0.04}
        />
      ))}
      {radii.map((r, i) => (
        <ellipse
          key={i}
          cx={cx} cy={cy}
          rx={r} ry={r * 0.68}
          fill="none"
          stroke={pal.c}
          strokeWidth="0.5"
          opacity={0.08 + i * 0.06}
        />
      ))}
      <rect
        x={boxX} y={boxY}
        width={22 + rng() * 12} height={14 + rng() * 8}
        fill="none"
        stroke={pal.c}
        strokeWidth="0.55"
        strokeDasharray="2.5 1.5"
        opacity="0.4"
      />
      <circle cx={cx} cy={cy} r="2.5" fill={pal.c} opacity="0.55" />
      <circle cx={cx} cy={cy} r="0.9" fill={pal.bg} />
      <line
        x1={W - 40} y1={H - 10}
        x2={W - 16} y2={H - 10}
        stroke={pal.c}
        strokeWidth="1"
        opacity="0.28"
      />
    </svg>
  );
}

// ── Tab bar ──────────────────────────────────────────────────────────────────

type TabId = 'maps' | 'datasets' | 'annotations' | 'automations' | 'activity' | 'members';

const TABS: { id: TabId; label: string; icon: React.FC<{ className?: string }> }[] = [
  { id: 'maps', label: 'Maps', icon: Map },
  { id: 'datasets', label: 'Datasets', icon: Database },
  { id: 'annotations', label: 'Annotations', icon: Tags },
  { id: 'automations', label: 'Automations', icon: Workflow },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'members', label: 'Members', icon: Users },
];

function TabBar({
  active,
  onChange,
}: {
  active: TabId;
  onChange: (t: TabId) => void;
}) {
  return (
    <div
      className="flex items-center gap-1"
      style={{ borderBottom: '1px solid #e8d8c4' }}
      role="tablist"
    >
      {TABS.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className="relative flex items-center gap-1.5 px-3 py-2.5 transition-colors"
            style={{
              fontSize: '0.8125rem',
              fontWeight: isActive ? 600 : 400,
              color: isActive ? '#2e3428' : '#9a8878',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
            {isActive && (
              <span
                className="absolute bottom-0 left-0 right-0"
                style={{ height: '2px', backgroundColor: '#c4985c', borderRadius: '1px 1px 0 0' }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Maps tab ─────────────────────────────────────────────────────────────────

function MapCard({
  map,
  workspaceId,
  featured,
}: {
  map: ProjectMap;
  workspaceId: string;
  featured: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const href = `/workspace/${workspaceId}/projects/${map.project_id}/maps/${map.id}`;

  return (
    <Link
      href={href}
      className="group flex flex-col rounded-xl overflow-hidden"
      style={{
        border: '1px solid #dcc9b2',
        backgroundColor: '#fdf5ec',
        textDecoration: 'none',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className="relative overflow-hidden"
        style={{ height: featured ? '180px' : '110px' }}
      >
        <div
          className="w-full h-full"
          style={{
            transform: hovered ? 'scale(1.04)' : 'scale(1)',
            transition: 'transform 0.4s cubic-bezier(0.2,0,0,1)',
          }}
        >
          <TopoThumb name={map.name} tall={featured} />
        </div>

        {/* Hover overlay */}
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            backgroundColor: 'rgba(46,52,40,0.38)',
            opacity: hovered ? 1 : 0,
            transition: 'opacity 0.2s',
          }}
        >
          <span
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5"
            style={{
              fontSize: '0.75rem',
              fontWeight: 600,
              backgroundColor: '#f5ede0',
              color: '#2e3428',
            }}
          >
            <ExternalLink className="w-3 h-3" />
            Open in map
          </span>
        </div>
      </div>

      <div className="px-3.5 py-3">
        <p
          className="truncate"
          style={{
            fontSize: featured ? '0.9375rem' : '0.8125rem',
            fontWeight: 600,
            color: '#2e3428',
            marginBottom: '2px',
          }}
        >
          {map.name}
        </p>
        {map.description && (
          <p
            className="truncate"
            style={{ fontSize: '0.75rem', color: '#9a8878', marginBottom: '4px' }}
          >
            {map.description}
          </p>
        )}
        <div
          className="flex items-center gap-1"
          style={{ fontSize: '0.6875rem', color: '#b0a090' }}
        >
          <Clock className="w-3 h-3" aria-hidden="true" />
          {new Date(map.updated_at).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
        </div>
      </div>
    </Link>
  );
}

function MapsTab({
  projectId,
  workspaceId,
}: {
  projectId: string;
  workspaceId: string;
}) {
  const { data, isLoading } = useQuery({
    queryKey: qk.maps.list(projectId),
    queryFn: () => mapsApi.list(projectId as string),
  });

  const maps = data?.items ?? [];

  if (isLoading) {
    return (
      <div className="grid grid-cols-3 gap-4 pt-6">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="rounded-xl overflow-hidden"
            style={{ border: '1px solid #dcc9b2' }}
          >
            <div style={{ height: '110px', backgroundColor: '#e8d5b8' }} />
            <div className="p-3.5 space-y-2">
              <div style={{ height: '12px', width: '70%', backgroundColor: '#e8d5b8', borderRadius: '4px' }} />
              <div style={{ height: '10px', width: '40%', backgroundColor: '#f0e4d4', borderRadius: '4px' }} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (maps.length === 0) {
    return (
      <div className="py-16 text-center">
        <div
          className="inline-flex items-center justify-center rounded-xl mb-4"
          style={{ width: '48px', height: '48px', backgroundColor: '#e8d5b8' }}
        >
          <Map className="w-5 h-5" style={{ color: '#7f5539' }} />
        </div>
        <p style={{ fontSize: '1rem', fontWeight: 600, color: '#2e3428', marginBottom: '6px' }}>
          No maps yet
        </p>
        <p style={{ fontSize: '0.875rem', color: '#9a8878', marginBottom: '20px' }}>
          Maps are work units inside your project — each with its own layers, annotations, and AI runs.
        </p>
        <Link
          href={`/workspace/${workspaceId}/map/new?project=${projectId}`}
          className="inline-flex items-center gap-2 rounded-xl font-semibold"
          style={{ backgroundColor: '#7f5539', color: '#f5ede0', padding: '0.625rem 1.25rem', fontSize: '0.875rem' }}
        >
          <Plus className="w-3.5 h-3.5" />
          Create first map
        </Link>
      </div>
    );
  }

  const [featured, ...rest] = maps;

  return (
    <div className="pt-6 space-y-4">
      {/* Featured row */}
      <div className="grid gap-4" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <MapCard map={featured} workspaceId={workspaceId} featured />
        <div className="flex flex-col gap-4">
          {rest.slice(0, 2).map((m) => (
            <MapCard key={m.id} map={m} workspaceId={workspaceId} featured={false} />
          ))}
        </div>
      </div>

      {/* Remaining grid */}
      {rest.length > 2 && (
        <div className="grid grid-cols-3 gap-4">
          {rest.slice(2).map((m) => (
            <MapCard key={m.id} map={m} workspaceId={workspaceId} featured={false} />
          ))}
        </div>
      )}

      {/* New map */}
      <Link
        href={`/workspace/${workspaceId}/map/new?project=${projectId}`}
        className="flex items-center justify-center gap-2 w-full rounded-xl py-3 transition-colors"
        style={{
          border: '1.5px dashed #d4c0a8',
          color: '#9a8878',
          fontSize: '0.8125rem',
          fontWeight: 500,
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.borderColor = '#7f5539';
          (e.currentTarget as HTMLElement).style.color = '#7f5539';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.borderColor = '#d4c0a8';
          (e.currentTarget as HTMLElement).style.color = '#9a8878';
        }}
      >
        <Plus className="w-3.5 h-3.5" />
        New map
      </Link>
    </div>
  );
}

// ── Datasets tab ─────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, { dot: string; label: string }> = {
  ready:     { dot: '#656d4a', label: 'Ready' },
  ingesting: { dot: '#a68a64', label: 'Ingesting' },
  pending:   { dot: '#a68a64', label: 'Pending' },
  failed:    { dot: '#b35e4c', label: 'Failed' },
};

function DatasetsTab({ projectId }: { projectId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: qk.datasets.list({ project_id: projectId }),
    queryFn: () => datasetsApi.list({ project_id: projectId }),
  });

  const datasets = data?.items ?? [];

  if (isLoading) {
    return (
      <div className="pt-6 space-y-px">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="py-4 flex items-center gap-4"
            style={{ borderBottom: '1px solid #e8d8c4' }}
          >
            <div style={{ height: '12px', width: '30%', backgroundColor: '#e8d5b8', borderRadius: '4px' }} />
            <div style={{ height: '10px', width: '15%', backgroundColor: '#f0e4d4', borderRadius: '4px' }} />
          </div>
        ))}
      </div>
    );
  }

  if (datasets.length === 0) {
    return (
      <div className="py-16 text-center">
        <p style={{ fontSize: '1rem', fontWeight: 600, color: '#2e3428', marginBottom: '6px' }}>No datasets linked</p>
        <p style={{ fontSize: '0.875rem', color: '#9a8878', marginBottom: '20px' }}>
          Add raster or vector datasets to your project's maps.
        </p>
        <Link
          href={`/workspace/${projectId}/datasets/new`}
          className="inline-flex items-center gap-2 rounded-xl font-semibold"
          style={{ backgroundColor: '#7f5539', color: '#f5ede0', padding: '0.625rem 1.25rem', fontSize: '0.875rem' }}
        >
          <UploadCloud className="w-3.5 h-3.5" />
          Upload dataset
        </Link>
      </div>
    );
  }

  return (
    <div className="pt-6">
      <div style={{ borderTop: '1px solid #e8d8c4' }}>
        {datasets.map((ds) => {
          const s = STATUS_COLORS[ds.status] ?? STATUS_COLORS.pending;
          const temporal = ds.temporal_extent?.lower
            ? new Date(ds.temporal_extent.lower).getFullYear()
            : null;

          return (
            <div
              key={ds.id}
              className="flex items-center gap-4 py-4"
              style={{ borderBottom: '1px solid #e8d8c4' }}
            >
              <div className="flex-1 min-w-0">
                <p
                  className="truncate"
                  style={{ fontSize: '0.875rem', fontWeight: 500, color: '#2e3428', marginBottom: '2px' }}
                >
                  {ds.name}
                </p>
              </div>

              <div
                className="hidden md:flex items-center gap-6 shrink-0"
                style={{ fontSize: '0.75rem', color: '#9a8878' }}
              >
                {(ds.metadata?.file_count ?? 0) > 0 && <span>{ds.metadata!.file_count!.toLocaleString()} files</span>}
                {temporal && <span>{temporal}</span>}
                <span
                  className="flex items-center gap-1.5"
                  style={{ color: s.dot }}
                >
                  <span
                    className="rounded-full"
                    style={{ width: '6px', height: '6px', backgroundColor: s.dot, display: 'inline-block' }}
                  />
                  {s.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Annotations tab ──────────────────────────────────────────────────────────

function AnnotationsTab() {
  return (
    <div className="pt-6">
      {/* Aggregated stats */}
      <div
        className="grid grid-cols-3 gap-px mb-8 rounded-xl overflow-hidden"
        style={{ border: '1px solid #dcc9b2', backgroundColor: '#dcc9b2' }}
      >
        {ANNOTATION_STATS.map((s) => (
          <div
            key={s.label}
            className="flex flex-col px-5 py-4"
            style={{ backgroundColor: '#fdf5ec' }}
          >
            <span
              style={{
                fontFamily: 'var(--font-display, Georgia, serif)',
                fontSize: '1.75rem',
                fontWeight: 700,
                color: '#2e3428',
                lineHeight: 1,
              }}
            >
              {s.value}
            </span>
            <span style={{ fontSize: '0.75rem', color: '#9a8878', marginTop: '4px' }}>
              {s.label}
            </span>
          </div>
        ))}
      </div>

      {/* Source breakdown */}
      <h3
        style={{
          fontSize: '0.75rem',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: '#9a8878',
          marginBottom: '12px',
        }}
      >
        By source
      </h3>

      <div className="space-y-3 mb-8">
        {SOURCE_BREAKDOWN.map((s) => (
          <div key={s.label} className="flex items-center gap-3">
            <span style={{ fontSize: '0.8125rem', color: '#6a5c4e', width: '80px' }}>{s.label}</span>
            <div className="flex-1 rounded-full overflow-hidden" style={{ height: '6px', backgroundColor: '#e8d5b8' }}>
              <div
                className="h-full rounded-full"
                style={{ width: `${s.pct}%`, backgroundColor: '#7f5539' }}
              />
            </div>
            <span style={{ fontSize: '0.75rem', color: '#9a8878', width: '40px', textAlign: 'right' }}>
              {s.count.toLocaleString()}
            </span>
          </div>
        ))}
      </div>

      {/* Label distribution */}
      <h3
        style={{
          fontSize: '0.75rem',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: '#9a8878',
          marginBottom: '12px',
        }}
      >
        Label distribution
      </h3>

      <div style={{ borderTop: '1px solid #e8d8c4' }}>
        {LABEL_CLASSES.map((lc) => (
          <div
            key={lc.label}
            className="flex items-center justify-between py-3"
            style={{ borderBottom: '1px solid #e8d8c4' }}
          >
            <div className="flex items-center gap-2.5">
              <span
                className="rounded-full"
                style={{ width: '8px', height: '8px', backgroundColor: lc.color, display: 'inline-block', flexShrink: 0 }}
              />
              <span style={{ fontSize: '0.875rem', color: '#2e3428' }}>{lc.label}</span>
            </div>
            <div className="flex items-center gap-4">
              <span style={{ fontSize: '0.8125rem', color: '#9a8878' }}>
                {lc.count.toLocaleString()}
              </span>
              <span style={{ fontSize: '0.75rem', color: '#b0a090', width: '36px', textAlign: 'right' }}>
                {lc.pct}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Automations tab ──────────────────────────────────────────────────────

const PIPELINE_STATUS_STYLE: Record<PipelineStatus, { dot: string; label: string }> = {
  active:   { dot: '#656d4a', label: 'Active' },
  draft:    { dot: '#9a8878', label: 'Draft' },
  paused:   { dot: '#a68a64', label: 'Paused' },
  archived: { dot: '#b0a090', label: 'Archived' },
};

const TRIGGER_LABELS: Record<PipelineTriggerType, string> = {
  manual: 'Manual',
  schedule: 'Schedule',
  event: 'Event',
};

function AutomationsTab({
  projectId,
  workspaceId,
}: {
  projectId: string;
  workspaceId: string;
}) {
  const { data, isLoading } = useQuery({
    queryKey: qk.automation.pipelines({ project_id: projectId }),
    queryFn: () => automationApi.listPipelines({ project_id: projectId }),
  });

  const pipelines = data?.items ?? [];
  const base = `/workspace/${workspaceId}/projects/${projectId}/automations`;

  if (isLoading) {
    return (
      <div className="pt-6 space-y-px">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="py-4 flex items-center gap-4"
            style={{ borderBottom: '1px solid #e8d8c4' }}
          >
            <div style={{ height: '12px', width: '30%', backgroundColor: '#e8d5b8', borderRadius: '4px' }} />
            <div style={{ height: '10px', width: '15%', backgroundColor: '#f0e4d4', borderRadius: '4px' }} />
          </div>
        ))}
      </div>
    );
  }

  if (pipelines.length === 0) {
    return (
      <div className="py-16 text-center">
        <div
          className="inline-flex items-center justify-center rounded-xl mb-4"
          style={{ width: '48px', height: '48px', backgroundColor: '#e8d5b8' }}
        >
          <Workflow className="w-5 h-5" style={{ color: '#7f5539' }} />
        </div>
        <p style={{ fontSize: '1rem', fontWeight: 600, color: '#2e3428', marginBottom: '6px' }}>
          No automation pipelines
        </p>
        <p style={{ fontSize: '0.875rem', color: '#9a8878', marginBottom: '20px' }}>
          Build visual workflows to automate inference, quality checks, and analysis.
        </p>
        <Link
          href={`${base}/new`}
          className="inline-flex items-center gap-2 rounded-xl font-semibold"
          style={{ backgroundColor: '#7f5539', color: '#f5ede0', padding: '0.625rem 1.25rem', fontSize: '0.875rem' }}
        >
          <Plus className="w-3.5 h-3.5" />
          Create first pipeline
        </Link>
      </div>
    );
  }

  return (
    <div className="pt-6">
      <div className="flex items-center justify-between mb-4">
        <p style={{ fontSize: '0.8125rem', color: '#9a8878' }}>
          {pipelines.length} pipeline{pipelines.length !== 1 ? 's' : ''}
        </p>
        <Link
          href={`${base}/new`}
          className="inline-flex items-center gap-1.5 rounded-lg font-semibold transition-all hover:opacity-90"
          style={{
            backgroundColor: '#7f5539',
            color: '#f5ede0',
            padding: '0.4rem 0.75rem',
            fontSize: '0.75rem',
          }}
        >
          <Plus className="w-3 h-3" />
          New pipeline
        </Link>
      </div>

      <div style={{ borderTop: '1px solid #e8d8c4' }}>
        {pipelines.map((p) => {
          const s = PIPELINE_STATUS_STYLE[p.status];
          return (
            <Link
              key={p.id}
              href={`${base}/${p.id}`}
              className="flex items-center gap-4 py-4 transition-colors"
              style={{ borderBottom: '1px solid #e8d8c4', textDecoration: 'none' }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor = '#fefbf7';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
              }}
            >
              <div className="flex-1 min-w-0">
                <p
                  className="truncate"
                  style={{ fontSize: '0.875rem', fontWeight: 500, color: '#2e3428', marginBottom: '2px' }}
                >
                  {p.name}
                </p>
                {p.description && (
                  <p
                    className="truncate"
                    style={{ fontSize: '0.75rem', color: '#9a8878' }}
                  >
                    {p.description}
                  </p>
                )}
              </div>

              <div
                className="hidden md:flex items-center gap-6 shrink-0"
                style={{ fontSize: '0.75rem', color: '#9a8878' }}
              >
                <span>{TRIGGER_LABELS[p.trigger_type]}</span>
                {p.node_count > 0 && (
                  <span>{p.node_count} node{p.node_count !== 1 ? 's' : ''}</span>
                )}
                <span
                  className="flex items-center gap-1.5"
                  style={{ color: s.dot }}
                >
                  <span
                    className="rounded-full"
                    style={{ width: '6px', height: '6px', backgroundColor: s.dot, display: 'inline-block' }}
                  />
                  {s.label}
                </span>
              </div>

              <ChevronRight className="w-3.5 h-3.5 shrink-0" style={{ color: '#c4b09c' }} />
            </Link>
          );
        })}
      </div>

      <Link
        href={base}
        className="mt-4 inline-flex items-center gap-1.5 transition-opacity hover:opacity-70"
        style={{ fontSize: '0.8125rem', color: '#7f5539', textDecoration: 'none' }}
      >
        View all automations
        <ChevronRight className="w-3 h-3" />
      </Link>
    </div>
  );
}

// ── Activity tab ─────────────────────────────────────────────────────────────

function JobIcon({ status }: { status: JobStatus }) {
  if (status === 'running')
    return <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: '#a68a64' }} />;
  if (status === 'failed')
    return <AlertCircle className="w-3.5 h-3.5" style={{ color: '#b35e4c' }} />;
  return <CheckCircle2 className="w-3.5 h-3.5" style={{ color: '#656d4a' }} />;
}

const JOB_TYPE_LABELS: Record<string, string> = {
  ingest: 'Dataset ingested',
  inference: 'Inference run',
  bulk_annotate: 'Bulk annotate',
  bulk_delete: 'Bulk delete',
  bulk_update: 'Annotations updated',
  analysis: 'Analysis',
  export: 'Export',
  relationship_discovery: 'Relationship discovery',
};

function ActivityTab() {
  return (
    <div className="pt-6">
      <div style={{ borderTop: '1px solid #e8d8c4' }}>
        {MOCK_ACTIVITY.map((item, i) => (
          <div
            key={item.id}
            className="flex items-start gap-3 py-4"
            style={{ borderBottom: '1px solid #e8d8c4' }}
          >
            {/* Left timeline dot */}
            <div className="shrink-0 mt-0.5">
              <JobIcon status={item.status} />
            </div>

            <div className="flex-1 min-w-0">
              <p style={{ fontSize: '0.875rem', color: '#2e3428', marginBottom: '2px' }}>
                <span style={{ fontWeight: 500 }}>
                  {JOB_TYPE_LABELS[item.job_type] ?? item.job_type}
                </span>
                {item.map_name && (
                  <span style={{ color: '#9a8878' }}>
                    {' '}— {item.map_name}
                  </span>
                )}
              </p>
              {item.detail && (
                <p style={{ fontSize: '0.8125rem', color: '#9a8878' }}>{item.detail}</p>
              )}
            </div>

            <span
              className="shrink-0"
              style={{ fontSize: '0.75rem', color: '#b0a090', whiteSpace: 'nowrap' }}
            >
              {item.time}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Members tab ──────────────────────────────────────────────────────────────

const ROLE_STYLE: Record<string, { bg: string; color: string }> = {
  admin:  { bg: '#e8d5b8', color: '#7f5539' },
  member: { bg: '#dde1d1', color: '#414833' },
  viewer: { bg: '#f0e4d4', color: '#9a8878' },
};

function MembersTab({ projectId }: { projectId: string }) {
  return (
    <div className="pt-6">
      <div style={{ borderTop: '1px solid #e8d8c4' }}>
        {MOCK_MEMBERS.map((m) => {
          const r = ROLE_STYLE[m.role];
          const initials = m.user.name
            .split(' ')
            .map((n) => n[0])
            .join('')
            .toUpperCase()
            .slice(0, 2);

          return (
            <div
              key={m.user_id}
              className="flex items-center gap-3 py-3.5"
              style={{ borderBottom: '1px solid #e8d8c4' }}
            >
              {/* Avatar */}
              <div
                className="flex items-center justify-center rounded-full shrink-0"
                style={{
                  width: '32px',
                  height: '32px',
                  backgroundColor: '#e8d5b8',
                  fontSize: '0.6875rem',
                  fontWeight: 700,
                  color: '#7f5539',
                }}
              >
                {initials}
              </div>

              <div className="flex-1 min-w-0">
                <p style={{ fontSize: '0.875rem', fontWeight: 500, color: '#2e3428' }}>
                  {m.user.name}
                </p>
                <p style={{ fontSize: '0.75rem', color: '#9a8878' }}>{m.user.email}</p>
              </div>

              <span
                style={{
                  fontSize: '0.6875rem',
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: '4px',
                  backgroundColor: r.bg,
                  color: r.color,
                  textTransform: 'capitalize',
                }}
              >
                {m.role}
              </span>
            </div>
          );
        })}
      </div>

      <button
        className="mt-4 flex items-center gap-2 transition-opacity hover:opacity-70"
        style={{ fontSize: '0.8125rem', color: '#7f5539', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        <Plus className="w-3.5 h-3.5" />
        Invite member
      </button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface ProjectContentProps {
  projectId: string;
  workspaceId: string;
}

export function ProjectContent({ projectId, workspaceId }: ProjectContentProps) {
  const [tab, setTab] = useState<TabId>('maps');

  const { data: project, isLoading } = useQuery({
    queryKey: qk.projects.detail(projectId),
    queryFn: () => projectsApi.get(projectId),
  });

  const projectName = project?.name ?? (isLoading ? '' : 'Project');

  return (
    <div
      className="max-w-5xl mx-auto py-8 px-10"
      style={{ fontFamily: 'var(--font-sans, system-ui)' }}
    >
      {/* ── Breadcrumb ── */}
      <nav
        className="flex items-center gap-1.5 mb-6"
        style={{ fontSize: '0.8125rem', color: '#9a8878' }}
        aria-label="Breadcrumb"
      >
        <Link
          href={`/workspace/${workspaceId}/projects`}
          className="transition-colors hover:text-[#7f5539]"
          style={{ color: '#9a8878' }}
        >
          Projects
        </Link>
        <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
        <span style={{ color: '#2e3428', fontWeight: 500 }}>
          {isLoading ? '…' : projectName}
        </span>
      </nav>

      {/* ── Project header ── */}
      <div className="flex items-start justify-between gap-8 mb-8">
        <div className="min-w-0">
          {isLoading ? (
            <>
              <div style={{ height: '2.25rem', width: '280px', backgroundColor: '#e8d5b8', borderRadius: '6px', marginBottom: '10px' }} />
              <div style={{ height: '1rem', width: '360px', backgroundColor: '#f0e4d4', borderRadius: '4px' }} />
            </>
          ) : (
            <>
              <h1
                style={{
                  fontFamily: 'var(--font-display, Georgia, serif)',
                  fontSize: 'clamp(1.75rem, 3vw, 2.375rem)',
                  fontWeight: 700,
                  color: '#2e3428',
                  lineHeight: 1.1,
                  marginBottom: '8px',
                }}
              >
                {projectName}
              </h1>
              {project?.description && (
                <p style={{ fontSize: '0.9375rem', color: '#6a5c4e', lineHeight: 1.55, maxWidth: '520px' }}>
                  {project.description}
                </p>
              )}
              {project && (
                <p
                  className="flex items-center gap-1.5 mt-3"
                  style={{ fontSize: '0.75rem', color: '#9a8878' }}
                >
                  <Clock className="w-3 h-3" aria-hidden="true" />
                  Updated{' '}
                  {new Date(project.updated_at).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </p>
              )}
            </>
          )}
        </div>

        <Link
          href={`/workspace/${workspaceId}/map/new?project=${projectId}`}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-lg font-semibold transition-all hover:opacity-90"
          style={{
            backgroundColor: '#7f5539',
            color: '#f5ede0',
            padding: '0.5rem 1rem',
            fontSize: '0.8125rem',
          }}
        >
          <Plus className="w-3.5 h-3.5" />
          New map
        </Link>
      </div>

      {/* ── Tab bar ── */}
      <TabBar active={tab} onChange={setTab} />

      {/* ── Tab content ── */}
      {tab === 'maps' && (
        <MapsTab projectId={projectId} workspaceId={workspaceId} />
      )}
      {tab === 'datasets' && <DatasetsTab projectId={projectId} />}
      {tab === 'annotations' && <AnnotationsTab />}
      {tab === 'automations' && <AutomationsTab projectId={projectId} workspaceId={workspaceId} />}
      {tab === 'activity' && <ActivityTab />}
      {tab === 'members' && <MembersTab projectId={projectId} />}
    </div>
  );
}

// ── Mock data (replaced when API is wired) ───────────────────────────────────

const MOCK_MAPS: ProjectMap[] = [
  {
    id: 'm1', project_id: 'p1', organization_id: 'o1',
    name: 'Amazon Canopy Density 2024',
    description: 'NDVI-based canopy density monitoring across study sectors',
    created_by: 'u1', created_at: '2024-01-15T10:00:00Z', updated_at: '2024-03-12T14:22:00Z',
  },
  {
    id: 'm2', project_id: 'p1', organization_id: 'o1',
    name: 'Deforestation Alert Zones',
    description: 'AI-detected active clearing events Q1 2024',
    created_by: 'u1', created_at: '2024-02-01T09:00:00Z', updated_at: '2024-03-10T11:00:00Z',
  },
  {
    id: 'm3', project_id: 'p1', organization_id: 'o1',
    name: 'Sentinel-2 Mosaic Mar 2024',
    description: 'Cloud-free median composite',
    created_by: 'u2', created_at: '2024-03-01T08:00:00Z', updated_at: '2024-03-08T16:00:00Z',
  },
  {
    id: 'm4', project_id: 'p1', organization_id: 'o1',
    name: 'Fire Perimeter Tracking',
    description: 'Active fire fronts and burn scar analysis',
    created_by: 'u2', created_at: '2024-01-20T10:00:00Z', updated_at: '2024-03-05T09:30:00Z',
  },
  {
    id: 'm5', project_id: 'p1', organization_id: 'o1',
    name: 'Biomass Estimation Survey',
    description: null,
    created_by: 'u1', created_at: '2024-02-15T10:00:00Z', updated_at: '2024-03-01T12:00:00Z',
  },
];

const MOCK_DATASETS: Dataset[] = [
  {
    id: 'd1', organization_id: 'o1',
    name: 'Sentinel-2 Amazon Basin 2024', stac_collection_id: 'sentinel-2-l2a',
    dataset_type: 'imagery', status: 'ready',
    geometry: null,
    temporal_extent: { lower: '2024-01-01T00:00:00Z', upper: '2024-03-31T00:00:00Z', bounds: '[)' },
    metadata: { file_count: 1240 },
    description: null, created_by: null,
    created_at: '2024-01-10T10:00:00Z', updated_at: '2024-03-31T12:00:00Z', deleted_at: null,
  },
  {
    id: 'd2', organization_id: 'o1',
    name: 'LIDAR Point Cloud — Sector 4', stac_collection_id: null,
    dataset_type: 'imagery', status: 'ready',
    geometry: null,
    temporal_extent: { lower: '2024-02-01T00:00:00Z', upper: '2024-02-01T00:00:00Z', bounds: '[)' },
    metadata: { file_count: 342 },
    description: null, created_by: null,
    created_at: '2024-02-05T10:00:00Z', updated_at: '2024-02-20T10:00:00Z', deleted_at: null,
  },
  {
    id: 'd3', organization_id: 'o1',
    name: 'Field Observation Points — Team Alpha', stac_collection_id: null,
    dataset_type: 'imagery', status: 'ingesting',
    geometry: null, temporal_extent: null, metadata: { file_count: 89 },
    description: null, created_by: null,
    created_at: '2024-03-10T10:00:00Z', updated_at: '2024-03-13T08:00:00Z', deleted_at: null,
  },
];

const ANNOTATION_STATS = [
  { value: '14,302', label: 'Total annotations' },
  { value: '8,441', label: 'Approved' },
  { value: '23', label: 'Label classes' },
];

const SOURCE_BREAKDOWN = [
  { label: 'Manual', count: 6820, pct: 48 },
  { label: 'AI model', count: 5910, pct: 41 },
  { label: 'Imported', count: 1572, pct: 11 },
];

const LABEL_CLASSES = [
  { label: 'Canopy', color: '#414833', count: 5120, pct: 36 },
  { label: 'Cleared land', color: '#b35e4c', count: 3840, pct: 27 },
  { label: 'Water body', color: '#4a7a80', count: 2180, pct: 15 },
  { label: 'Secondary growth', color: '#656d4a', count: 1820, pct: 13 },
  { label: 'Other', color: '#9a8878', count: 1342, pct: 9 },
];

const MOCK_ACTIVITY: Array<{
  id: string; job_type: string; status: JobStatus;
  map_name?: string; detail?: string; time: string;
}> = [
  { id: 'a1', job_type: 'inference', status: 'completed', map_name: 'Amazon Canopy Density 2024', detail: '6,241 detections — 98.2% confidence', time: '2h ago' },
  { id: 'a2', job_type: 'ingest', status: 'completed', map_name: 'Sentinel-2 Mosaic Mar 2024', detail: 'Sentinel-2 L2A — 412 items', time: '5h ago' },
  { id: 'a3', job_type: 'analysis', status: 'running', map_name: 'Deforestation Alert Zones', detail: 'Change detection vs. Jan 2023 baseline', time: 'now' },
  { id: 'a4', job_type: 'export', status: 'completed', map_name: 'Amazon Canopy Density 2024', detail: 'Annotation set A — 312 items as GeoJSON', time: '1d ago' },
  { id: 'a5', job_type: 'bulk_update', status: 'failed', map_name: 'Fire Perimeter Tracking', detail: 'Error: geometry validation failed (3 records)', time: '2d ago' },
];

const MOCK_MEMBERS: ProjectMember[] = [
  { project_id: 'p1', user_id: 'u1', role: 'admin',  user: { id: 'u1', email: 'alice@lab.org',  name: 'Alice Ferreira' } },
  { project_id: 'p1', user_id: 'u2', role: 'member', user: { id: 'u2', email: 'mario@lab.org',  name: 'Mario Santos'   } },
  { project_id: 'p1', user_id: 'u3', role: 'member', user: { id: 'u3', email: 'priya@lab.org',  name: 'Priya Nair'    } },
  { project_id: 'p1', user_id: 'u4', role: 'viewer', user: { id: 'u4', email: 'james@ngos.org', name: 'James Webb'    } },
];
