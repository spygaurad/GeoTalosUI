'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  X,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  RotateCcw,
  Ban,
} from 'lucide-react';
import { automationApi } from '@/lib/api/automation';
import { qk } from '@/lib/query-keys';
import type { PipelineRun } from '@/types/api';
import { RunResultsModal } from './RunResultsModal';

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; color: string; bg: string; icon: typeof Clock }> = {
  pending:   { label: 'Pending',   color: '#9a8878', bg: '#f3f0eb', icon: Clock },
  running:   { label: 'Running',   color: '#a68a64', bg: '#f8f2e8', icon: Loader2 },
  completed: { label: 'Completed', color: '#656d4a', bg: '#eef0e8', icon: CheckCircle2 },
  failed:    { label: 'Failed',    color: '#b35e4c', bg: '#f8ece8', icon: XCircle },
  cancelled: { label: 'Cancelled', color: '#9a8878', bg: '#f0ece6', icon: Ban },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.pending;
  const Icon = cfg.icon;
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full"
      style={{ fontSize: '0.625rem', fontWeight: 500, color: cfg.color, backgroundColor: cfg.bg }}
    >
      <Icon className={`w-2.5 h-2.5 ${status === 'running' ? 'animate-spin' : ''}`} />
      {cfg.label}
    </span>
  );
}

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return '—';
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

// ── Runs panel ──────────────────────────────────────────────────────────────

interface RunsPanelProps {
  pipelineId: string;
  onClose: () => void;
}

export function RunsPanel({ pipelineId, onClose }: RunsPanelProps) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: qk.automation.pipelineRuns(pipelineId),
    queryFn: () => automationApi.listPipelineRuns(pipelineId),
    refetchInterval: 10000,
  });

  const runs = data?.items ?? [];

  return (
    <div
      className="flex flex-col h-full"
      style={{
        width: '280px',
        backgroundColor: '#fefcf9',
        borderLeft: '1px solid #e0d4c4',
      }}
    >
      {selectedRunId && (
        <RunResultsModal runId={selectedRunId} onClose={() => setSelectedRunId(null)} />
      )}
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 shrink-0"
        style={{ height: '40px', borderBottom: '1px solid #ede0d4' }}
      >
        <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#2e3428' }}>
          Run History
        </span>
        <button
          onClick={onClose}
          className="p-1 rounded-md transition-colors hover:bg-[#ede0d4]"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9a8878' }}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Run list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-4 h-4 animate-spin" style={{ color: '#9a8878' }} />
          </div>
        ) : isError ? (
          <div className="px-3 py-8 text-center">
            <p style={{ fontSize: '0.75rem', color: '#b35e4c', marginBottom: '4px' }}>
              Failed to load runs
            </p>
            <p style={{ fontSize: '0.6875rem', color: '#9a8878' }}>
              Check your connection
            </p>
          </div>
        ) : runs.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <RotateCcw className="w-5 h-5 mx-auto mb-2" style={{ color: '#d4c0a8' }} />
            <p style={{ fontSize: '0.75rem', color: '#9a8878' }}>No runs yet</p>
            <p style={{ fontSize: '0.6875rem', color: '#b0a090', marginTop: '2px' }}>
              Click Run to execute this pipeline
            </p>
          </div>
        ) : (
          <div>
            {runs.map((run) => (
              <RunRow key={run.id} run={run} onClick={() => setSelectedRunId(run.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RunRow({ run, onClick }: { run: PipelineRun; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="w-full text-left px-3 py-2.5 transition-colors"
      style={{
        background: hovered ? '#fdf5ec' : 'none',
        border: 'none',
        borderBottom: '1px solid #f5ede0',
        cursor: 'pointer',
      }}
    >
      <div className="flex items-center justify-between mb-1">
        <span style={{ fontSize: '0.6875rem', color: '#6b5d4e', fontFamily: 'monospace' }}>
          {run.id.slice(0, 8)}
        </span>
        <StatusBadge status={run.status} />
      </div>
      <div className="flex items-center justify-between">
        <span style={{ fontSize: '0.6875rem', color: '#9a8878' }}>
          {relativeTime(run.started_at ?? run.created_at)}
        </span>
        {run.total_steps > 0 && (
          <span style={{ fontSize: '0.625rem', color: '#b0a090' }}>
            {run.completed_steps}/{run.total_steps} steps
          </span>
        )}
      </div>
      {run.status === 'running' && run.progress > 0 && (
        <div className="mt-1 rounded-full overflow-hidden" style={{ height: '2px', backgroundColor: '#ede0d4' }}>
          <div
            className="h-full rounded-full"
            style={{ width: `${run.progress * 100}%`, backgroundColor: '#a68a64' }}
          />
        </div>
      )}
    </button>
  );
}
