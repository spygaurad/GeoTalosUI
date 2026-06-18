'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { projectsApi } from '@/lib/api/projects';
import { qk } from '@/lib/query-keys';
import {
  Plus,
  ArrowRight,
  Map,
  Database,
  Clock,
  Search,
} from 'lucide-react';
import type { Project } from '@/types/api';

// ── Seeded topo mini-mark ────────────────────────────────────────────────────

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

const PALETTES = [
  { bg: '#2e3428', c: '#c4985c' },
  { bg: '#3a2c1e', c: '#d4b896' },
  { bg: '#1e2e28', c: '#a8c4a0' },
  { bg: '#28241c', c: '#c4b480' },
];

function ProjectMark({ name }: { name: string }) {
  const seed = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const rng = seededRandom(seed);
  const pal = PALETTES[seed % PALETTES.length];
  const cx = 16 + rng() * 20;
  const cy = 14 + rng() * 12;

  return (
    <svg
      viewBox="0 0 56 40"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-full"
      aria-hidden="true"
    >
      <rect width="56" height="40" fill={pal.bg} />
      {[28, 21, 14, 8].map((r, i) => (
        <ellipse
          key={i}
          cx={cx} cy={cy}
          rx={r} ry={r * 0.68}
          fill="none"
          stroke={pal.c}
          strokeWidth="0.5"
          opacity={0.1 + i * 0.06}
        />
      ))}
      <circle cx={cx} cy={cy} r="1.5" fill={pal.c} opacity="0.6" />
    </svg>
  );
}

// ── Skeleton row ─────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div
      className="flex items-center gap-4 py-5"
      style={{ borderBottom: '1px solid #e8d8c4' }}
    >
      <div
        className="shrink-0 rounded-lg overflow-hidden"
        style={{ width: '56px', height: '40px', backgroundColor: '#e8d5b8' }}
      />
      <div className="flex-1 space-y-2">
        <div
          className="rounded"
          style={{ height: '14px', width: '40%', backgroundColor: '#e8d5b8' }}
        />
        <div
          className="rounded"
          style={{ height: '11px', width: '60%', backgroundColor: '#f0e4d4' }}
        />
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyProjects({ workspaceId }: { workspaceId: string }) {
  return (
    <div className="py-20 text-center">
      <p
        style={{
          fontFamily: 'var(--font-display, Georgia, serif)',
          fontSize: '1.5rem',
          color: '#2e3428',
          marginBottom: '8px',
        }}
      >
        No projects yet
      </p>
      <p style={{ fontSize: '0.875rem', color: '#9a8878', marginBottom: '24px' }}>
        Projects organise your maps, datasets, and team in one place.
      </p>
      <Link
        href={`/workspace/${workspaceId}/projects/new`}
        className="inline-flex items-center gap-2 rounded-xl font-semibold"
        style={{
          backgroundColor: '#7f5539',
          color: '#f5ede0',
          padding: '0.75rem 1.5rem',
          fontSize: '0.875rem',
        }}
      >
        <Plus className="w-4 h-4" />
        Create first project
      </Link>
    </div>
  );
}

// ── Project row ──────────────────────────────────────────────────────────────

interface ProjectRowProps {
  project: Project;
  workspaceId: string;
}

function ProjectRow({ project, workspaceId }: ProjectRowProps) {
  const [hovered, setHovered] = useState(false);
  const href = `/workspace/${workspaceId}/projects/${project.id}`;

  return (
    <Link
      href={href}
      className="flex items-center gap-4 py-5 group"
      style={{
        borderBottom: '1px solid #e8d8c4',
        textDecoration: 'none',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Mini topo mark */}
      <div
        className="shrink-0 rounded-lg overflow-hidden transition-transform"
        style={{
          width: '56px',
          height: '40px',
          transform: hovered ? 'scale(1.04)' : 'scale(1)',
          transition: 'transform 0.25s cubic-bezier(0.2,0,0,1)',
        }}
      >
        <ProjectMark name={project.name} />
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p
          style={{
            fontSize: '0.9375rem',
            fontWeight: 600,
            color: hovered ? '#7f5539' : '#2e3428',
            transition: 'color 0.15s',
            marginBottom: '2px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {project.name}
        </p>
        {project.description && (
          <p
            style={{
              fontSize: '0.8125rem',
              color: '#8a7868',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {project.description}
          </p>
        )}
      </div>

      {/* Meta */}
      <div
        className="hidden md:flex items-center gap-6 shrink-0"
        style={{ fontSize: '0.75rem', color: '#9a8878' }}
      >
        <span className="flex items-center gap-1.5">
          <Map className="w-3.5 h-3.5" aria-hidden="true" />
          — maps
        </span>
        <span className="flex items-center gap-1.5">
          <Database className="w-3.5 h-3.5" aria-hidden="true" />
          — datasets
        </span>
        <span className="flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" aria-hidden="true" />
          {new Date(project.updated_at).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
          })}
        </span>
      </div>

      {/* Arrow */}
      <ArrowRight
        className="w-4 h-4 shrink-0 transition-transform"
        style={{
          color: hovered ? '#7f5539' : '#c4b09c',
          transform: hovered ? 'translateX(3px)' : 'translateX(0)',
          transition: 'all 0.2s cubic-bezier(0.2,0,0,1)',
        }}
      />
    </Link>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ProjectsContent({ workspaceId }: { workspaceId: string }) {
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: qk.projects.list(),
    queryFn: () => projectsApi.list(),
  });

  const projects = (data?.items ?? []).filter(
    (p) =>
      !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.description ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div
      className="max-w-4xl mx-auto py-10 px-10"
      style={{ fontFamily: 'var(--font-sans, system-ui)' }}
    >
      {/* ── Header ── */}
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1
            style={{
              fontFamily: 'var(--font-display, Georgia, serif)',
              fontSize: 'clamp(1.75rem, 3vw, 2.25rem)',
              fontWeight: 700,
              color: '#2e3428',
              lineHeight: 1.1,
              marginBottom: '4px',
            }}
          >
            Projects
          </h1>
          {data && (
            <p style={{ fontSize: '0.8125rem', color: '#9a8878' }}>
              {data.total} project{data.total !== 1 ? 's' : ''}
            </p>
          )}
        </div>

        <Link
          href={`/workspace/${workspaceId}/projects/new`}
          className="inline-flex items-center gap-1.5 rounded-lg font-semibold transition-all hover:opacity-90"
          style={{
            backgroundColor: '#7f5539',
            color: '#f5ede0',
            padding: '0.5rem 1rem',
            fontSize: '0.8125rem',
          }}
        >
          <Plus className="w-3.5 h-3.5" />
          New project
        </Link>
      </div>

      {/* ── Search ── */}
      {(data?.total ?? 0) > 4 && (
        <div
          className="flex items-center gap-2 mb-6 px-3 rounded-lg"
          style={{
            border: '1px solid #d4c0a8',
            backgroundColor: '#fdf5ec',
          }}
        >
          <Search className="w-3.5 h-3.5 shrink-0" style={{ color: '#9a8878' }} />
          <input
            type="search"
            placeholder="Search projects…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent py-2.5 outline-none"
            style={{ fontSize: '0.875rem', color: '#2e3428' }}
          />
        </div>
      )}

      {/* ── List ── */}
      {isLoading ? (
        <div>
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      ) : projects.length === 0 && !search ? (
        <EmptyProjects workspaceId={workspaceId} />
      ) : projects.length === 0 ? (
        <p style={{ fontSize: '0.875rem', color: '#9a8878', paddingTop: '2rem' }}>
          No projects match &quot;{search}&quot;
        </p>
      ) : (
        <div>
          <div
            style={{ borderTop: '1px solid #e8d8c4' }}
            role="list"
            aria-label="Projects"
          >
            {projects.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                workspaceId={workspaceId}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
