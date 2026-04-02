'use client';

import { useEffect, useMemo, useState } from 'react';
import { useOrganization } from '@clerk/nextjs';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  TreePine,
  Plus,
  ArrowRight,
  Map,
  Calendar,
  Search,
  X,
  FolderOpen,
} from 'lucide-react';
import { qk } from '@/lib/query-keys';
import { projectsApi } from '@/lib/api/projects';
import type { Project } from '@/types/api';

// Accent palette cycling through forest / earth tones
const ACCENTS = [
  { hex: '#3b7c4b' }, // forest green
  { hex: '#3d6f99' }, // teal blue
  { hex: '#8c6d2c' }, // golden brown (primary)
  { hex: '#b07a27' }, // amber
  { hex: '#5c6b3a' }, // olive
  { hex: '#9a3a3a' }, // rust
  { hex: '#2d7d7d' }, // deep teal
  { hex: '#7a5c3a' }, // earthy brown
];

function getAccent(index: number) {
  return ACCENTS[index % ACCENTS.length];
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

// ── schema ────────────────────────────────────────────────
const newProjectSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional(),
});
type NewProjectForm = z.infer<typeof newProjectSchema>;

// ── page ─────────────────────────────────────────────────
export default function ProjectsPage() {
  const { organization } = useOrganization();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: qk.projects.list(),
    queryFn: () => projectsApi.list(),
    enabled: !!organization?.id,
  });

  const projects = data?.items ?? [];

  const filtered = useMemo(() => {
    if (!search.trim()) return projects;
    const q = search.toLowerCase();
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description ?? '').toLowerCase().includes(q)
    );
  }, [projects, search]);

  // Auto-open dialog on first visit with no projects
  useEffect(() => {
    if (!isLoading && data && projects.length === 0) {
      setDialogOpen(true);
    }
  }, [isLoading, data, projects.length]);

  const {
    register,
    handleSubmit,
    reset,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<NewProjectForm>({ resolver: zodResolver(newProjectSchema) });

  const { mutate: createProject } = useMutation({
    mutationFn: (d: NewProjectForm) => projectsApi.create(d),
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: qk.projects.list() });
      toast.success(`"${project.name}" created`);
      setDialogOpen(false);
      reset();
      router.push(`/projects/${project.id}`);
    },
    onError: () => toast.error('Failed to create project'),
  });

  function openDialog() {
    reset();
    setDialogOpen(true);
    setTimeout(() => setFocus('name'), 50);
  }

  function closeDialog() {
    setDialogOpen(false);
    reset();
  }

  return (
    <>
      <div className="space-y-0">
        {/* ── Header banner ─────────────────────────────── */}
        <div className="relative -mx-3.5 mb-6 px-6 py-8 overflow-hidden rounded-xl"
          style={{
            background: 'linear-gradient(135deg, #f5f0e8 0%, #faf8f4 50%, #eef5ef 100%)',
            borderBottom: '1px solid #e8dac5',
          }}
        >
          {/* Decorative circles */}
          <div className="absolute -top-10 -right-10 w-48 h-48 rounded-full opacity-10"
            style={{ background: 'radial-gradient(circle, #3b7c4b, transparent)' }} />
          <div className="absolute -bottom-8 right-32 w-32 h-32 rounded-full opacity-10"
            style={{ background: 'radial-gradient(circle, #8c6d2c, transparent)' }} />
          <div className="absolute top-4 right-1/2 w-20 h-20 rounded-full opacity-5"
            style={{ background: 'radial-gradient(circle, #3d6f99, transparent)' }} />

          <div className="relative flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'linear-gradient(135deg, #8c6d2c, #695221)' }}
              >
                <TreePine className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900 tracking-tight">Projects</h1>
                <p className="text-sm text-gray-500 mt-0.5 max-w-sm">
                  Organize satellite datasets, models, and forest intelligence by project.
                </p>
                {organization && (
                  <div className="mt-2 inline-flex items-center gap-1.5 bg-white/60 border border-primary-200 text-xs font-medium text-primary-700 px-2.5 py-1 rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary-500" />
                    {organization.name}
                  </div>
                )}
              </div>
            </div>

            <button
              onClick={openDialog}
              className="flex-shrink-0 flex items-center gap-2 text-white text-sm font-semibold px-4 py-2.5 rounded-xl shadow-sm transition-all hover:shadow-md active:scale-95"
              style={{ background: 'linear-gradient(135deg, #7e6228, #695221)' }}
            >
              <Plus className="w-4 h-4" />
              New Project
            </button>
          </div>
        </div>

        {/* ── Search + count bar ────────────────────────── */}
        {!isLoading && projects.length > 0 && (
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-900">
                {projects.length}
              </span>
              <span className="text-sm text-gray-400">
                {projects.length === 1 ? 'project' : 'projects'}
              </span>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search projects…"
                className="pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg w-56 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent bg-white"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Loading skeletons ─────────────────────────── */}
        {isLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-white rounded-xl border border-primary-100 overflow-hidden animate-pulse"
              >
                <div className="h-1.5 bg-gray-200" />
                <div className="p-5 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-gray-100 rounded-lg flex-shrink-0" />
                    <div className="space-y-1.5 flex-1">
                      <div className="h-4 bg-gray-100 rounded w-3/4" />
                      <div className="h-3 bg-gray-100 rounded w-1/2" />
                    </div>
                  </div>
                  <div className="h-3 bg-gray-100 rounded w-full" />
                  <div className="h-3 bg-gray-100 rounded w-2/3" />
                  <div className="h-8 bg-gray-100 rounded-lg mt-2" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Project grid ──────────────────────────────── */}
        {!isLoading && filtered.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((project, i) => (
              <ProjectCard
                key={project.id}
                project={project}
                accentHex={getAccent(i).hex}
              />
            ))}
          </div>
        )}

        {/* ── No search results ─────────────────────────── */}
        {!isLoading && projects.length > 0 && filtered.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-sm text-gray-400">No projects match &ldquo;{search}&rdquo;</p>
            <button
              onClick={() => setSearch('')}
              className="mt-2 text-xs text-primary-600 hover:text-primary-700 font-medium"
            >
              Clear search
            </button>
          </div>
        )}
      </div>

      {/* ── Create Project Dialog ─────────────────────── */}
      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={closeDialog}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            {/* Dialog accent strip */}
            <div className="h-1" style={{ background: 'linear-gradient(90deg, #8c6d2c, #c19b5c, #695221)' }} />

            <div className="p-6 space-y-5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                    style={{ background: 'linear-gradient(135deg, #8c6d2c22, #8c6d2c44)' }}
                  >
                    <FolderOpen className="w-4 h-4" style={{ color: '#8c6d2c' }} />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-gray-900">New project</h2>
                    <p className="text-xs text-gray-400 mt-0.5">Create a workspace for your analysis</p>
                  </div>
                </div>
                <button
                  onClick={closeDialog}
                  className="text-gray-300 hover:text-gray-500 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSubmit((d) => createProject(d))} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-gray-700">
                    Project name <span className="text-danger-500">*</span>
                  </label>
                  <input
                    {...register('name')}
                    autoFocus
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:border-transparent transition-shadow"
                    style={{ '--tw-ring-color': '#8c6d2c66' } as React.CSSProperties}
                    placeholder="e.g. Amazon Basin Monitoring Q3"
                  />
                  {errors.name && (
                    <p className="text-xs text-danger-500">{errors.name.message}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-gray-700">
                    Description
                    <span className="ml-1 font-normal text-gray-400">(optional)</span>
                  </label>
                  <textarea
                    {...register('description')}
                    rows={3}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:border-transparent resize-none transition-shadow"
                    placeholder="What area, time range, or purpose does this project cover?"
                  />
                </div>

                <div className="flex items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={closeDialog}
                    className="flex-1 border border-gray-200 hover:bg-gray-50 text-gray-600 text-sm font-medium px-4 py-2.5 rounded-xl transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 flex items-center justify-center gap-2 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-all hover:shadow-md active:scale-95 disabled:opacity-60"
                    style={{ background: 'linear-gradient(135deg, #7e6228, #695221)' }}
                  >
                    {isSubmitting ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Creating…
                      </>
                    ) : (
                      <>
                        <Plus className="w-4 h-4" />
                        Create project
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Project Card ──────────────────────────────────────────
function ProjectCard({
  project,
  accentHex,
}: {
  project: Project;
  accentHex: string;
}) {
  const initials = getInitials(project.name);
  const created = new Date(project.created_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div
      className="group bg-white rounded-xl border border-primary-100 overflow-hidden hover:shadow-lg transition-all duration-200 flex flex-col"
      style={{
        borderColor: undefined,
        '--hover-border': accentHex,
      } as React.CSSProperties}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = accentHex + '66';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = '';
      }}
    >
      {/* Colored accent bar */}
      <div className="h-1.5 flex-shrink-0" style={{ backgroundColor: accentHex }} />

      <div className="p-5 flex flex-col gap-4 flex-1">
        {/* Project identity */}
        <div className="flex items-start gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-white text-xs font-bold tracking-wide shadow-sm"
            style={{ backgroundColor: accentHex }}
          >
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-gray-900 truncate leading-snug">
              {project.name}
            </h3>
            <p className="text-xs text-gray-400 mt-0.5 line-clamp-2 leading-relaxed">
              {project.description ?? (
                <span className="italic text-gray-300">No description</span>
              )}
            </p>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-gray-50" />

        {/* Meta + actions */}
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs text-gray-400">
            <Calendar className="w-3 h-3" />
            {created}
          </span>

          <div className="flex items-center gap-1.5">
            <Link
              href={`/map?project=${project.id}`}
              onClick={(e) => e.stopPropagation()}
              title="Open on map"
              className="w-7 h-7 flex items-center justify-center rounded-lg border border-gray-200 hover:border-gray-300 hover:bg-gray-50 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <Map className="w-3.5 h-3.5" />
            </Link>
            <Link
              href={`/projects/${project.id}`}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg text-white transition-all hover:shadow-sm active:scale-95"
              style={{ backgroundColor: accentHex }}
            >
              Open
              <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
