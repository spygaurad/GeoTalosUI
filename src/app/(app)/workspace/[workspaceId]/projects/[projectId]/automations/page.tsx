import { AutomationsContent } from './_components/AutomationsContent';

export const metadata = { title: 'Automations — GeoTalos' };

export default async function AutomationsPage({
  params,
}: {
  params: Promise<{ workspaceId: string; projectId: string }>;
}) {
  const { workspaceId, projectId } = await params;
  return <AutomationsContent workspaceId={workspaceId} projectId={projectId} />;
}
