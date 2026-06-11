'use client';

import { use } from 'react';
import { useOrganization } from '@clerk/nextjs';
import { useQuery } from '@tanstack/react-query';
import { Cpu, Zap } from 'lucide-react';
import { qk } from '@/lib/query-keys';
import { modelsApi } from '@/lib/api/models';
import type { MLModel, ModelType } from '@/types/api';

interface PageProps {
  params: Promise<{ id: string }>;
}

const TYPE_COLOR: Record<ModelType, string> = {
  detection: 'bg-blue-50 text-blue-700',
  segmentation: 'bg-purple-50 text-purple-700',
  classification: 'bg-amber-50 text-amber-700',
};

export default function ProjectModelsPage({ params }: PageProps) {
  const { id } = use(params);
  const { organization } = useOrganization();
  const orgId = organization?.id ?? '';

  const { data, isLoading } = useQuery({
    queryKey: qk.models.list(),
    queryFn: () => modelsApi.list(),
    enabled: !!orgId,
  });

  const models = data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Models</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            ML models available for inference in this project.
          </p>
        </div>
        <button className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
          <Zap className="w-4 h-4" />
          Run Inference
        </button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-white rounded-xl border border-primary-100 p-5 space-y-3 animate-pulse"
            >
              <div className="h-4 bg-gray-100 rounded w-3/4" />
              <div className="h-3 bg-gray-100 rounded w-1/2" />
              <div className="h-8 bg-gray-100 rounded" />
            </div>
          ))}
        </div>
      ) : models.length === 0 ? (
        <div className="bg-white rounded-xl border border-primary-100 p-12 text-center">
          <div className="w-12 h-12 bg-primary-50 rounded-xl flex items-center justify-center mx-auto mb-4">
            <Cpu className="w-6 h-6 text-primary-600" />
          </div>
          <h3 className="text-sm font-semibold text-gray-900 mb-1">No models registered</h3>
          <p className="text-sm text-gray-500">
            Register an ML model to run inference on your datasets.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {models.map((model) => (
            <ModelCard key={model.id} model={model} projectId={id} />
          ))}
        </div>
      )}
    </div>
  );
}

function ModelCard({ model, projectId }: { model: MLModel; projectId: string }) {
  return (
    <div className="bg-white rounded-xl border border-primary-100 p-5 space-y-4 hover:border-primary-300 hover:shadow-sm transition-all">
      <div className="flex items-start justify-between gap-2">
        <div className="w-9 h-9 bg-primary-50 rounded-lg flex items-center justify-center flex-shrink-0">
          <Cpu className="w-4 h-4 text-primary-600" />
        </div>
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded-full ${TYPE_COLOR[model.type]}`}
        >
          {model.type}
        </span>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-900 truncate">{model.name}</h3>
        <p className="text-xs text-gray-400 mt-0.5">v{model.version}</p>
      </div>

      <button className="w-full flex items-center justify-center gap-2 border border-primary-200 hover:bg-primary-50 text-primary-700 text-xs font-medium px-3 py-2 rounded-lg transition-colors">
        <Zap className="w-3.5 h-3.5" />
        Run on Project
      </button>
    </div>
  );
}
