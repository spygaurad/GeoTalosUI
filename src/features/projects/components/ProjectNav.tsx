'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Map } from 'lucide-react';
import clsx from 'clsx';

const TABS = [
  { label: 'Overview', href: '' },
  { label: 'Datasets', href: '/datasets' },
  { label: 'Models', href: '/models' },
  { label: 'Object Schema Definitions', href: '/schemas' },
  { label: 'Temporal Analysis', href: '/analysis' },
  { label: 'Tracking', href: '/tracking' },
  { label: 'Jobs', href: '/jobs' },
  { label: 'Automations', href: '/automations' },
  { label: 'Alerts', href: '/alerts' },
  { label: 'Reports', href: '/reports' },
  { label: 'Settings', href: '/settings' },
] as const;

interface ProjectNavProps {
  projectId: string;
}

export default function ProjectNav({ projectId }: ProjectNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const base = `/projects/${projectId}`;

  function isActive(tabHref: string) {
    const full = base + tabHref;
    if (tabHref === '') return pathname === base;
    return pathname === full || pathname.startsWith(full + '/');
  }

  return (
    <div className="sticky top-12 z-20 bg-white border-b border-gray-200">
      <div className="flex items-center justify-between gap-4 px-4 sm:px-6">
        {/* Scrollable tabs */}
        <nav className="flex items-center gap-0.5 overflow-x-auto scrollbar-none -mb-px">
          {TABS.map((tab) => {
            const active = isActive(tab.href);
            return (
              <Link
                key={tab.href}
                href={base + tab.href}
                className={clsx(
                  'whitespace-nowrap px-3 py-3 text-sm font-medium border-b-2 transition-colors flex-shrink-0',
                  active
                    ? 'border-primary-600 text-primary-700'
                    : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>

        {/* Project Map CTA */}
        <button
          onClick={() => router.push(`/map?project=${projectId}`)}
          className="flex-shrink-0 flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors shadow-sm"
        >
          <Map className="w-4 h-4" />
          <span className="hidden sm:inline">Project Map</span>
        </button>
      </div>
    </div>
  );
}
