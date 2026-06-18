'use client';

import { use } from 'react';
import { useOrganization } from '@clerk/nextjs';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Database, Activity, Bell, Briefcase, Zap, Map, ArrowRight } from 'lucide-react';
import { qk } from '@/lib/query-keys';
import { datasetsApi } from '@/lib/api/datasets';
import { trackingApi } from '@/lib/api/tracking';
import { alertsApi } from '@/lib/api/alerts';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function ProjectOverviewPage({ params }: PageProps) {
  const { id } = use(params);
  const { organization } = useOrganization();
  const orgId = organization?.id ?? '';

  const { data: datasets } = useQuery({
    queryKey: qk.datasets.list({ project_id: id }),
    queryFn: () => datasetsApi.list({ project_id: id }),
    enabled: !!orgId,
  });

  const { data: tracking } = useQuery({
    queryKey: qk.tracking.list({ project_id: id }),
    queryFn: () => trackingApi.list({ project_id: id }),
    enabled: !!orgId,
  });

  const { data: alerts } = useQuery({
    queryKey: qk.alerts.list({ status: 'open' }),
    queryFn: () => alertsApi.list({ status: 'open' }),
    enabled: !!orgId,
  });

  const stats = [
    {
      label: 'Datasets',
      value: datasets?.total ?? '—',
      icon: Database,
      href: `/projects/${id}/datasets`,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      label: 'Tracked Objects',
      value: tracking?.total ?? '—',
      icon: Activity,
      href: `/projects/${id}/tracking`,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
    },
    {
      label: 'Open Alerts',
      value: alerts?.total ?? '—',
      icon: Bell,
      href: `/projects/${id}/alerts`,
      color: 'text-amber-600',
      bg: 'bg-amber-50',
    },
    {
      label: 'Jobs',
      value: '—',
      icon: Briefcase,
      href: `/projects/${id}/jobs`,
      color: 'text-purple-600',
      bg: 'bg-purple-50',
    },
  ];

  const quickLinks = [
    {
      label: 'Ingest Dataset',
      desc: 'Add satellite imagery to this project',
      href: `/projects/${id}/datasets`,
      icon: Database,
    },
    {
      label: 'Run Inference',
      desc: 'Apply an ML model to your data',
      href: `/projects/${id}/models`,
      icon: Zap,
    },
    {
      label: 'View on Map',
      desc: 'Explore layers and annotations spatially',
      href: `/map?project=${id}`,
      icon: Map,
    },
    {
      label: 'Automations',
      desc: 'Schedule triggers and pipelines',
      href: `/projects/${id}/automations`,
      icon: Zap,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {stats.map((stat) => (
          <Link
            key={stat.label}
            href={stat.href}
            className="group bg-white rounded-xl border border-primary-100 p-4 hover:border-primary-300 hover:shadow-sm transition-all"
          >
            <div className="flex items-center justify-between mb-2">
              <div className={`w-8 h-8 ${stat.bg} rounded-lg flex items-center justify-center`}>
                <stat.icon className={`w-4 h-4 ${stat.color}`} />
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-primary-400 transition-colors" />
            </div>
            <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{stat.label}</p>
          </Link>
        ))}
      </div>

      {/* Quick actions */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Quick actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {quickLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="group flex items-center gap-3 bg-white border border-primary-100 rounded-xl p-4 hover:border-primary-300 hover:shadow-sm transition-all"
            >
              <div className="w-9 h-9 bg-primary-50 rounded-lg flex items-center justify-center flex-shrink-0 group-hover:bg-primary-100 transition-colors">
                <link.icon className="w-4 h-4 text-primary-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{link.label}</p>
                <p className="text-xs text-gray-500 truncate">{link.desc}</p>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-primary-400 transition-colors flex-shrink-0" />
            </Link>
          ))}
        </div>
      </div>

      {/* Recent jobs */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700">Recent jobs</h2>
          <Link
            href={`/projects/${id}/jobs`}
            className="text-xs text-primary-600 hover:text-primary-700 font-medium"
          >
            View all
          </Link>
        </div>
        <div className="bg-white border border-primary-100 rounded-xl divide-y divide-gray-50">
          {[1, 2, 3].map((i) => (
            <div key={i} className="px-4 py-3 flex items-center gap-3 animate-pulse">
              <div className="w-2 h-2 bg-primary-200 rounded-full flex-shrink-0" />
              <div className="h-3 bg-gray-100 rounded flex-1 max-w-xs" />
              <div className="h-3 bg-gray-100 rounded w-16 ml-auto" />
            </div>
          ))}
          <div className="px-4 py-3 text-center text-xs text-gray-400">
            Job history coming soon
          </div>
        </div>
      </div>
    </div>
  );
}
