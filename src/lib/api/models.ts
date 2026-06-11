import { apiClient } from './client';
import { EP } from './endpoints';
import type { AIModel } from '@/types/api';
import type { PaginatedResponse } from '@/types/common';

export interface AIModelCreatePayload {
  name: string;
  description?: string | null;
  framework?: string | null;
  version?: string | null;
  type?: string | null;
  endpoint_url?: string | null;
  request_config?: Record<string, unknown> | null;
  auth_config?: Record<string, unknown> | null;
  input_schema?: Record<string, unknown> | null;
  output_schema?: Record<string, unknown> | null;
  output_config?: Record<string, unknown> | null;
  config?: Record<string, unknown> | null;
  annotation_schema_id?: string | null;
}

export interface AIModelUpdatePayload {
  name?: string;
  description?: string | null;
  framework?: string | null;
  version?: string | null;
  type?: string | null;
  endpoint_url?: string | null;
  request_config?: Record<string, unknown> | null;
  auth_config?: Record<string, unknown> | null;
  output_config?: Record<string, unknown> | null;
  config?: Record<string, unknown> | null;
  annotation_schema_id?: string | null;
}

export const modelsApi = {
  list: (params?: { type?: string; page?: number; page_size?: number }) =>
    apiClient
      .get(EP.models.list, {
        searchParams: (params ?? {}) as Record<string, string | number>,
      })
      .json<PaginatedResponse<AIModel>>(),

  get: (id: string) =>
    apiClient.get(EP.models.detail(id)).json<AIModel>(),

  create: (data: AIModelCreatePayload) =>
    apiClient.post(EP.models.create, { json: data }).json<AIModel>(),

  update: (id: string, data: AIModelUpdatePayload) =>
    apiClient.patch(EP.models.update(id), { json: data }).json<AIModel>(),

  delete: (id: string) =>
    apiClient.delete(EP.models.delete(id)).json<void>(),
};
