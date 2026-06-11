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

export interface StyleDefinitionPayload {
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  fillOpacity?: number;
  [key: string]: unknown;
}

/** Payload for PATCH /annotation-schemas/{schemaId}/classes/{classId}/style */
export interface ClassStyleUpsertPayload {
  /** Human-readable name for the style record (defaults to "{ClassName} style"). */
  name?: string;
  /** Geometry type: 'polygon' | 'line' | 'point' | 'box' (defaults to 'polygon'). */
  type?: string;
  /** Full style definition — all fields merged into the existing style. */
  definition: StyleDefinitionPayload;
}

const CLASS_PAGE_SIZE = 100;

interface AnnotationClassListResponse {
  items: AnnotationClass[];
  total?: number;
  limit?: number;
  offset?: number;
}

async function getClassPage(schemaId: string, limit: number, offset: number) {
  return apiClient
    .get(EP.annotationSchemas.classes(schemaId), {
      searchParams: { limit, offset },
    })
    .json<AnnotationClassListResponse>();
}

async function getAllClasses(schemaId: string): Promise<{ items: AnnotationClass[] }> {
  const items: AnnotationClass[] = [];
  const seen = new Set<string>();
  let offset = 0;
  let safety = 0;
  let reportedTotal: number | null = null;

  while (safety < 100) {
    safety += 1;
    const page = await getClassPage(schemaId, CLASS_PAGE_SIZE, offset);
    const pageItems = Array.isArray(page.items) ? page.items : [];

    for (const cls of pageItems) {
      if (!seen.has(cls.id)) {
        seen.add(cls.id);
        items.push(cls);
      }
    }

    if (typeof page.total === 'number' && Number.isFinite(page.total)) {
      reportedTotal = page.total;
    }

    if (pageItems.length === 0) break;
    if (reportedTotal !== null && items.length >= reportedTotal) break;

    const step = typeof page.limit === 'number' && page.limit > 0 ? page.limit : CLASS_PAGE_SIZE;
    offset += step;

    if (pageItems.length < step) break;
  }

  return { items };
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
    getAllClasses(schemaId),

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

  /**
   * Upsert the style for an annotation class.
   * Creates a new Style record if the class has no style_id, otherwise patches
   * the existing Style definition in-place.
   */
  updateClassStyle: (
    schemaId: string,
    classId: string,
    data: ClassStyleUpsertPayload,
  ) =>
    apiClient
      .patch(EP.annotationSchemas.classStyle(schemaId, classId), { json: data })
      .json<AnnotationClass>(),
};
