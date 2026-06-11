import { PipelineBuilderLoader } from './_components/PipelineBuilderLoader';

export const metadata = { title: 'Pipeline Builder — GeoTalos' };

export default async function PipelineBuilderPage({
  params,
}: {
  params: Promise<{ workspaceId: string; projectId: string; pipelineId: string }>;
}) {
  const { workspaceId, projectId, pipelineId } = await params;

  return (
    <PipelineBuilderLoader
      workspaceId={workspaceId}
      projectId={projectId}
      pipelineId={pipelineId}
    />
  );
}
