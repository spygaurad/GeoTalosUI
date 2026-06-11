'use client';

import { use } from 'react';
import { useOrganization } from '@clerk/nextjs';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, AlertTriangle, Info, CheckCircle2 } from 'lucide-react';
import { qk } from '@/lib/query-keys';
import { alertsApi } from '@/lib/api/alerts';
import type { Alert, AlertSeverity, AlertStatus } from '@/types/api';

interface PageProps {
  params: Promise<{ id: string }>;
}

const SEVERITY_CONFIG: Record<AlertSeverity, { icon: typeof Bell; color: string; bg: string }> = {
  critical: { icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50' },
  warning: { icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50' },
  info: { icon: Info, color: 'text-blue-600', bg: 'bg-blue-50' },
};

const STATUS_BADGE: Record<AlertStatus, string> = {
  open: 'bg-red-100 text-red-700',
  acknowledged: 'bg-amber-100 text-amber-700',
  resolved: 'bg-gray-100 text-gray-500',
};

export default function ProjectAlertsPage({ params }: PageProps) {
  use(params);
  const { organization } = useOrganization();
  const orgId = organization?.id ?? '';

  const { data, isLoading } = useQuery({
    queryKey: qk.alerts.list(),
    queryFn: () => alertsApi.list(),
    enabled: !!orgId,
  });

  const alerts = data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Alerts</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Change detection and threshold alerts for this project.
          </p>
        </div>
        {alerts.filter((a) => a.status === 'open').length > 0 && (
          <span className="bg-red-100 text-red-700 text-xs font-semibold px-2.5 py-1 rounded-full">
            {alerts.filter((a) => a.status === 'open').length} open
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-white rounded-xl border border-primary-100 p-4 flex items-start gap-3 animate-pulse"
            >
              <div className="w-8 h-8 bg-gray-100 rounded-lg flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-gray-100 rounded w-2/3" />
                <div className="h-3 bg-gray-100 rounded w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : alerts.length === 0 ? (
        <div className="bg-white rounded-xl border border-primary-100 p-12 text-center">
          <div className="w-12 h-12 bg-emerald-50 rounded-xl flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-6 h-6 text-emerald-500" />
          </div>
          <h3 className="text-sm font-semibold text-gray-900 mb-1">No alerts</h3>
          <p className="text-sm text-gray-500">
            All clear — no change detection or threshold alerts.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-primary-100 divide-y divide-gray-50">
          {alerts.map((alert) => (
            <AlertRow key={alert.id} alert={alert} />
          ))}
        </div>
      )}
    </div>
  );
}

function AlertRow({ alert }: { alert: Alert }) {
  const severity = SEVERITY_CONFIG[alert.severity];
  const SeverityIcon = severity.icon;
  const queryClient = useQueryClient();

  const { mutate: updateStatus } = useMutation({
    mutationFn: (status: AlertStatus) => alertsApi.updateStatus(alert.id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
  });

  const created = new Date(alert.created_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="px-4 py-3.5 flex items-start gap-3 hover:bg-gray-50 transition-colors">
      <div className={`w-8 h-8 ${severity.bg} rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5`}>
        <SeverityIcon className={`w-4 h-4 ${severity.color}`} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-gray-900">{alert.title}</span>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_BADGE[alert.status]}`}>
            {alert.status}
          </span>
        </div>
        <p className="text-xs text-gray-400 mt-0.5">{created} · {alert.alert_type.replace(/_/g, ' ')}</p>
      </div>

      {alert.status === 'open' && (
        <button
          onClick={() => updateStatus('acknowledged')}
          className="flex-shrink-0 text-xs text-primary-600 hover:text-primary-700 font-medium px-2 py-1 rounded hover:bg-primary-50 transition-colors"
        >
          Acknowledge
        </button>
      )}
    </div>
  );
}
