'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  X,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  ChevronRight,
  ChevronDown,
  RotateCcw,
  Ban,
  Download,
  StopCircle,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { automationApi } from '@/lib/api/automation';
import { qk } from '@/lib/query-keys';
import type { PipelineRun, PipelineRunStep } from '@/types/api';

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

function formatDuration(ms: number | null): string {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

// ── Step row with expandable inspector (#15) ─────────────────────────────────

function StepRow({ step, runId }: { step: PipelineRunStep; runId: string }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = STATUS_CFG[step.status] ?? STATUS_CFG.pending;
  const Icon = cfg.icon;

  const hasOutput = step.status === 'completed' && step.output_data && Object.keys(step.output_data).length > 0;
  const hasDownload = !!(hasOutput && (
    step.output_data?.download_url || step.output_data?.s3_key || step.output_data?.file_url
  ));

  return (
    <div style={{ borderBottom: '1px solid #f5ede0' }}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-start gap-2 px-3 py-2 w-full text-left transition-colors hover:bg-[#fdf5ec]"
        style={{ background: 'none', border: 'none', cursor: 'pointer' }}
      >
        <div
          className="flex items-center justify-center shrink-0 rounded-full mt-0.5"
          style={{ width: '18px', height: '18px', backgroundColor: cfg.bg }}
        >
          <Icon className={`w-2.5 h-2.5 ${step.status === 'running' ? 'animate-spin' : ''}`} style={{ color: cfg.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <span
              className="truncate"
              style={{ fontSize: '0.75rem', fontWeight: 500, color: '#2e3428' }}
            >
              {step.node_label ?? step.node_type}
            </span>
            <div className="flex items-center gap-1">
              <span style={{ fontSize: '0.625rem', color: '#b0a090' }}>
                {formatDuration(step.duration_ms)}
              </span>
              {(step.input_data || step.output_data || step.error) && (
                <ChevronDown
                  className="w-2.5 h-2.5 transition-transform"
                  style={{
                    color: '#b0a090',
                    transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                  }}
                />
              )}
            </div>
          </div>
          {step.error && !expanded && (
            <p
              className="mt-0.5 line-clamp-1"
              style={{ fontSize: '0.6875rem', color: '#b35e4c', lineHeight: 1.3 }}
            >
              {step.error}
            </p>
          )}
        </div>
      </button>

      {/* Expanded inspector */}
      {expanded && (
        <div className="px-3 pb-2" style={{ paddingLeft: '34px' }}>
          {step.error && (
            <div className="mb-2">
              <p style={{ fontSize: '0.5625rem', fontWeight: 600, textTransform: 'uppercase', color: '#b35e4c', marginBottom: '2px' }}>
                Error
              </p>
              <p style={{ fontSize: '0.6875rem', color: '#b35e4c', lineHeight: 1.3, wordBreak: 'break-word' }}>
                {step.error}
              </p>
            </div>
          )}

          {step.input_data && Object.keys(step.input_data).length > 0 && (
            <div className="mb-2">
              <p style={{ fontSize: '0.5625rem', fontWeight: 600, textTransform: 'uppercase', color: '#9a8878', marginBottom: '2px' }}>
                Input
              </p>
              <pre
                className="overflow-x-auto rounded"
                style={{
                  fontSize: '0.5625rem',
                  color: '#6b5d4e',
                  backgroundColor: '#f5ede0',
                  padding: '4px 6px',
                  lineHeight: 1.4,
                  maxHeight: '80px',
                  overflowY: 'auto',
                }}
              >
                {JSON.stringify(step.input_data, null, 2)}
              </pre>
            </div>
          )}

          {hasOutput && (
            <div className="mb-2">
              <p style={{ fontSize: '0.5625rem', fontWeight: 600, textTransform: 'uppercase', color: '#9a8878', marginBottom: '2px' }}>
                Output
              </p>
              <pre
                className="overflow-x-auto rounded"
                style={{
                  fontSize: '0.5625rem',
                  color: '#6b5d4e',
                  backgroundColor: '#f5ede0',
                  padding: '4px 6px',
                  lineHeight: 1.4,
                  maxHeight: '80px',
                  overflowY: 'auto',
                }}
              >
                {JSON.stringify(step.output_data, null, 2)}
              </pre>
            </div>
          )}

          {/* Download button (#10) */}
          {hasDownload && (
            <a
              href={String(step.output_data!.download_url ?? step.output_data!.file_url ?? '')}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2 py-1 rounded transition-colors hover:bg-[#ede0d4]"
              style={{
                fontSize: '0.625rem',
                fontWeight: 500,
                color: '#7f5539',
                border: '1px solid #d4c0a8',
                textDecoration: 'none',
                cursor: 'pointer',
              }}
            >
              <Download className="w-2.5 h-2.5" />
              Download output
            </a>
          )}

          {step.config && Object.keys(step.config).length > 0 && (
            <div>
              <p style={{ fontSize: '0.5625rem', fontWeight: 600, textTransform: 'uppercase', color: '#9a8878', marginBottom: '2px' }}>
                Config
              </p>
              <pre
                className="overflow-x-auto rounded"
                style={{
                  fontSize: '0.5625rem',
                  color: '#6b5d4e',
                  backgroundColor: '#f5ede0',
                  padding: '4px 6px',
                  lineHeight: 1.4,
                  maxHeight: '60px',
                  overflowY: 'auto',
                }}
              >
                {JSON.stringify(step.config, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Run detail (steps) ───────────────────────────────────────────────────────

function RunDetail({ runId, onBack }: { runId: string; onBack: () => void }) {
  const queryClient = useQueryClient();

  const { data: run } = useQuery({
    queryKey: qk.automation.runDetail(runId),
    queryFn: () => automationApi.getRunDetail(runId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'running' || status === 'pending' ? 3000 : false;
    },
  });

  const { data: steps } = useQuery({
    queryKey: qk.automation.runSteps(runId),
    queryFn: () => automationApi.getRunSteps(runId),
    refetchInterval: (query) => {
      const hasActive = query.state.data?.some(
        (s) => s.status === 'running' || s.status === 'pending',
      );
      return hasActive ? 3000 : false;
    },
  });

  // Cancel mutation (#11)
  const cancelMutation = useMutation({
    mutationFn: () => automationApi.cancelRun(runId),
    onSuccess: () => {
      toast.success('Run cancelled');
      queryClient.invalidateQueries({ queryKey: qk.automation.runDetail(runId) });
      queryClient.invalidateQueries({ queryKey: qk.automation.runSteps(runId) });
    },
    onError: (err) => toast.error(`Cancel failed: ${(err as Error).message}`),
  });

  // Retry mutation (#11)
  const retryMutation = useMutation({
    mutationFn: () => automationApi.retryRun(runId),
    onSuccess: () => {
      toast.success('Run retried');
      queryClient.invalidateQueries({ queryKey: qk.automation.runDetail(runId) });
      queryClient.invalidateQueries({ queryKey: qk.automation.runSteps(runId) });
    },
    onError: (err) => toast.error(`Retry failed: ${(err as Error).message}`),
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 px-3 py-2 text-left transition-colors hover:bg-[#f5ede0]"
        style={{
          fontSize: '0.75rem',
          fontWeight: 500,
          color: '#7f5539',
          background: 'none',
          border: 'none',
          borderBottom: '1px solid #ede0d4',
          cursor: 'pointer',
        }}
      >
        <ChevronRight className="w-3 h-3 rotate-180" />
        Back to runs
      </button>

      {/* Run info */}
      {run && (
        <div className="px-3 py-2" style={{ borderBottom: '1px solid #ede0d4' }}>
          <div className="flex items-center justify-between mb-1">
            <span style={{ fontSize: '0.6875rem', color: '#9a8878', fontFamily: 'monospace' }}>
              {run.id.slice(0, 8)}
            </span>
            <StatusBadge status={run.status} />
          </div>
          {run.started_at && (
            <p style={{ fontSize: '0.6875rem', color: '#9a8878' }}>
              Started {relativeTime(run.started_at)}
            </p>
          )}
          {run.progress > 0 && run.status === 'running' && (
            <div className="mt-1.5 rounded-full overflow-hidden" style={{ height: '3px', backgroundColor: '#ede0d4' }}>
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${run.progress * 100}%`, backgroundColor: '#a68a64' }}
              />
            </div>
          )}

          {/* Cancel / Retry buttons (#11) */}
          <div className="flex items-center gap-1.5 mt-2">
            {(run.status === 'running' || run.status === 'pending') && (
              <button
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
                className="inline-flex items-center gap-1 px-2 py-1 rounded transition-colors hover:bg-[#f8ece8]"
                style={{
                  fontSize: '0.625rem',
                  fontWeight: 500,
                  color: '#b35e4c',
                  border: '1px solid #e0c4b8',
                  background: 'none',
                  cursor: cancelMutation.isPending ? 'default' : 'pointer',
                }}
              >
                {cancelMutation.isPending
                  ? <Loader2 className="w-2.5 h-2.5 animate-spin" />
                  : <StopCircle className="w-2.5 h-2.5" />
                }
                Cancel
              </button>
            )}
            {run.status === 'failed' && (
              <button
                onClick={() => retryMutation.mutate()}
                disabled={retryMutation.isPending}
                className="inline-flex items-center gap-1 px-2 py-1 rounded transition-colors hover:bg-[#f5ede0]"
                style={{
                  fontSize: '0.625rem',
                  fontWeight: 500,
                  color: '#7f5539',
                  border: '1px solid #d4c0a8',
                  background: 'none',
                  cursor: retryMutation.isPending ? 'default' : 'pointer',
                }}
              >
                {retryMutation.isPending
                  ? <Loader2 className="w-2.5 h-2.5 animate-spin" />
                  : <RefreshCw className="w-2.5 h-2.5" />
                }
                Retry
              </button>
            )}
          </div>
        </div>
      )}

      {/* Steps */}
      <div className="flex-1 overflow-y-auto">
        {!steps ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-4 h-4 animate-spin" style={{ color: '#9a8878' }} />
          </div>
        ) : steps.length === 0 ? (
          <p className="px-3 py-6 text-center" style={{ fontSize: '0.75rem', color: '#9a8878' }}>
            No steps yet
          </p>
        ) : (
          <div className="py-1">
            {steps.map((step) => (
              <StepRow key={step.id} step={step} runId={runId} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
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

  if (selectedRunId) {
    return (
      <div
        className="flex flex-col h-full"
        style={{
          width: '280px',
          backgroundColor: '#fefcf9',
          borderLeft: '1px solid #e0d4c4',
        }}
      >
        <RunDetail runId={selectedRunId} onBack={() => setSelectedRunId(null)} />
      </div>
    );
  }

  return (
    <div
      className="flex flex-col h-full"
      style={{
        width: '280px',
        backgroundColor: '#fefcf9',
        borderLeft: '1px solid #e0d4c4',
      }}
    >
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
