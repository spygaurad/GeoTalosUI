'use client';

import { use } from 'react';
import { useQueries } from '@tanstack/react-query';
import { Briefcase, CheckCircle2, XCircle, Loader2, Clock, Ban } from 'lucide-react';
import { qk } from '@/lib/query-keys';
import { jobsApi } from '@/lib/api/jobs';
import { useJobStore } from '@/store/jobStore';
import type { Job, JobStatus } from '@/types/common';

interface PageProps {
  params: Promise<{ id: string }>;
}

const STATUS_CONFIG: Record<JobStatus, { label: string; icon: typeof Clock; color: string }> = {
  pending: { label: 'Pending', icon: Clock, color: 'text-gray-400' },
  queued: { label: 'Queued', icon: Clock, color: 'text-blue-400' },
  running: { label: 'Running', icon: Loader2, color: 'text-blue-600' },
  completed: { label: 'Completed', icon: CheckCircle2, color: 'text-emerald-500' },
  failed: { label: 'Failed', icon: XCircle, color: 'text-red-500' },
  cancelled: { label: 'Cancelled', icon: Ban, color: 'text-gray-400' },
};

export default function ProjectJobsPage({ params }: PageProps) {
  // params.id used for layout context only — jobs are org-scoped via JWT
  use(params);

  const activeJobIds = useJobStore((s) => s.activeJobIds);

  // Poll each tracked job individually (backend only exposes GET /jobs/{id})
  const jobQueries = useQueries({
    queries: activeJobIds.map((jobId) => ({
      queryKey: qk.jobs.detail(jobId),
      queryFn: () => jobsApi.get(jobId),
      refetchInterval: (query: { state: { data?: Job } }) => {
        const status = query.state.data?.status;
        return status === 'running' || status === 'queued' || status === 'pending'
          ? 3000
          : false;
      },
    })),
  });

  const jobs = jobQueries.map((q) => q.data).filter((j): j is Job => !!j);
  const isLoading = jobQueries.some((q) => q.isLoading) && activeJobIds.length > 0;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Jobs</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Async job queue for ingest, inference, analysis, and export.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-white rounded-xl border border-primary-100 p-4 flex items-center gap-4 animate-pulse"
            >
              <div className="w-2 h-2 bg-gray-200 rounded-full flex-shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-4 bg-gray-100 rounded w-1/3" />
                <div className="h-3 bg-gray-100 rounded w-1/4" />
              </div>
              <div className="h-6 bg-gray-100 rounded w-20" />
            </div>
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <div className="bg-white rounded-xl border border-primary-100 p-12 text-center">
          <div className="w-12 h-12 bg-primary-50 rounded-xl flex items-center justify-center mx-auto mb-4">
            <Briefcase className="w-6 h-6 text-primary-600" />
          </div>
          <h3 className="text-sm font-semibold text-gray-900 mb-1">No active jobs</h3>
          <p className="text-sm text-gray-500">
            Jobs appear here when you ingest datasets, run inference, or trigger analysis.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-primary-100 divide-y divide-gray-50">
          {jobs.map((job) => (
            <JobRow key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}

function JobRow({ job }: { job: Job }) {
  const status = STATUS_CONFIG[job.status];
  const StatusIcon = status.icon;
  const progressPct = Math.round(job.progress * 100);
  const created = new Date(job.created_at).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="px-4 py-3 flex items-center gap-3">
      <StatusIcon
        className={`w-4 h-4 flex-shrink-0 ${status.color} ${job.status === 'running' ? 'animate-spin' : ''}`}
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900">
            {job.job_type.replace(/_/g, ' ')}
          </span>
          <span className="text-xs text-gray-400 font-mono">{job.id.slice(0, 8)}</span>
        </div>
        {job.status === 'running' && (
          <div className="mt-1 h-1 bg-gray-100 rounded-full overflow-hidden w-32">
            <div
              className="h-full bg-primary-500 rounded-full transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        )}
        {job.error && (
          <p className="text-xs text-red-500 truncate mt-0.5">{job.error}</p>
        )}
      </div>

      <div className="flex items-center gap-3 flex-shrink-0">
        {job.status === 'running' && (
          <span className="text-xs text-blue-600 font-medium">{progressPct}%</span>
        )}
        <span className="text-xs text-gray-400">{created}</span>
        <span className={`text-xs font-medium ${status.color}`}>{status.label}</span>
      </div>
    </div>
  );
}
