'use client';

import { use } from 'react';
import { FileText, Download, Clock, BarChart3, Map, Activity } from 'lucide-react';

interface PageProps {
  params: Promise<{ id: string }>;
}

const REPORT_TEMPLATES = [
  {
    id: 'forest-cover',
    label: 'Forest Cover Change',
    desc: 'Before/after area statistics — deforestation, regrowth, degradation breakdown.',
    icon: BarChart3,
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
    formats: ['PDF', 'CSV'],
  },
  {
    id: 'tracked-objects',
    label: 'Tracked Object History',
    desc: 'Full temporal history of tracked entities — trajectory, area change, observation timeline.',
    icon: Activity,
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    formats: ['PDF', 'CSV'],
  },
  {
    id: 'alert-summary',
    label: 'Alert Summary',
    desc: 'Count, severity distribution, and resolution time for alerts in a date range.',
    icon: Clock,
    color: 'text-amber-600',
    bg: 'bg-amber-50',
    formats: ['PDF', 'CSV'],
  },
  {
    id: 'spatial-export',
    label: 'Spatial Data Export',
    desc: 'Export annotations and tracked object geometries as GeoJSON or Shapefile.',
    icon: Map,
    color: 'text-purple-600',
    bg: 'bg-purple-50',
    formats: ['GeoJSON', 'SHP'],
  },
] as const;

export default function ProjectReportsPage({ params }: PageProps) {
  const { id: _id } = use(params);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Reports</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Generate PDF/CSV snapshots and spatial exports for this project.
          </p>
        </div>
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-700 text-xs font-medium px-3 py-1.5 rounded-lg flex-shrink-0">
          <FileText className="w-3.5 h-3.5" />
          Coming in next sprint
        </div>
      </div>

      {/* Templates */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Report templates</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {REPORT_TEMPLATES.map((template) => (
            <div
              key={template.id}
              className="bg-white rounded-xl border border-primary-100 p-5 space-y-4 opacity-75"
            >
              <div className="flex items-start justify-between gap-2">
                <div className={`w-10 h-10 ${template.bg} rounded-xl flex items-center justify-center flex-shrink-0`}>
                  <template.icon className={`w-5 h-5 ${template.color}`} />
                </div>
                <div className="flex items-center gap-1">
                  {template.formats.map((fmt) => (
                    <span
                      key={fmt}
                      className="text-xs bg-gray-100 text-gray-500 font-medium px-1.5 py-0.5 rounded"
                    >
                      {fmt}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-gray-900">{template.label}</h4>
                <p className="text-xs text-gray-500 mt-1 leading-relaxed">{template.desc}</p>
              </div>

              <button
                disabled
                className="w-full flex items-center justify-center gap-2 border border-gray-200 bg-gray-50 text-gray-400 text-xs font-medium px-3 py-2 rounded-lg cursor-not-allowed"
              >
                <Download className="w-3.5 h-3.5" />
                Generate Report
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Scheduled reports preview */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Scheduled reports</h3>
        <div className="bg-white rounded-xl border border-primary-100 p-8 text-center">
          <div className="w-10 h-10 bg-gray-50 rounded-xl flex items-center justify-center mx-auto mb-3">
            <Clock className="w-5 h-5 text-gray-300" />
          </div>
          <p className="text-sm text-gray-400">Scheduled reports coming soon</p>
          <p className="text-xs text-gray-300 mt-1">
            Configure weekly or monthly automated report delivery via email.
          </p>
        </div>
      </div>
    </div>
  );
}
