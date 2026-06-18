'use client';

import { use } from 'react';
import { useOrganization } from '@clerk/nextjs';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Database, Plus, CheckCircle2, AlertCircle, Clock, Loader2 } from 'lucide-react';
import { qk } from '@/lib/query-keys';
import { datasetsApi } from '@/lib/api/datasets';
import type { Dataset, DatasetStatus } from '@/types/api';

interface PageProps {
  params: Promise<{ id: string }>;
}

const STATUS_CONFIG: Record<DatasetStatus, { label: string; icon: typeof Clock; color: string }> = {
  pending: { label: 'Pending', icon: Clock, color: 'text-gray-400' },
  ingesting: { label: 'Ingesting', icon: Loader2, color: 'text-blue-500' },
  ready: { label: 'Ready', icon: CheckCircle2, color: 'text-emerald-500' },
  failed: { label: 'Failed', icon: AlertCircle, color: 'text-red-500' },
};

export default function ProjectDatasetsPage({ params }: PageProps) {
  const { id } = use(params);
  const { organization } = useOrganization();
  const orgId = organization?.id ?? '';

  const { data, isLoading } = useQuery({
    queryKey: qk.datasets.list({ project_id: id }),
    queryFn: () => datasetsApi.list({ project_id: id }),
    enabled: !!orgId,
  });

  const datasets = data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Datasets</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Satellite imagery collections in this project.
          </p>
        </div>
        <button className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
          <Plus className="w-4 h-4" />
          Ingest Dataset
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-white rounded-xl border border-primary-100 p-4 flex items-center gap-4 animate-pulse"
            >
              <div className="w-8 h-8 bg-gray-100 rounded-lg flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-gray-100 rounded w-1/3" />
                <div className="h-3 bg-gray-100 rounded w-1/2" />
              </div>
              <div className="h-6 bg-gray-100 rounded w-16" />
            </div>
          ))}
        </div>
      ) : datasets.length === 0 ? (
        <div className="bg-white rounded-xl border border-primary-100 p-12 text-center">
          <div className="w-12 h-12 bg-primary-50 rounded-xl flex items-center justify-center mx-auto mb-4">
            <Database className="w-6 h-6 text-primary-600" />
          </div>
          <h3 className="text-sm font-semibold text-gray-900 mb-1">No datasets yet</h3>
          <p className="text-sm text-gray-500 mb-4">
            Ingest your first satellite imagery dataset to get started.
          </p>
          <button className="inline-flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
            <Plus className="w-4 h-4" />
            Ingest Dataset
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-primary-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Name</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide hidden sm:table-cell">Items</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide hidden md:table-cell">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide hidden lg:table-cell">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {datasets.map((dataset) => (
                <DatasetRow key={dataset.id} dataset={dataset} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DatasetRow({ dataset }: { dataset: Dataset }) {
  const status = STATUS_CONFIG[dataset.status];
  const StatusIcon = status.icon;
  const created = new Date(dataset.created_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <tr className="hover:bg-gray-50 transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-primary-50 rounded-lg flex items-center justify-center flex-shrink-0">
            <Database className="w-3.5 h-3.5 text-primary-600" />
          </div>
          <div className="min-w-0">
            <p className="font-medium text-gray-900 truncate">{dataset.name}</p>
            {dataset.description && (
              <p className="text-xs text-gray-400 truncate">{dataset.description}</p>
            )}
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-gray-600 hidden sm:table-cell">{dataset.metadata?.file_count ?? 0}</td>
      <td className="px-4 py-3 hidden md:table-cell">
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${status.color}`}>
          <StatusIcon className="w-3.5 h-3.5" />
          {status.label}
        </span>
      </td>
      <td className="px-4 py-3 text-xs text-gray-400 hidden lg:table-cell">{created}</td>
      <td className="px-4 py-3 text-right">
        <Link
          href={`/datasets/${dataset.id}`}
          className="text-xs text-primary-600 hover:text-primary-700 font-medium"
        >
          Open
        </Link>
      </td>
    </tr>
  );
}
