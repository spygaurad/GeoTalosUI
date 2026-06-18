'use client';

import { use } from 'react';
import { BarChart3, GitCompare, TrendingDown, Layers, ArrowRight } from 'lucide-react';

interface PageProps {
  params: Promise<{ id: string }>;
}

const ANALYSIS_TOOLS = [
  {
    id: 'change-detection',
    label: 'Change Detection',
    desc: 'Compare two dataset items to detect land cover changes between dates.',
    icon: GitCompare,
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    status: 'available' as const,
  },
  {
    id: 'ndvi-timeseries',
    label: 'NDVI Timeseries',
    desc: 'Track vegetation health over time using NDVI and other spectral indices.',
    icon: TrendingDown,
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
    status: 'available' as const,
  },
  {
    id: 'area-statistics',
    label: 'Area Statistics',
    desc: 'Compute area and percentage breakdown by annotation label across datasets.',
    icon: BarChart3,
    color: 'text-amber-600',
    bg: 'bg-amber-50',
    status: 'available' as const,
  },
  {
    id: 'composite',
    label: 'Multi-temporal Composite',
    desc: 'Generate cloud-free seasonal mosaics from multiple dataset items.',
    icon: Layers,
    color: 'text-purple-600',
    bg: 'bg-purple-50',
    status: 'coming-soon' as const,
  },
] as const;

export default function ProjectAnalysisPage({ params }: PageProps) {
  const { id: _id } = use(params);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Temporal Analysis</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Run change detection and timeseries analysis on project datasets.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {ANALYSIS_TOOLS.map((tool) => (
          <div
            key={tool.id}
            className="bg-white rounded-xl border border-primary-100 p-5 space-y-4 hover:border-primary-300 hover:shadow-sm transition-all"
          >
            <div className="flex items-center justify-between">
              <div className={`w-10 h-10 ${tool.bg} rounded-xl flex items-center justify-center`}>
                <tool.icon className={`w-5 h-5 ${tool.color}`} />
              </div>
              {tool.status === 'coming-soon' && (
                <span className="text-xs bg-gray-100 text-gray-500 font-medium px-2 py-0.5 rounded-full">
                  Coming soon
                </span>
              )}
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-900">{tool.label}</h3>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">{tool.desc}</p>
            </div>

            <button
              disabled={tool.status === 'coming-soon'}
              className="w-full flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors"
            >
              {tool.status === 'coming-soon' ? (
                'Not available yet'
              ) : (
                <>
                  Launch
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        ))}
      </div>

      {/* Recent analysis jobs placeholder */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Recent analysis jobs</h3>
        <div className="bg-white border border-primary-100 rounded-xl p-8 text-center">
          <p className="text-sm text-gray-400">No analysis jobs run yet.</p>
          <p className="text-xs text-gray-300 mt-1">
            Launch an analysis tool above to get started.
          </p>
        </div>
      </div>
    </div>
  );
}
