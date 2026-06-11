import { ReactNode } from 'react';
import ProjectHeader from '@/features/projects/components/ProjectHeader';
import ProjectNav from '@/features/projects/components/ProjectNav';

interface ProjectLayoutProps {
  children: ReactNode;
  params: Promise<{ id: string }>;
}

export default async function ProjectLayout({ children, params }: ProjectLayoutProps) {
  const { id } = await params;

  return (
    <div className="-mx-4 sm:-mx-6 -mt-4">
      <ProjectHeader projectId={id} />
      <ProjectNav projectId={id} />
      <div className="px-4 sm:px-6 py-6">{children}</div>
    </div>
  );
}
