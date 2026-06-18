'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Search,
  Play,
  Pause,
  Calendar,
  Zap,
  Hand,
  Clock,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Archive,
  FileEdit,
  Pencil,
  Copy,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Pipeline, PipelineStatus, PipelineTriggerType } from '@/types/api';
import { automationApi } from '@/lib/api/automation';
import { qk } from '@/lib/query-keys';

// ── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

const STATUS_CONFIG: Record<PipelineStatus, { label: string; color: string; bg: string; icon: typeof Play }> = {
  active:   { label: 'Active',   color: '#656d4a', bg: '#eef0e8', icon: Play },
  draft:    { label: 'Draft',    color: '#9a8878', bg: '#f3f0eb', icon: FileEdit },
  paused:   { label: 'Paused',   color: '#a68a64', bg: '#f8f2e8', icon: Pause },
  archived: { label: 'Archived', color: '#b0a090', bg: '#f0ece6', icon: Archive },
};

const TRIGGER_CONFIG: Record<PipelineTriggerType, { label: string; icon: typeof Calendar }> = {
  manual:   { label: 'Manual',   icon: Hand },
  schedule: { label: 'Schedule', icon: Calendar },
  event:    { label: 'Event',    icon: Zap },
};

const RUN_STATUS_CONFIG: Record<string, { color: string; icon: typeof CheckCircle2 }> = {
  completed: { color: '#656d4a', icon: CheckCircle2 },
  failed:    { color: '#b35e4c', icon: XCircle },
  running:   { color: '#a68a64', icon: Clock },
  pending:   { color: '#9a8878', icon: Clock },
};

// ── Status badge ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: PipelineStatus }) {
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full"
      style={{ fontSize: '0.6875rem', fontWeight: 500, color: cfg.color, backgroundColor: cfg.bg }}
    >
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

// ── Pipeline card ───────────────────────────────────────────────────────────

function PipelineCard({
  pipeline,
  workspaceId,
  projectId,
}: {
  pipeline: Pipeline;
  workspaceId: string;
  projectId: string;
}) {
  const queryClient = useQueryClient();
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(pipeline.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const trigger = TRIGGER_CONFIG[pipeline.trigger_type];
  const TriggerIcon = trigger.icon;

  useEffect(() => {
    if (editing) {
      setDraft(pipeline.name);
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [editing, pipeline.name]);

  const commitRename = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== pipeline.name) {
      automationApi.updatePipeline(pipeline.id, { name: trimmed }).then(() => {
        queryClient.invalidateQueries({ queryKey: qk.automation.pipelines({ project_id: projectId }) });
      });
    }
    setEditing(false);
  };

  const handleDuplicate = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    automationApi.duplicatePipeline(pipeline.id).then(() => {
      queryClient.invalidateQueries({ queryKey: qk.automation.pipelines({ project_id: projectId }) });
      toast.success('Pipeline duplicated');
    }).catch((err) => {
      toast.error(`Duplicate failed: ${(err as Error).message}`);
    });
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete "${pipeline.name}"? This cannot be undone.`)) return;
    automationApi.deletePipeline(pipeline.id).then(() => {
      queryClient.invalidateQueries({ queryKey: qk.automation.pipelines({ project_id: projectId }) });
      toast.success('Pipeline deleted');
    }).catch((err) => {
      toast.error(`Delete failed: ${(err as Error).message}`);
    });
  };

  const cardContent = (
    <div className="px-5 py-4">
      {/* Top row */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0 pr-3">
          {editing ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setEditing(false);
              }}
              onBlur={commitRename}
              onClick={(e) => e.preventDefault()}
              className="outline-none rounded px-1.5 py-0.5 w-full"
              style={{
                fontSize: '0.9375rem',
                fontWeight: 600,
                color: '#2e3428',
                backgroundColor: '#f5ede0',
                border: '1px solid #c4985c',
              }}
            />
          ) : (
            <div className="flex items-center gap-1.5 group/name">
              <h3
                className="truncate"
                style={{
                  fontSize: '0.9375rem',
                  fontWeight: 600,
                  color: hovered ? '#7f5539' : '#2e3428',
                  transition: 'color 0.15s',
                  marginBottom: '4px',
                }}
              >
                {pipeline.name}
              </h3>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setEditing(true);
                }}
                className="p-0.5 rounded opacity-0 group-hover/name:opacity-100 hover:bg-[#ede0d4] transition-opacity"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9a8878' }}
                title="Rename"
              >
                <Pencil className="w-3 h-3" />
              </button>
            </div>
          )}
          {pipeline.description && (
            <p
              className="line-clamp-2"
              style={{ fontSize: '0.8125rem', color: '#8a7868', lineHeight: 1.4 }}
            >
              {pipeline.description}
            </p>
          )}
        </div>
        <StatusBadge status={pipeline.status} />
      </div>

      {/* Meta row */}
      <div
        className="flex items-center gap-4 mt-3 pt-3"
        style={{ borderTop: '1px solid #ede0d4', fontSize: '0.75rem', color: '#9a8878' }}
      >
        <span className="flex items-center gap-1.5">
          <TriggerIcon className="w-3 h-3" style={{ color: '#c4985c' }} />
          {trigger.label}
        </span>

        {pipeline.last_run_status && (
          <span className="flex items-center gap-1.5">
            {(() => {
              const runCfg = RUN_STATUS_CONFIG[pipeline.last_run_status] ?? RUN_STATUS_CONFIG.pending;
              const RunIcon = runCfg.icon;
              return (
                <>
                  <RunIcon className="w-3 h-3" style={{ color: runCfg.color }} />
                  <span>
                    Last run {relativeTime(pipeline.last_run_at)}
                  </span>
                </>
              );
            })()}
          </span>
        )}

        {pipeline.node_count > 0 && (
          <span className="flex items-center gap-1">
            {pipeline.node_count} node{pipeline.node_count !== 1 ? 's' : ''}
          </span>
        )}

        <span className="flex items-center gap-1.5 ml-auto">
          <Clock className="w-3 h-3" />
          {relativeTime(pipeline.updated_at)}
        </span>

        <button
          onClick={handleDuplicate}
          className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-[#ede0d4] transition-all"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9a8878' }}
          title="Duplicate"
        >
          <Copy className="w-3 h-3" />
        </button>
        <button
          onClick={handleDelete}
          className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-[#f8ece8] transition-all"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b35e4c' }}
          title="Delete"
        >
          <Trash2 className="w-3 h-3" />
        </button>

        <ArrowRight
          className="w-3.5 h-3.5 shrink-0 transition-transform"
          style={{
            color: hovered ? '#7f5539' : '#c4b09c',
            transform: hovered ? 'translateX(2px)' : 'translateX(0)',
            transition: 'all 0.2s',
          }}
        />
      </div>
    </div>
  );

  return (
    <Link
      href={`/workspace/${workspaceId}/projects/${projectId}/automations/${pipeline.id}`}
      className="group block rounded-xl transition-all"
      style={{
        border: `1px solid ${hovered ? '#c4985c' : '#e0d4c4'}`,
        backgroundColor: hovered ? '#fefbf7' : '#fff9f4',
        textDecoration: 'none',
        boxShadow: hovered ? '0 2px 12px rgba(127,85,57,0.08)' : 'none',
        transition: 'all 0.2s cubic-bezier(0.2,0,0,1)',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={(e) => { if (editing) e.preventDefault(); }}
    >
      {cardContent}
    </Link>
  );
}

// ── Loading skeleton ─────────────────────────────────────────────────────────

function PipelineSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="rounded-xl animate-pulse"
          style={{ border: '1px solid #e0d4c4', backgroundColor: '#fff9f4' }}
        >
          <div className="px-5 py-4">
            <div className="flex items-start justify-between mb-3">
              <div className="flex-1">
                <div className="h-4 rounded" style={{ width: '40%', backgroundColor: '#ede0d4' }} />
                <div className="h-3 rounded mt-2" style={{ width: '70%', backgroundColor: '#f0ebe4' }} />
              </div>
              <div className="h-5 w-16 rounded-full" style={{ backgroundColor: '#f0ebe4' }} />
            </div>
            <div style={{ borderTop: '1px solid #ede0d4' }} className="pt-3 mt-3">
              <div className="h-3 rounded" style={{ width: '50%', backgroundColor: '#f0ebe4' }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Empty state ─────────────────────────────────────────────────────────────

function EmptyState({ workspaceId, projectId }: { workspaceId: string; projectId: string }) {
  return (
    <div className="py-20 text-center">
      <div
        className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
        style={{ backgroundColor: '#ede0d4' }}
      >
        <Zap className="w-6 h-6" style={{ color: '#7f5539' }} />
      </div>
      <p
        style={{
          fontFamily: 'var(--font-display, Georgia, serif)',
          fontSize: '1.5rem',
          color: '#2e3428',
          marginBottom: '8px',
        }}
      >
        No automation pipelines
      </p>
      <p style={{ fontSize: '0.875rem', color: '#9a8878', marginBottom: '24px', maxWidth: '420px', margin: '0 auto 24px' }}>
        Build visual workflows to automate inference, quality checks, change detection, and more.
      </p>
      <Link
        href={`/workspace/${workspaceId}/projects/${projectId}/automations/new`}
        className="inline-flex items-center gap-2 rounded-xl font-semibold"
        style={{
          backgroundColor: '#7f5539',
          color: '#f5ede0',
          padding: '0.75rem 1.5rem',
          fontSize: '0.875rem',
        }}
      >
        <Plus className="w-4 h-4" />
        Create first pipeline
      </Link>
    </div>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────

export function AutomationsContent({ workspaceId, projectId }: { workspaceId: string; projectId: string }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<PipelineStatus | 'all'>('all');

  const { data, isLoading } = useQuery({
    queryKey: qk.automation.pipelines({ project_id: projectId }),
    queryFn: () => automationApi.listPipelines({ project_id: projectId }),
  });

  const allPipelines = data?.items ?? [];

  const pipelines = allPipelines.filter((p) => {
    if (statusFilter !== 'all' && p.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        (p.description ?? '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const statusCounts = allPipelines.reduce(
    (acc, p) => {
      acc[p.status] = (acc[p.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div
      className="max-w-4xl mx-auto py-10 px-10"
      style={{ fontFamily: 'var(--font-sans, system-ui)' }}
    >
      {/* Header */}
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1
            style={{
              fontFamily: 'var(--font-display, Georgia, serif)',
              fontSize: 'clamp(1.75rem, 3vw, 2.25rem)',
              fontWeight: 700,
              color: '#2e3428',
              lineHeight: 1.1,
              marginBottom: '4px',
            }}
          >
            Automations
          </h1>
          <p style={{ fontSize: '0.8125rem', color: '#9a8878' }}>
            {isLoading ? '...' : `${allPipelines.length} pipeline${allPipelines.length !== 1 ? 's' : ''}`}
          </p>
        </div>

        <Link
          href={`/workspace/${workspaceId}/projects/${projectId}/automations/new`}
          className="inline-flex items-center gap-1.5 rounded-lg font-semibold transition-all hover:opacity-90"
          style={{
            backgroundColor: '#7f5539',
            color: '#f5ede0',
            padding: '0.5rem 1rem',
            fontSize: '0.8125rem',
          }}
        >
          <Plus className="w-3.5 h-3.5" />
          New pipeline
        </Link>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6">
        <div
          className="flex items-center gap-2 flex-1 px-3 rounded-lg"
          style={{ border: '1px solid #d4c0a8', backgroundColor: '#fdf5ec' }}
        >
          <Search className="w-3.5 h-3.5 shrink-0" style={{ color: '#9a8878' }} />
          <input
            type="search"
            placeholder="Search pipelines..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent py-2 outline-none"
            style={{ fontSize: '0.875rem', color: '#2e3428' }}
          />
        </div>

        <div className="flex gap-1">
          {(['all', 'active', 'draft', 'paused', 'archived'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className="px-2.5 py-1.5 rounded-md transition-colors"
              style={{
                fontSize: '0.75rem',
                fontWeight: 500,
                backgroundColor: statusFilter === s ? '#7f5539' : 'transparent',
                color: statusFilter === s ? '#f5ede0' : '#9a8878',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              {s === 'all' ? 'All' : STATUS_CONFIG[s].label}
              {s !== 'all' && statusCounts[s] ? ` (${statusCounts[s]})` : ''}
            </button>
          ))}
        </div>
      </div>

      {/* Pipeline list */}
      {isLoading ? (
        <PipelineSkeleton />
      ) : pipelines.length === 0 && !search && statusFilter === 'all' ? (
        <EmptyState workspaceId={workspaceId} projectId={projectId} />
      ) : pipelines.length === 0 ? (
        <p style={{ fontSize: '0.875rem', color: '#9a8878', paddingTop: '2rem' }}>
          No pipelines match your filters.
        </p>
      ) : (
        <div className="space-y-3">
          {pipelines.map((pipeline) => (
            <PipelineCard
              key={pipeline.id}
              pipeline={pipeline}
              workspaceId={workspaceId}
              projectId={projectId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
