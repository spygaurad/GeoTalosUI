import { apiClient } from './client';
import { EP } from './endpoints';
import type { AnnotationSchema, AnnotationClass } from '@/types/api';

export interface AnnotationSchemaCreatePayload {
  name: string;
  description?: string | null;
  geometry_types: string[];
  properties_schema?: Record<string, unknown> | null;
}

export interface AnnotationSchemaUpdatePayload {
  name?: string;
  description?: string | null;
  geometry_types?: string[];
  properties_schema?: Record<string, unknown> | null;
}

export interface AnnotationClassCreatePayload {
  name: string;
  description?: string | null;
  parent_id?: string | null;
  style_id?: string | null;
  properties?: Record<string, unknown> | null;
}

export interface UpdateAnnotationClassStylePayload {
  name?: string;
  style?: {
    name?: string;
    type?: string;
    definition?: {
      fillColor?: string;
      strokeColor?: string;
      strokeWidth?: number;
      fillOpacity?: number;
    };
  };
}

export const annotationSchemasApi = {
  /** List all annotation schemas for the current org (paginated). */
  list: (limit?: number, offset?: number) =>
    apiClient
      .get(EP.annotationSchemas.list, {
        searchParams: { limit, offset },
      })
      .json<{ items: AnnotationSchema[]; total: number; limit: number; offset: number }>(),

  /** Get a single schema with classes + styles. */
  get: (id: string) =>
    apiClient.get(EP.annotationSchemas.detail(id)).json<AnnotationSchema>(),

  /** Create a new annotation schema. */
  create: (data: AnnotationSchemaCreatePayload) =>
    apiClient
      .post(EP.annotationSchemas.create, { json: data })
      .json<AnnotationSchema>(),

  /** Update an existing annotation schema. */
  update: (id: string, data: AnnotationSchemaUpdatePayload) =>
    apiClient
      .patch(EP.annotationSchemas.update(id), { json: data })
      .json<AnnotationSchema>(),

  /** Delete an annotation schema (soft delete). */
  delete: (id: string) =>
    apiClient.delete(EP.annotationSchemas.delete(id)).json<void>(),

  /** Get all classes for a schema. */
  getClasses: (schemaId: string) =>
    apiClient
      .get(EP.annotationSchemas.classes(schemaId))
      .json<{ items: AnnotationClass[] }>(),

  /** Get a single annotation class with its style. */
  getClass: (schemaId: string, classId: string) =>
    apiClient
      .get(EP.annotationSchemas.classDetail(schemaId, classId))
      .json<AnnotationClass>(),

  /** Create a new class under a schema. */
  createClass: (schemaId: string, data: AnnotationClassCreatePayload) =>
    apiClient
      .post(EP.annotationSchemas.classes(schemaId), { json: data })
      .json<AnnotationClass>(),

  /** Update an annotation class, including its style. */
  updateClassStyle: (
    schemaId: string,
    classId: string,
    data: UpdateAnnotationClassStylePayload
  ) =>
    apiClient
      .patch(EP.annotationSchemas.classStyle(schemaId, classId), { json: data })
      .json<AnnotationClass>(),
};