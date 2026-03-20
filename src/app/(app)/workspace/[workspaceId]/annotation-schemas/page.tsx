import { Suspense } from 'react';
import { AnnotationSchemasContent } from './_components/AnnotationSchemasContent';

interface Props {
  params: Promise<{ workspaceId: string }>;
}

export default async function AnnotationSchemasPage({ params }: Props) {
  const { workspaceId } = await params;
  return (
    <Suspense>
      <AnnotationSchemasContent workspaceId={workspaceId} />
    </Suspense>
  );
}

export const metadata = { title: 'Annotation Schemas' };