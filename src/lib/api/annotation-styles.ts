import { apiClient } from './client';
import { EP } from './endpoints';
import type { StyleDefinition } from '@/types/api';

/** Payload for creating a new style. */
export interface StyleCreatePayload {
  name: string;
  type: string;                     // e.g., 'fill', 'line', 'symbol' – check your backend
  definition: {
    fillColor: string;
    strokeColor: string;
    strokeWidth: number;
    fillOpacity: number;
    [key: string]: unknown;          // allow extra fields
  };
}

/** Payload for updating an existing style. */
export interface StyleUpdatePayload {
  name?: string;
  type?: string;
  definition?: Partial<StyleDefinition['definition']>;
}

export const stylesApi = {
  /**
   * List all styles for the current organization (paginated).
   */
  list: (limit?: number, offset?: number) =>
    apiClient
      .get(EP.styles.list, {
        searchParams: { limit, offset },
      })
      .json<{ items: StyleDefinition[]; total: number; limit: number; offset: number }>(),

  /**
   * Get a single style by ID.
   */
  get: (styleId: string) =>
    apiClient
      .get(EP.styles.detail(styleId))
      .json<StyleDefinition>(),

  /**
   * Create a new style.
   * The backend will assign an ID and organization scope.
   */
  create: (data: StyleCreatePayload) =>
    apiClient
      .post(EP.styles.create, { json: data })
      .json<StyleDefinition>(),

  /**
   * Update an existing style.
   * Send only the fields that have changed.
   */
  update: (styleId: string, data: StyleUpdatePayload) =>
    apiClient
      .patch(EP.styles.update(styleId), { json: data })
      .json<StyleDefinition>(),

  /**
   * Delete a style.
   * Note: This may fail if the style is still referenced by classes.
   */
  delete: (styleId: string) =>
    apiClient.delete(EP.styles.delete(styleId)).json<void>(),
};