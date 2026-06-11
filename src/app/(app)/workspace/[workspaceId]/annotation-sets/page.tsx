import { AnnotationSetsContent } from './_components/AnnotationSetsContent';

interface Props {
  params: Promise<{ workspaceId: string }>;
}

export default async function AnnotationSetsPage({ params }: Props) {
  const { workspaceId } = await params;
  return <AnnotationSetsContent workspaceId={workspaceId} />;
}

export const metadata = { title: 'Annotation Sets' };
