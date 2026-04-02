'use client';

import { use } from 'react';
import { useOrganization } from '@clerk/nextjs';
import { useQuery } from '@tanstack/react-query';
import { Tag, Plus } from 'lucide-react';
import { qk } from '@/lib/query-keys';
import { labelSchemasApi } from '@/lib/api/label-schemas';
import type { LabelSchema } from '@/types/api';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function ProjectSchemasPage({ params }: PageProps) {
  const { id } = use(params);
  const { organization } = useOrganization();
  const orgId = organization?.id ?? '';

  const { data: schemas, isLoading } = useQuery({
    queryKey: qk.labelSchemas.list({ project_id: id }),
    queryFn: () => labelSchemasApi.list({ project_id: id }),
    enabled: !!orgId,
  });

  const projectSchemas = schemas?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Object Schema Definitions</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Label taxonomies and annotation schemas for this project.
          </p>
        </div>
        <button className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
          <Plus className="w-4 h-4" />
          New Schema
        </button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="bg-white rounded-xl border border-primary-100 p-5 space-y-3 animate-pulse"
            >
              <div className="h-4 bg-gray-100 rounded w-2/3" />
              <div className="h-3 bg-gray-100 rounded w-1/3" />
              <div className="flex gap-1.5">
                {[1, 2, 3].map((j) => (
                  <div key={j} className="h-5 bg-gray-100 rounded-full w-12" />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : projectSchemas.length === 0 ? (
        <div className="bg-white rounded-xl border border-primary-100 p-12 text-center">
          <div className="w-12 h-12 bg-primary-50 rounded-xl flex items-center justify-center mx-auto mb-4">
            <Tag className="w-6 h-6 text-primary-600" />
          </div>
          <h3 className="text-sm font-semibold text-gray-900 mb-1">No schemas yet</h3>
          <p className="text-sm text-gray-500 mb-4">
            Define label taxonomies to standardize annotations in this project.
          </p>
          <button className="inline-flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
            <Plus className="w-4 h-4" />
            Create Schema
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projectSchemas.map((schema) => (
            <SchemaCard key={schema.id} schema={schema} />
          ))}
        </div>
      )}
    </div>
  );
}

function SchemaCard({ schema }: { schema: LabelSchema }) {
  return (
    <div className="bg-white rounded-xl border border-primary-100 p-5 space-y-4 hover:border-primary-300 hover:shadow-sm transition-all">
      <div className="flex items-start justify-between gap-2">
        <div className="w-9 h-9 bg-primary-50 rounded-lg flex items-center justify-center flex-shrink-0">
          <Tag className="w-4 h-4 text-primary-600" />
        </div>
        <span className="text-xs text-gray-400">{schema.labels.length} labels</span>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-900">{schema.name}</h3>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {schema.labels.slice(0, 5).map((label) => (
          <span
            key={label.name}
            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600"
          >
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: label.color }}
            />
            {label.name}
          </span>
        ))}
        {schema.labels.length > 5 && (
          <span className="text-xs text-gray-400 px-1 py-0.5">
            +{schema.labels.length - 5} more
          </span>
        )}
      </div>

      <button className="w-full text-xs text-primary-600 hover:text-primary-700 font-medium border border-primary-200 hover:bg-primary-50 px-3 py-1.5 rounded-lg transition-colors">
        Edit Schema
      </button>
    </div>
  );
}
