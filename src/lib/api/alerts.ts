import { apiClient } from './client';
import type { Alert, AlertStatus, AlertSeverity } from '@/types/api';
import type { PaginatedResponse } from '@/types/common';

/**
 * NOTE: Alerts endpoints are not yet documented in docs/backend-api-endpoints.md.
 * These paths are provisional and must be verified against the backend before use.
 */

interface AlertListParams {
  severity?: AlertSeverity;
  status?: AlertStatus;
  alert_type?: string;
  project_id?: string;
  bbox?: string;
  page?: number;
  page_size?: number;
}

export const alertsApi = {
  list: (params?: AlertListParams) =>
    apiClient
      .get('alerts', {
        searchParams: (params ?? {}) as unknown as Record<string, string | number>,
      })
      .json<PaginatedResponse<Alert>>(),

  get: (id: string) =>
    apiClient.get(`alerts/${id}`).json<Alert>(),

  updateStatus: (id: string, status: AlertStatus) =>
    apiClient.patch(`alerts/${id}/status`, { json: { status } }).json<Alert>(),
};
