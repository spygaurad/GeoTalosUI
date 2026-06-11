import type { Metadata } from 'next';
import { MapLoader } from '@/features/maps/components/MapLoader';

export const metadata: Metadata = { title: 'Map Editor — GeoTalos' };

interface Props {
  params: Promise<{ workspaceId: string; projectId: string; mapId: string }>;
}

export default async function MapEditorPage({ params }: Props) {
  const { workspaceId, projectId, mapId } = await params;
  return <MapLoader workspaceId={workspaceId} projectId={projectId} mapId={mapId} />;
}
