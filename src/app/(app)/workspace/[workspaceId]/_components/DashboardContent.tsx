'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  X,
  ArrowRight,
  Clock,
  Map,
  Plus,
} from 'lucide-react';
import { mapsApi } from '@/lib/api/maps';
import { projectsApi } from '@/lib/api/projects';
import { qk } from '@/lib/query-keys';

// ── Topographic thumbnail generator ──────────────────────────────────────────

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

const PALETTES = [
  { bg: '#2e3428', contour: '#c4985c', blob1: '#414833', blob2: '#4a5240', accent: '#7f5539' },
  { bg: '#3a2c1e', contour: '#d4b896', blob1: '#5a3e2a', blob2: '#6b4c33', accent: '#a68a64' },
  { bg: '#1e2e28', contour: '#a8c4a0', blob1: '#2a4030', blob2: '#365040', accent: '#656d4a' },
  { bg: '#28241c', contour: '#c4b480', blob1: '#3a3420', blob2: '#48422a', accent: '#7a6d4a' },
];

function TopoThumbnail({ name, className, style }: { name: string; className?: string; style?: React.CSSProperties }) {
  const seed = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const rng = seededRandom(seed);
  const pal = PALETTES[seed % PALETTES.length];

  const cx = 50 + rng() * 60 - 30;
  const cy = 50 + rng() * 40 - 20;
  const radii = [60, 47, 35, 24, 14].map((r) => r + rng() * 8 - 4);

  const blobs = Array.from({ length: 3 }, () => ({
    cx: 30 + rng() * 80,
    cy: 25 + rng() * 60,
    rx: 12 + rng() * 20,
    ry: 10 + rng() * 18,
  }));

  const boxX = 25 + rng() * 50;
  const boxY = 20 + rng() * 40;

  return (
    <svg
      viewBox="0 0 160 110"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <rect width="160" height="110" fill={pal.bg} />
      {blobs.map((b, i) => (
        <ellipse key={i} cx={b.cx} cy={b.cy} rx={b.rx} ry={b.ry}
          fill={i % 2 === 0 ? pal.blob1 : pal.blob2} opacity={0.85 + i * 0.05} />
      ))}
      {radii.map((r, i) => (
        <ellipse key={i} cx={cx} cy={cy} rx={r} ry={r * 0.7}
          fill="none" stroke={pal.contour} strokeWidth="0.5"
          opacity={0.12 + i * 0.06} />
      ))}
      <rect x={boxX} y={boxY} width={22 + rng() * 15} height={16 + rng() * 10}
        fill="none" stroke={pal.contour} strokeWidth="0.6"
        strokeDasharray="2.5 1.5" opacity="0.45" />
      <line x1="10" y1="100" x2="30" y2="100" stroke={pal.contour} strokeWidth="1" opacity="0.3" />
      <line x1="10" y1="97" x2="10" y2="103" stroke={pal.contour} strokeWidth="0.8" opacity="0.3" />
      <line x1="30" y1="97" x2="30" y2="103" stroke={pal.contour} strokeWidth="0.8" opacity="0.3" />
      <circle cx={cx} cy={cy} r="2.5" fill={pal.contour} opacity="0.6" />
      <circle cx={cx} cy={cy} r="1" fill={pal.bg} />
    </svg>
  );
}

// ── Relative time ─────────────────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ── Map card skeleton ─────────────────────────────────────────────────────────

function MapCardSkeleton() {
  return (
    <div
      className="shrink-0 flex flex-col rounded-xl overflow-hidden"
      style={{ width: '200px', border: '1px solid #d4c0a8', backgroundColor: '#fff9f4' }}
    >
      <div style={{ height: '120px', backgroundColor: '#e8d5b8' }} />
      <div className="px-3 py-2.5 space-y-2">
        <div style={{ height: '12px', width: '70%', backgroundColor: '#e8d5b8', borderRadius: '4px' }} />
        <div style={{ height: '10px', width: '50%', backgroundColor: '#f0e4d4', borderRadius: '4px' }} />
      </div>
    </div>
  );
}

// ── Greeting ──────────────────────────────────────────────────────────────────

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

// ── Dashboard ────────────────────────────────────────────────────────────────

interface DashboardContentProps {
  workspaceId: string;
  firstName: string;
}

export function DashboardContent({ workspaceId, firstName }: DashboardContentProps) {
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  const base = `/workspace/${workspaceId}`;

  // Fetch all recent maps (no project filter → org-wide)
  const { data: mapsData, isLoading: mapsLoading } = useQuery({
    queryKey: qk.maps.list(),
    queryFn: () => mapsApi.list(),
  });

  // Fetch projects to show "no project" state
  const { data: projectsData } = useQuery({
    queryKey: qk.projects.list(),
    queryFn: () => projectsApi.list(),
  });

  const maps = mapsData?.items ?? [];
  const hasProjects = (projectsData?.total ?? 0) > 0;
  const recentMaps = maps.slice(0, 5);

  return (
    <div
      className="max-w-5xl mx-auto py-10 px-10"
      style={{ fontFamily: 'var(--font-sans, system-ui)' }}
    >
      {/* ── Header ── */}
      <div className="flex items-start justify-between mb-10">
        <div>
          <p
            style={{
              fontSize: '0.75rem',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: '#9a8878',
              marginBottom: '4px',
            }}
          >
            {getGreeting()}
          </p>
          <h1
            style={{
              fontFamily: 'var(--font-display, Georgia, serif)',
              fontSize: 'clamp(1.75rem, 3vw, 2.25rem)',
              fontWeight: 700,
              color: '#2e3428',
              lineHeight: 1.1,
            }}
          >
            {firstName}.
          </h1>
        </div>
      </div>

      {/* ── Welcome strip (dismissable) ── */}
      {!welcomeDismissed && !hasProjects && (
        <div
          className="flex items-start justify-between gap-4 rounded-xl mb-10 px-5 py-4"
          style={{ backgroundColor: '#ede0d4', border: '1px solid #d4c0a8' }}
        >
          <div className="flex-1">
            <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#2e3428', marginBottom: '6px' }}>
              Welcome to GeoTalos
            </p>
            <div className="flex items-center gap-6">
              {[
                { step: '01', label: 'Create a project', href: `${base}/projects/new` },
                { step: '02', label: 'Upload a dataset', href: `${base}/datasets` },
                { step: '03', label: 'Create a map', href: `${base}/map/new` },
              ].map((item) => (
                <Link
                  key={item.step}
                  href={item.href}
                  className="inline-flex items-center gap-1.5 transition-opacity hover:opacity-70"
                  style={{ fontSize: '0.8125rem', color: '#7f5539' }}
                >
                  <span style={{ fontSize: '0.625rem', fontFamily: 'monospace', color: '#9a8878', minWidth: '18px' }}>
                    {item.step}
                  </span>
                  {item.label}
                  <ArrowRight className="w-3 h-3" aria-hidden="true" />
                </Link>
              ))}
            </div>
          </div>
          <button
            onClick={() => setWelcomeDismissed(true)}
            aria-label="Dismiss welcome"
            className="shrink-0 transition-opacity hover:opacity-60"
            style={{ color: '#9a8878', marginTop: '1px', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── Recent maps ── */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2
            style={{
              fontSize: '0.75rem',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: '#9a8878',
            }}
          >
            Recent maps
          </h2>
          <Link
            href={`${base}/projects`}
            style={{ fontSize: '0.8125rem', color: '#7f5539' }}
            className="transition-opacity hover:opacity-70"
          >
            All projects
          </Link>
        </div>

        <div className="flex gap-4 overflow-x-auto pb-2" style={{ scrollbarWidth: 'thin' }}>
          {mapsLoading ? (
            Array.from({ length: 3 }).map((_, i) => <MapCardSkeleton key={i} />)
          ) : recentMaps.length === 0 ? (
            <div
              className="flex items-center gap-3 rounded-xl px-5 py-4"
              style={{ border: '1px solid #d4c0a8', backgroundColor: '#fff9f4', minWidth: '280px' }}
            >
              <Map className="w-4 h-4 shrink-0" style={{ color: '#c4b09c' }} aria-hidden="true" />
              <div>
                <p style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#4a3d30', marginBottom: '2px' }}>
                  No maps yet
                </p>
                <Link
                  href={`${base}/map/new`}
                  style={{ fontSize: '0.75rem', color: '#7f5539' }}
                  className="transition-opacity hover:opacity-70"
                >
                  Create your first map →
                </Link>
              </div>
            </div>
          ) : (
            recentMaps.map((map) => (
              <Link
                key={map.id}
                href={`${base}/projects/${map.project_id}/maps/${map.id}`}
                className="group shrink-0 flex flex-col rounded-xl overflow-hidden transition-all hover:shadow-md"
                style={{
                  width: '200px',
                  border: '1px solid #d4c0a8',
                  backgroundColor: '#fff9f4',
                  textDecoration: 'none',
                }}
              >
                <div className="relative overflow-hidden" style={{ height: '120px' }}>
                  <TopoThumbnail
                    name={map.name}
                    className="w-full h-full transition-transform group-hover:scale-105"
                    style={{ transition: 'transform 0.35s cubic-bezier(0.2,0,0,1)' }}
                  />
                  <div
                    className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ backgroundColor: 'rgba(46,52,40,0.35)' }}
                  >
                    <span
                      className="rounded-lg px-3 py-1"
                      style={{ fontSize: '0.75rem', fontWeight: 600, backgroundColor: '#f5ede0', color: '#2e3428' }}
                    >
                      Open
                    </span>
                  </div>
                </div>

                <div className="px-3 py-2.5">
                  <p
                    className="truncate"
                    style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#2e3428', marginBottom: '2px' }}
                  >
                    {map.name}
                  </p>
                  <div
                    className="flex items-center gap-1 mt-1.5"
                    style={{ fontSize: '0.6875rem', color: '#b0a090' }}
                  >
                    <Clock className="w-3 h-3" aria-hidden="true" />
                    {relativeTime(map.updated_at)}
                  </div>
                </div>
              </Link>
            ))
          )}

          {/* New map card */}
          <Link
            href={`${base}/map/new`}
            className="shrink-0 flex flex-col items-center justify-center rounded-xl transition-all hover:shadow-md"
            style={{
              width: '200px',
              height: recentMaps.length === 0 ? '80px' : '183px',
              border: '1.5px dashed #d4c0a8',
              color: '#9a8878',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = '#7f5539';
              (e.currentTarget as HTMLElement).style.color = '#7f5539';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = '#d4c0a8';
              (e.currentTarget as HTMLElement).style.color = '#9a8878';
            }}
          >
            <Plus className="w-5 h-5 mb-2" aria-hidden="true" />
            <span style={{ fontSize: '0.8125rem', fontWeight: 500 }}>New map</span>
          </Link>
        </div>
      </section>

      {/* ── Projects quick access ── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2
            style={{
              fontSize: '0.75rem',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: '#9a8878',
            }}
          >
            Projects
          </h2>
          <Link
            href={`${base}/projects`}
            style={{ fontSize: '0.8125rem', color: '#7f5539' }}
            className="transition-opacity hover:opacity-70"
          >
            View all
          </Link>
        </div>

        {!hasProjects ? (
          <Link
            href={`${base}/projects/new`}
            className="inline-flex items-center gap-2 rounded-xl font-semibold transition-all hover:opacity-90"
            style={{
              padding: '0.625rem 1.25rem',
              fontSize: '0.875rem',
              backgroundColor: '#7f5539',
              color: '#f5ede0',
              textDecoration: 'none',
            }}
          >
            <Plus className="w-3.5 h-3.5" />
            Create first project
          </Link>
        ) : (
          <Link
            href={`${base}/projects`}
            className="inline-flex items-center gap-1.5 transition-opacity hover:opacity-70"
            style={{ fontSize: '0.875rem', color: '#7f5539' }}
          >
            {projectsData?.total} project{projectsData?.total !== 1 ? 's' : ''}
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        )}
      </section>
    </div>
  );
}
