'use client';

import dynamic from 'next/dynamic';

const PipelineBuilderContent = dynamic(
  () =>
    import('./PipelineBuilderContent').then(
      (mod) => mod.PipelineBuilderContent,
    ),
  { ssr: false },
);

export function PipelineBuilderLoader({
  workspaceId,
  projectId,
  pipelineId,
}: {
  workspaceId: string;
  projectId: string;
  pipelineId: string;
}) {
  return (
    <PipelineBuilderContent
      workspaceId={workspaceId}
      projectId={projectId}
      pipelineId={pipelineId}
    />
  );
}
