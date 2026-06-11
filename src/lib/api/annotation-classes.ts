import { apiClient } from './client';
import { EP } from './endpoints';
import type { AnnotationClass } from '@/types/api';

/** Payload for updating an annotation class (standalone). */
export interface UpdateAnnotationClassPayload {
  name?: string;
  description?: string | null;
  parent_id?: string | null;
  style_id?: string | null;
  properties?: Record<string, unknown> | null;
}

export const annotationClassesApi = {
  /** Get a single annotation class by ID. */
  get: (classId: string) =>
    apiClient
      .get(EP.annotationClasses.detail(classId))
      .json<AnnotationClass>(),

  /** Update an annotation class (standalone). */
  update: (classId: string, data: UpdateAnnotationClassPayload) =>
    apiClient
      .patch(EP.annotationClasses.update(classId), { json: data })
      .json<AnnotationClass>(),

  /** Delete an annotation class. */
  delete: (classId: string) =>
    apiClient.delete(EP.annotationClasses.delete(classId)).json<void>(),
};