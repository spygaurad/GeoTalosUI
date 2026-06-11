import { apiClient } from './client';
import { EP } from './endpoints';

export interface AdapterDescriptor {
  name: string;
  label: string;
  description: string;
  supported_formats: string[];
  config_schema: {
    type: string;
    properties: Record<
      string,
      {
        type: string;
        default?: unknown;
        description?: string;
        additionalProperties?: Record<string, unknown>;
      }
    >;
  };
}

export interface AdaptersListResponse {
  items: AdapterDescriptor[];
  total: number;
}

export const adaptersApi = {
  list: () =>
    apiClient.get(EP.inference.adapters).json<AdaptersListResponse>(),
};
