'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Folder } from 'lucide-react';
import { qk } from '@/lib/query-keys';
import { projectsApi } from '@/lib/api/projects';

interface ProjectHeaderProps {
  projectId: string;
}

export default function ProjectHeader({ projectId }: ProjectHeaderProps) {
  const { data: project, isLoading } = useQuery({
    queryKey: qk.projects.detail(projectId),
    queryFn: () => projectsApi.get(projectId),
  });

  return (
    <div className="px-4 sm:px-6 py-4 border-b border-gray-200 bg-white">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
        <Link href="/projects" className="hover:text-primary-600 transition-colors">
          Projects
        </Link>
        <ChevronRight className="w-3 h-3" />
        {isLoading ? (
          <div className="h-3 bg-gray-100 rounded w-24 animate-pulse" />
        ) : (
          <span className="text-gray-600 font-medium truncate max-w-xs">
            {project?.name ?? 'Project'}
          </span>
        )}
      </nav>

      {/* Project name + description */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 bg-primary-50 rounded-lg flex items-center justify-center flex-shrink-0">
          <Folder className="w-4 h-4 text-primary-600" />
        </div>
        <div className="min-w-0">
          {isLoading ? (
            <>
              <div className="h-5 bg-gray-100 rounded w-48 animate-pulse mb-1" />
              <div className="h-3 bg-gray-100 rounded w-72 animate-pulse" />
            </>
          ) : (
            <>
              <h1 className="text-base font-semibold text-gray-900 truncate">
                {project?.name ?? 'Project'}
              </h1>
              {project?.description && (
                <p className="text-xs text-gray-500 truncate">{project.description}</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
