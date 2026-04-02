'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home,
  Map,
  FolderOpen,
  Satellite,
  PenTool,
  Tags,
  Bot,
  Zap,
  Bell,
  Settings,
  Cpu,
  TreePine,
  Plus,
} from 'lucide-react';
import { OrganizationSwitcher, UserButton } from '@clerk/nextjs';

const SECTIONS = [
  {
    label: 'Explore',
    items: [
      { title: 'Dashboard', href: '', icon: Home },
      { title: 'Map Explorer', href: '/map', icon: Map },
    ],
  },
  {
    label: 'Data',
    items: [
      { title: 'Projects', href: '/projects', icon: FolderOpen },
      { title: 'Datasets', href: '/datasets', icon: Satellite },
      { title: 'Annotation Schemas', href: '/annotation-schemas', icon: PenTool },
      { title: 'Annotation Sets', href: '/annotation-sets', icon: Tags },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { title: 'AI Models', href: '/models', icon: Bot },
      { title: 'Inference', href: '/inference', icon: Zap },
    ],
  },
  {
    label: 'Operations',
    items: [
      { title: 'Jobs', href: '/jobs', icon: Cpu, badge: '1' },
      { title: 'Settings', href: '/settings', icon: Settings },
    ],
  },
];

// Shared dark-mode variables for all Clerk popovers in the sidebar
const CLERK_DARK_VARS = {
  colorBackground: '#232b1f',
  colorText: '#f5ede0',
  colorTextSecondary: 'rgba(245,237,224,0.6)',
  colorInputBackground: '#2e3828',
  colorInputText: '#f5ede0',
  colorNeutral: '#f5ede0',
  colorPrimary: '#c4985c',
  colorShimmer: 'rgba(255,255,255,0.04)',
} as const;

interface AppSidebarProps {
  workspaceId: string;
}

export function AppSidebar({ workspaceId }: AppSidebarProps) {
  const pathname = usePathname();
  const base = `/workspace/${workspaceId}`;

  return (
    <aside
      className="flex flex-col shrink-0 h-screen overflow-hidden"
      style={{
        width: '228px',
        backgroundColor: '#2e3428',
        borderRight: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      {/* ── Logo ── */}
      <div
        className="flex items-center gap-2.5 px-4 h-12 shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}
      >
        <TreePine className="w-4 h-4 shrink-0" style={{ color: '#c4985c' }} />
        <span
          style={{
            fontSize: '0.9375rem',
            fontWeight: 600,
            color: '#f5ede0',
            letterSpacing: '-0.01em',
          }}
        >
          AwakeForest
        </span>
      </div>

      {/* ── Org Switcher ── */}
      <div
        className="px-3 py-2 shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        <OrganizationSwitcher
          appearance={{
            variables: CLERK_DARK_VARS,
            elements: {
              rootBox: 'w-full',
              // Trigger button
              organizationSwitcherTrigger:
                'w-full rounded-md px-2 py-1.5 hover:bg-white/5 transition-colors justify-start gap-2 text-[#f5ede0]',
              organizationSwitcherTriggerIcon: 'text-[#c4985c] opacity-70',
              // Org name/avatar in trigger
              organizationPreviewTextContainer: 'text-[#f5ede0]',
              organizationPreviewMainIdentifier:
                'text-[0.8125rem] font-medium text-[#f5ede0]',
              organizationPreviewSecondaryIdentifier:
                'text-[0.6875rem] text-[rgba(245,237,224,0.5)]',
              // Popover card
              organizationSwitcherPopoverCard:
                'bg-[#232b1f] border border-white/10 shadow-2xl rounded-xl',
              organizationSwitcherPopoverRootBox: 'bg-[#232b1f]',
              // List items inside popover
              organizationListPreviewButton:
                'hover:bg-white/6 rounded-lg text-[#f5ede0]',
              organizationListPreviewItem: 'rounded-lg',
              organizationListPreviewItemActionButton:
                'text-[rgba(245,237,224,0.6)] hover:text-[#f5ede0]',
              // Action buttons (Create org, etc.)
              organizationSwitcherPopoverActionButton:
                'text-[rgba(245,237,224,0.75)] hover:bg-white/5 hover:text-[#f5ede0] rounded-lg',
              organizationSwitcherPopoverActionButtonIcon: 'text-[#c4985c]',
              organizationSwitcherPopoverActionButtonText:
                'text-[0.8125rem]',
              // Footer
              organizationSwitcherPopoverFooter: 'border-t border-white/8',
              // Notifications badge
              notificationBadge: 'bg-[#7f5539] text-[#f5ede0]',
            },
          }}
        />
      </div>

      {/* ── Navigation ── */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
        {SECTIONS.map((section) => (
          <div key={section.label}>
            <p
              className="px-2 mb-1"
              style={{
                fontSize: '0.625rem',
                fontWeight: 600,
                letterSpacing: '0.09em',
                textTransform: 'uppercase',
                color: 'rgba(196,152,92,0.5)',
              }}
            >
              {section.label}
            </p>

            <div className="space-y-0.5">
              {section.items.map((item) => {
                const href = `${base}${item.href}`;
                const isActive =
                  item.href === ''
                    ? pathname === base || pathname === `${base}/`
                    : pathname === href || pathname.startsWith(`${href}/`);

                return (
                  <Link
                    key={item.title}
                    href={href}
                    className="relative flex items-center justify-between h-8 px-2 rounded-md transition-colors"
                    style={{
                      backgroundColor: isActive
                        ? 'rgba(255,255,255,0.08)'
                        : 'transparent',
                      // Bumped inactive opacity 0.50 → 0.78 for readability
                      color: isActive ? '#f5ede0' : 'rgba(245,237,224,0.78)',
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive)
                        (e.currentTarget as HTMLElement).style.backgroundColor =
                          'rgba(255,255,255,0.05)';
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive)
                        (e.currentTarget as HTMLElement).style.backgroundColor =
                          'transparent';
                    }}
                  >
                    {isActive && (
                      <span
                        className="absolute left-0 top-1/2 -translate-y-1/2 rounded-r-full"
                        style={{
                          width: '2.5px',
                          height: '18px',
                          backgroundColor: '#c4985c',
                        }}
                      />
                    )}
                    <span className="flex items-center gap-2.5">
                      <item.icon
                        className="w-3.5 h-3.5 shrink-0"
                        style={{
                          // Bumped inactive opacity 0.45 → 0.65
                          color: isActive
                            ? '#c4985c'
                            : 'rgba(196,152,92,0.65)',
                        }}
                      />
                      <span
                        style={{
                          fontSize: '0.8125rem',
                          fontWeight: isActive ? 500 : 400,
                        }}
                      >
                        {item.title}
                      </span>
                    </span>

                    {item.badge && (
                      <span
                        style={{
                          fontSize: '0.625rem',
                          fontWeight: 600,
                          padding: '1px 5px',
                          borderRadius: '4px',
                          backgroundColor: 'rgba(196,152,92,0.18)',
                          color: '#c4985c',
                        }}
                      >
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* ── User ── */}
      {/*
        UserButton with showName makes the entire row (avatar + name) a single
        clickable button that opens Clerk's account/profile popover.
        The appearance variables force the popover to use the same dark palette.
      */}
      <div
        className="px-3 py-3 shrink-0"
        style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
      >
        <UserButton
          showName
          appearance={{
            variables: CLERK_DARK_VARS,
            elements: {
              // Make the outer box fill the sidebar width
              rootBox: 'w-full',
              userButtonBox:
                'w-full flex-row gap-2.5 px-1 py-1 rounded-md hover:bg-white/5 transition-colors',
              // Avatar
              avatarBox: 'w-6 h-6 shrink-0',
              // Name next to avatar
              userButtonOuterIdentifier:
                'text-[0.8125rem] text-[rgba(245,237,224,0.78)] font-normal truncate',
              // Chevron icon
              userButtonTrigger: 'w-full focus-visible:shadow-none',
              // Popover card
              userButtonPopoverCard:
                'bg-[#232b1f] border border-white/10 shadow-2xl rounded-xl',
              userButtonPopoverActionButton:
                'text-[rgba(245,237,224,0.8)] hover:bg-white/5 hover:text-[#f5ede0] rounded-lg',
              userButtonPopoverActionButtonIcon: 'text-[#c4985c]',
              userButtonPopoverFooter: 'border-t border-white/8',
              userPreviewMainIdentifier: 'text-[#f5ede0] font-medium',
              userPreviewSecondaryIdentifier:
                'text-[rgba(245,237,224,0.55)] text-[0.75rem]',
            },
          }}
        />
      </div>
    </aside>
  );
}
