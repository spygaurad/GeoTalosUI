'use client';

import { use } from 'react';
import { useOrganization } from '@clerk/nextjs';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle } from 'lucide-react';
import { qk } from '@/lib/query-keys';
import { trackingApi } from '@/lib/api/tracking';
import type { TrackedObject, TrackedObjectStatus, Priority } from '@/types/api';

interface PageProps {
  params: Promise<{ id: string }>;
}

const PRIORITY_COLOR: Record<Priority, string> = {
  critical: 'bg-red-100 text-red-700',
  high: 'bg-orange-100 text-orange-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-gray-100 text-gray-600',
};

const STATUS_COLOR: Record<TrackedObjectStatus, string> = {
  active: 'text-emerald-600',
  resolved: 'text-gray-400',
  archived: 'text-gray-400',
  merged: 'text-blue-500',
};

export default function ProjectTrackingPage({ params }: PageProps) {
  const { id } = use(params);
  const { organization } = useOrganization();
  const orgId = organization?.id ?? '';

  const { data, isLoading } = useQuery({
    queryKey: qk.tracking.list({ project_id: id }),
    queryFn: () => trackingApi.list({ project_id: id }),
    enabled: !!orgId,
  });

  const objects = data?.items ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Tracked Objects</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Persistent geo-entities monitored over time in this project.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="bg-white rounded-xl border border-primary-100 p-4 flex items-center gap-4 animate-pulse"
            >
              <div className="w-8 h-8 bg-gray-100 rounded-lg flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-gray-100 rounded w-1/4" />
                <div className="h-3 bg-gray-100 rounded w-1/3" />
              </div>
              <div className="h-6 bg-gray-100 rounded-full w-16" />
            </div>
          ))}
        </div>
      ) : objects.length === 0 ? (
        <div className="bg-white rounded-xl border border-primary-100 p-12 text-center">
          <div className="w-12 h-12 bg-primary-50 rounded-xl flex items-center justify-center mx-auto mb-4">
            <Activity className="w-6 h-6 text-primary-600" />
          </div>
          <h3 className="text-sm font-semibold text-gray-900 mb-1">No tracked objects</h3>
          <p className="text-sm text-gray-500">
            Tracked objects are created automatically from model inference or manually on the map.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-primary-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Object</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide hidden sm:table-cell">Type</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Priority</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide hidden md:table-cell">Observations</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide hidden lg:table-cell">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {objects.map((obj) => (
                <TrackedObjectRow key={obj.id} obj={obj} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TrackedObjectRow({ obj }: { obj: TrackedObject }) {
  return (
    <tr className="hover:bg-gray-50 transition-colors cursor-pointer">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-primary-50 rounded-lg flex items-center justify-center flex-shrink-0">
            <Activity className="w-3.5 h-3.5 text-primary-600" />
          </div>
          <span className="font-medium text-gray-900 text-xs font-mono truncate max-w-[120px]">
            {obj.id.slice(0, 8)}…
          </span>
        </div>
      </td>
      <td className="px-4 py-3 text-xs text-gray-600 hidden sm:table-cell">
        {obj.object_type.replace(/_/g, ' ')}
      </td>
      <td className="px-4 py-3">
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${PRIORITY_COLOR[obj.priority]}`}>
          {obj.priority}
        </span>
      </td>
      <td className="px-4 py-3 text-xs text-gray-600 hidden md:table-cell">
        {obj.observation_count}
      </td>
      <td className={`px-4 py-3 text-xs font-medium hidden lg:table-cell ${STATUS_COLOR[obj.status]}`}>
        {obj.status}
      </td>
    </tr>
  );
}
