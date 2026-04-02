import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import {
  Map,
  Database,
  Tag,
  Cpu,
  Activity,
  Bell,
  Briefcase,
  ArrowRight,
} from 'lucide-react';

export default async function DashboardPage() {
  const { userId } = await auth();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-description">
          Welcome back. Here&apos;s an overview of your workspace.
        </p>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {STATS.map((s) => (
          <div
            key={s.label}
            className="bg-white rounded-xl border border-primary-100 p-4 space-y-1"
          >
            <p className="text-2xl font-bold text-primary-700">{s.value}</p>
            <p className="text-xs text-gray-500">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Quick links */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Quick access</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {QUICK_LINKS.map((link) => (
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

      {/* Recent jobs placeholder */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Recent jobs</h2>
        <div className="bg-white border border-primary-100 rounded-xl divide-y divide-gray-50">
          {[1, 2, 3].map((i) => (
            <div key={i} className="px-4 py-3 flex items-center gap-3 animate-pulse">
              <div className="w-2 h-2 bg-primary-200 rounded-full flex-shrink-0" />
              <div className="h-3 bg-gray-100 rounded flex-1 max-w-xs" />
              <div className="h-3 bg-gray-100 rounded w-16 ml-auto" />
            </div>
          ))}
          <div className="px-4 py-3 text-center">
            <Link href="/jobs" className="text-xs text-primary-600 hover:text-primary-700 font-medium">
              View all jobs
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

const STATS = [
  { label: 'Active Projects', value: '—' },
  { label: 'Datasets', value: '—' },
  { label: 'Annotations', value: '—' },
  // { label: 'Jobs Running', value: '0' },
];

const QUICK_LINKS = [
  // { href: '/map', icon: Map, label: 'Map Explorer', desc: 'Explore layers & data' },
  { href: '/datasets', icon: Database, label: 'Datasets', desc: 'Manage your data' },
  { href: '/annotations', icon: Tag, label: 'Annotations', desc: 'Review & annotate' },
  { href: '/models', icon: Cpu, label: 'Models', desc: 'Registry & inference' },
  // { href: '/tracking', icon: Activity, label: 'Tracking', desc: 'Tracked objects' },
  // { href: '/alerts', icon: Bell, label: 'Alerts', desc: 'Subscriptions & feed' },
  // { href: '/jobs', icon: Briefcase, label: 'Jobs', desc: 'Queue & progress' },
];
