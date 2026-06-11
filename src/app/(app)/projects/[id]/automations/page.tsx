'use client';

import { use } from 'react';
import { Zap, Calendar, Database, Bell, Webhook, GitCompare, FileText, Bot } from 'lucide-react';

interface PageProps {
  params: Promise<{ id: string }>;
}

const TRIGGER_TYPES = [
  {
    id: 'schedule',
    label: 'Scheduled',
    desc: 'Run on a cron schedule (daily, weekly, monthly or custom)',
    icon: Calendar,
    color: 'text-blue-600',
    bg: 'bg-blue-50',
  },
  {
    id: 'dataset_ingest',
    label: 'On Dataset Ingest',
    desc: 'Trigger when a new dataset item arrives in this project',
    icon: Database,
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
  },
  {
    id: 'alert_fired',
    label: 'On Alert Fired',
    desc: 'React to critical, warning, or info alerts automatically',
    icon: Bell,
    color: 'text-amber-600',
    bg: 'bg-amber-50',
  },
  {
    id: 'webhook',
    label: 'External Webhook',
    desc: 'Triggered by an external system or AI agent via HTTP',
    icon: Webhook,
    color: 'text-purple-600',
    bg: 'bg-purple-50',
  },
] as const;

const ACTION_TYPES = [
  {
    id: 'inference',
    label: 'Run Inference',
    desc: 'Apply an ML model and produce annotations',
    icon: Zap,
  },
  {
    id: 'change_detection',
    label: 'Change Detection',
    desc: 'Compare dataset items and generate diff annotations',
    icon: GitCompare,
  },
  {
    id: 'create_alert',
    label: 'Create Alert',
    desc: 'Emit a severity-tagged alert to the feed',
    icon: Bell,
  },
  {
    id: 'generate_report',
    label: 'Generate Report',
    desc: 'Export a PDF/CSV summary of results',
    icon: FileText,
  },
  {
    id: 'run_agent',
    label: 'Run AI Agent',
    desc: 'Delegate to a monitoring or analysis agent (coming soon)',
    icon: Bot,
    comingSoon: true,
  },
] as const;

export default function ProjectAutomationsPage({ params }: PageProps) {
  const { id } = use(params);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Automations</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Schedule triggers and build geo-intelligence pipelines for this project.
          </p>
        </div>
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-700 text-xs font-medium px-3 py-1.5 rounded-lg flex-shrink-0">
          <Zap className="w-3.5 h-3.5" />
          Coming in next sprint
        </div>
      </div>

      {/* Preview of trigger types */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Trigger types</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {TRIGGER_TYPES.map((trigger) => (
            <div
              key={trigger.id}
              className="bg-white rounded-xl border border-primary-100 p-4 flex items-start gap-3 opacity-75"
            >
              <div className={`w-9 h-9 ${trigger.bg} rounded-lg flex items-center justify-center flex-shrink-0`}>
                <trigger.icon className={`w-4 h-4 ${trigger.color}`} />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">{trigger.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{trigger.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Preview of action types */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Action types</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {ACTION_TYPES.map((action) => (
            <div
              key={action.id}
              className="bg-white rounded-xl border border-primary-100 p-4 flex items-start gap-3 opacity-75"
            >
              <div className="w-9 h-9 bg-primary-50 rounded-lg flex items-center justify-center flex-shrink-0">
                <action.icon className="w-4 h-4 text-primary-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-gray-900">{action.label}</p>
                  {'comingSoon' in action && action.comingSoon && (
                    <span className="text-xs bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded-full">
                      soon
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{action.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Rule data model preview */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Rule structure</h3>
        <div className="bg-gray-900 rounded-xl p-4 overflow-x-auto">
          <pre className="text-xs text-gray-300 font-mono leading-relaxed">
{`{
  "trigger": { "type": "dataset_ingest", "config": {} },
  "conditions": [
    { "field": "item_count", "operator": "gte", "value": 1 }
  ],
  "actions": [
    {
      "type": "run_inference",
      "config": { "model_id": "...", "confidence_threshold": 0.7 }
    },
    {
      "type": "create_alert",
      "config": { "severity": "warning", "min_area_change_pct": 5 }
    }
  ]
}`}
          </pre>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          Automation rules are composable: any trigger can chain any combination of actions, with optional condition filters.
        </p>
      </div>
    </div>
  );
}
