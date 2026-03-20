import { ClassTable } from '@/features/annotation_schemas/components/ClassTable';
import { annotationSchemasApi } from '@/lib/api/annotation-schemas';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AnnotationSchemaDetailPage({ params }: Props) {
  const { id } = await params;
  
  // Fetch schema details
  const schema = await annotationSchemasApi.get(id).catch(() => null);
  
  if (!schema) {
    notFound();
  }

  return (
    <div className="container mx-auto py-10 px-4 max-w-7xl">
      {/* Schema Header */}
      <div className="flex items-start justify-between mb-8 gap-4">
        <div className="flex-1">
          <h1 className="text-3xl font-display font-bold tracking-tight">
            {schema.name}
          </h1>
          {schema.description && (
            <p className="text-muted-foreground mt-2 max-w-2xl">
              {schema.description}
            </p>
          )}
        </div>
        
        {/* Schema metadata badges */}
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary" className="text-sm">
            v{schema.version}
          </Badge>
          <Badge variant="outline" className="text-sm">
            {schema.geometry_types.join(', ')}
          </Badge>
          <Badge variant="default" className="text-sm">
            {schema.classes?.length || 0} classes
          </Badge>
        </div>
      </div>
      
      {/* Hierarchical Classes Table */}
      <ClassTable schemaId={id} />
    </div>
  );
}