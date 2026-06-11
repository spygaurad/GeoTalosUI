'use client';

import { createContext, useContext, ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import clsx from 'clsx';
import {
  Map,
  Folder,
  Database,
  Tag,
  Activity,
  BarChart3,
  Bell,
  Cpu,
  Zap,
  Briefcase,
  Settings,
  LayoutDashboard,
} from 'lucide-react';
import { useHoverableSidebar } from '@/hooks/use-hoverable-sidebar';
import SidebarNavItem from './SidebarNavItem';

const SidebarContext = createContext<{ isExpanded: boolean }>({ isExpanded: false });
export const useSidebarContext = () => useContext(SidebarContext);

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { key: 'projects', label: 'Projects', href: '/projects', icon: Folder },
  { key: 'datasets', label: 'Datasets', href: '/datasets', icon: Database },
  { key: 'models', label: 'Models', href: '/models', icon: Cpu },
  // { key: 'map', label: 'Map Explorer', href: '/map', icon: Map },
  // { key: 'annotations', label: 'Annotations', href: '/annotations', icon: Tag },
  // { key: 'tracking', label: 'Tracking', href: '/tracking', icon: Activity },
  // { key: 'analysis', label: 'Analysis', href: '/analysis', icon: BarChart3 },
  // { key: 'alerts', label: 'Alerts', href: '/alerts', icon: Bell },
  // { key: 'inference', label: 'Inference', href: '/inference/new', icon: Zap },
  // { key: 'jobs', label: 'Jobs', href: '/jobs', icon: Briefcase },
  // { key: 'settings', label: 'Settings', href: '/settings', icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { isExpanded, width, handleMouseEnter, handleMouseLeave } = useHoverableSidebar();

  return (
    <SidebarContext.Provider value={{ isExpanded }}>
      <div
        className="fixed left-0 z-40 hidden sm:block"
        style={{ top: 48, height: 'calc(100vh - 48px)' }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {/* hover buffer */}
        <div
          className="absolute top-0 h-full"
          style={{ left: 64, width: 12, pointerEvents: isExpanded ? 'none' : 'auto' }}
        />

        <aside
          className={clsx(
            'bg-gray-900 text-white border-r border-gray-800 h-full overflow-hidden',
            'transition-[width] duration-200 ease-out flex flex-col'
          )}
          style={{ width }}
        >
          <div className="flex-1 overflow-y-auto">
            <nav className="p-2 space-y-0.5">
              {NAV_ITEMS.map((item) => (
                <SidebarNavItem
                  key={item.key}
                  icon={item.icon}
                  label={item.label}
                  isActive={
                    item.href === '/dashboard'
                      ? pathname === '/dashboard'
                      : pathname === item.href || pathname.startsWith(item.href + '/')
                  }
                  onClick={() => router.push(item.href)}
                />
              ))}
            </nav>
          </div>
        </aside>
      </div>
    </SidebarContext.Provider>
  );
}
