'use client';

import Link from 'next/link';
import { OrganizationSwitcher, UserButton } from '@clerk/nextjs';

export default function TopNav() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-white/90 backdrop-blur border-b border-primary-100 topnav-compact">
      <div className="container-compact h-full flex items-center justify-between">
        {/* Left: Logo */}
        <Link href="/dashboard" className="flex items-center gap-2.5 group">
          <img
            src="/GeoTalos_mark.png"
            alt="GeoTalos"
            className="h-8 w-auto object-contain select-none"
          />
          <span className="font-semibold text-sm text-gray-900 group-hover:text-primary-600 transition-colors">
            GeoTALOS
          </span>
        </Link>

        {/* Right: Org switcher + User menu */}
        <div className="flex items-center gap-3">
          <OrganizationSwitcher
            afterCreateOrganizationUrl="/dashboard"
            afterLeaveOrganizationUrl="/select-org"
            afterSelectOrganizationUrl="/dashboard"
            appearance={{
              variables: { colorPrimary: '#8c6d2c' },
              elements: {
                rootBox: 'flex items-center',
                organizationSwitcherTrigger:
                  'px-3 py-1.5 text-sm rounded-lg border border-primary-200 hover:bg-primary-50 transition-colors',
              },
            }}
          />
          <UserButton
            appearance={{
              variables: { colorPrimary: '#8c6d2c' },
              elements: {
                avatarBox: 'w-7 h-7',
              },
            }}
          />
        </div>
      </div>
    </header>
  );
}
