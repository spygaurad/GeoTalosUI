'use client';

import { LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { useSidebarContext } from './Sidebar';

interface SidebarNavItemProps {
  icon: LucideIcon;
  label: string;
  isActive: boolean;
  onClick: () => void;
}

export default function SidebarNavItem({
  icon: Icon,
  label,
  isActive,
  onClick,
}: SidebarNavItemProps) {
  const { isExpanded } = useSidebarContext();

  return (
    <button
      onClick={onClick}
      className={clsx(
        'group w-full flex items-center rounded-md h-9 transition-colors relative overflow-hidden',
        isExpanded ? 'px-3' : 'px-2 justify-center',
        isActive
          ? 'bg-primary-600 text-white'
          : 'text-gray-300 hover:bg-gray-800 hover:text-white'
      )}
      title={!isExpanded ? label : undefined}
    >
      <Icon
        className={clsx(
          'flex-shrink-0 transition-all duration-200',
          isExpanded ? 'w-4 h-4' : 'w-5 h-5'
        )}
      />
      <span
        className={clsx(
          'text-sm font-medium whitespace-nowrap transition-all duration-200',
          isExpanded
            ? 'ml-3 opacity-100 translate-x-0'
            : 'ml-0 opacity-0 -translate-x-2 absolute'
        )}
      >
        {label}
      </span>
    </button>
  );
}
