import { ProjectContent } from './_components/ProjectContent';

export const metadata = { title: 'Project — GeoTalos' };

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ workspaceId: string; projectId: string }>;
}) {
  const { workspaceId, projectId } = await params;
  return <ProjectContent workspaceId={workspaceId} projectId={projectId} />;
}
