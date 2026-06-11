import { Suspense } from 'react';
import { ModelsContent } from './_components/ModelsContent';

interface Props {
  params: Promise<{ workspaceId: string }>;
}

export default async function ModelsPage({ params }: Props) {
  const { workspaceId } = await params;
  return (
    <Suspense>
      <ModelsContent workspaceId={workspaceId} />
    </Suspense>
  );
}

export const metadata = { title: 'AI Models' };
