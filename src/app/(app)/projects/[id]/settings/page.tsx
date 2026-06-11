'use client';

import { use, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Settings, Users, Shield, Trash2 } from 'lucide-react';
import { qk } from '@/lib/query-keys';
import { projectsApi } from '@/lib/api/projects';
import type { ProjectMember } from '@/types/api';

interface PageProps {
  params: Promise<{ id: string }>;
}

const projectSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional(),
});
type ProjectForm = z.infer<typeof projectSchema>;

const ROLE_COLOR: Record<ProjectMember['role'], string> = {
  admin: 'bg-primary-100 text-primary-700',
  member: 'bg-blue-100 text-blue-700',
  viewer: 'bg-gray-100 text-gray-600',
};

export default function ProjectSettingsPage({ params }: PageProps) {
  const { id } = use(params);
  const queryClient = useQueryClient();

  const { data: project, isLoading } = useQuery({
    queryKey: qk.projects.detail(id),
    queryFn: () => projectsApi.get(id),
  });

  const { data: members, isLoading: membersLoading } = useQuery({
    queryKey: qk.projects.members(id),
    queryFn: () => projectsApi.listMembers(id),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<ProjectForm>({ resolver: zodResolver(projectSchema) });

  useEffect(() => {
    if (project) {
      reset({ name: project.name, description: project.description ?? '' });
    }
  }, [project, reset]);

  const { mutate: updateProject } = useMutation({
    mutationFn: (data: ProjectForm) => projectsApi.update(id, data),
    onSuccess: (updated) => {
      queryClient.setQueryData(qk.projects.detail(id), updated);
      queryClient.invalidateQueries({ queryKey: qk.projects.detail(id) });
      reset({ name: updated.name, description: updated.description ?? '' });
      toast.success('Project updated');
    },
    onError: () => toast.error('Failed to update project'),
  });

  return (
    <div className="max-w-2xl space-y-8">
      {/* Project details */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Settings className="w-4 h-4 text-primary-600" />
          <h2 className="text-base font-semibold text-gray-900">Project Details</h2>
        </div>

        <form
          onSubmit={handleSubmit((data) => updateProject(data))}
          className="bg-white rounded-xl border border-primary-100 p-5 space-y-4"
        >
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-700">Project name</label>
            <input
              {...register('name')}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="Project name"
            />
            {errors.name && (
              <p className="text-xs text-red-500">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-700">Description</label>
            <textarea
              {...register('description')}
              rows={3}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
              placeholder="Optional description"
            />
            {errors.description && (
              <p className="text-xs text-red-500">{errors.description.message}</p>
            )}
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={!isDirty || isSubmitting || isLoading}
              className="bg-primary-600 hover:bg-primary-700 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {isSubmitting ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </section>

      {/* Members */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-primary-600" />
            <h2 className="text-base font-semibold text-gray-900">Members</h2>
          </div>
          <button className="text-xs text-primary-600 hover:text-primary-700 font-medium px-3 py-1.5 border border-primary-200 rounded-lg hover:bg-primary-50 transition-colors">
            Invite member
          </button>
        </div>

        <div className="bg-white rounded-xl border border-primary-100 overflow-hidden">
          {membersLoading ? (
            <div className="p-4 space-y-3">
              {[1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 animate-pulse">
                  <div className="w-8 h-8 bg-gray-100 rounded-full flex-shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3.5 bg-gray-100 rounded w-1/3" />
                    <div className="h-3 bg-gray-100 rounded w-1/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : !members || members.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">No members yet.</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {members.map((member) => (
                <MemberRow key={member.user_id} member={member} projectId={id} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Danger zone */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Shield className="w-4 h-4 text-red-500" />
          <h2 className="text-base font-semibold text-gray-900">Danger zone</h2>
        </div>

        <div className="bg-white rounded-xl border border-red-200 p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-gray-900">Delete this project</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Permanently delete this project and all its data. This cannot be undone.
              </p>
            </div>
            <button className="flex items-center gap-2 border border-red-300 hover:bg-red-50 text-red-600 text-sm font-medium px-3 py-2 rounded-lg transition-colors flex-shrink-0">
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function MemberRow({ member, projectId }: { member: ProjectMember; projectId: string }) {
  const initials = member.user.name
    ? member.user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : member.user.email.slice(0, 2).toUpperCase();

  return (
    <div className="px-4 py-3 flex items-center gap-3">
      <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-semibold text-primary-700">
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">
          {member.user.name || member.user.email}
        </p>
        {member.user.name && (
          <p className="text-xs text-gray-400 truncate">{member.user.email}</p>
        )}
      </div>
      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_COLOR[member.role]}`}>
        {member.role}
      </span>
    </div>
  );
}
