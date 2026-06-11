import { currentUser } from '@clerk/nextjs/server';
import { DashboardContent } from './_components/DashboardContent';

export const metadata = {
  title: 'Dashboard — GeoTalos',
};

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const user = await currentUser();
  const firstName = user?.firstName ?? 'there';

  return <DashboardContent workspaceId={workspaceId} firstName={firstName} />;
}
