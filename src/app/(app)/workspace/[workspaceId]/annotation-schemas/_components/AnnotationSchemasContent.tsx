'use client';

import { useState } from 'react';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
import { Search, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  annotationSchemasApi,
  type AnnotationClassCreatePayload,
  type StyleDefinitionPayload,
} from '@/lib/api/annotation-schemas';
import { annotationClassesApi } from '@/lib/api/annotation-classes';
import { qk } from '@/lib/query-keys';
import type { AnnotationSchema, AnnotationClass } from '@/types/api';

import { C } from './constants';
import { SchemaRow } from './SchemaRow';
import { SchemaForm, type SchemaFormData } from './SchemaForm';
import { ClassForm, type ClassFormData } from './ClassForm';
import { Drawer } from './Drawer';
import { SkeletonRows, EmptyState } from './SkeletonAndEmpty';

interface AnnotationSchemasContentProps {
  workspaceId: string;
}

export function AnnotationSchemasContent({ workspaceId: _workspaceId }: AnnotationSchemasContentProps) {
  const { orgId } = useAuth();
  const queryClient = useQueryClient();

  // UI state
  const [query, setQuery] = useState('');
  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(new Set());
  const [showSchemaForm, setShowSchemaForm] = useState(false);
  const [editingSchema, setEditingSchema] = useState<AnnotationSchema | null>(null);
  const [addingClassToSchema, setAddingClassToSchema] = useState<string | null>(null);
  const [editingClass, setEditingClass] = useState<{ schemaId: string; cls: AnnotationClass } | null>(null);
  const [addingSubclassTo, setAddingSubclassTo] = useState<{ schemaId: string; parentId: string } | null>(null);

  // Queries
  const { data, isLoading } = useQuery({
    queryKey: qk.annotationSchemas.list(),
    queryFn: () => annotationSchemasApi.list(50, 0),
    enabled: !!orgId,
  });

  // Fetch classes separately for expanded schemas
  const schemaIds = data?.items.map((s) => s.id) ?? [];
  const classesQueries = useQueries({
    queries: schemaIds.map((id) => ({
      queryKey: qk.annotationSchemas.classes(id),
      queryFn: () => annotationSchemasApi.getClasses(id),
      enabled: !!orgId && expandedSchemas.has(id),
      staleTime: 30_000,
    })),
  });

  // Merge list data with classes
  const schemasWithClasses = (data?.items ?? []).map((schema, index) => {
    const classesQuery = classesQueries[index];
    if (classesQuery?.data?.items) {
      return { ...schema, classes: classesQuery.data.items };
    }
    return schema; // Fallback to list item (no classes)
  });

  const filtered = schemasWithClasses.filter((s) =>
    !query || s.name.toLowerCase().includes(query.toLowerCase())
  );

  // Mutations
  const createSchemaMutation = useMutation({
    mutationFn: annotationSchemasApi.create,
    onSuccess: (newSchema) => {
      // Insert the new schema into the cached list so it shows without a refresh,
      // then reconcile with the server.
      queryClient.setQueryData<{ items: AnnotationSchema[]; total: number; limit: number; offset: number }>(
        qk.annotationSchemas.list(),
        (old) =>
          old
            ? { ...old, items: [newSchema, ...old.items], total: old.total + 1 }
            : old,
      );
      queryClient.invalidateQueries({ queryKey: qk.annotationSchemas.list() });
      toast.success(`Schema "${newSchema.name}" created`);
      setShowSchemaForm(false);
      setExpandedSchemas((prev) => new Set([...prev, newSchema.id]));
    },
    onError: (error) => {
      console.error('Create schema error:', error);
      const message = error instanceof Error ? error.message : 'Failed to create schema';
      toast.error(message);
    },
  });

  const updateSchemaMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof annotationSchemasApi.update>[1] }) =>
      annotationSchemasApi.update(id, data),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: qk.annotationSchemas.list() });
      toast.success(`Schema "${updated.name}" updated`);
      setEditingSchema(null);
    },
    onError: (error) => {
      console.error('Update schema error:', error);
      const message = error instanceof Error ? error.message : 'Failed to update schema';
      toast.error(message);
    },
  });

  const deleteSchemaMutation = useMutation({
    mutationFn: annotationSchemasApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.annotationSchemas.list() });
      toast.success('Schema deleted');
    },
    onError: (error) => {
      console.error('Delete schema error:', error);
      const message = error instanceof Error ? error.message : 'Failed to delete schema';
      toast.error(message);
    },
  });

  const createClassMutation = useMutation({
    mutationFn: async ({
      schemaId,
      data,
      style,
    }: {
      schemaId: string;
      data: AnnotationClassCreatePayload;
      style: StyleDefinitionPayload;
    }) => {
      const created = await annotationSchemasApi.createClass(schemaId, data);
      // Persist the chosen colors as a Style record so the row swatch renders
      // immediately — without this the class shows the grey fallback until edited.
      await annotationSchemasApi.updateClassStyle(schemaId, created.id, {
        name: `${data.name} Style`,
        type: 'polygon',
        definition: style,
      });
      return created;
    },
    onSuccess: (_data, variables) => {
      // Invalidate classes query to refresh the list
      queryClient.invalidateQueries({ queryKey: qk.annotationSchemas.classes(variables.schemaId) });
      toast.success('Class created');
      setAddingClassToSchema(null);
      setAddingSubclassTo(null);
    },
    onError: (error) => {
      console.error('Create class error:', error);
      const message = error instanceof Error ? error.message : 'Failed to create class';
      toast.error(message);
    },
  });

  const updateClassMutation = useMutation({
    mutationFn: ({
      schemaId,
      classId,
      data,
    }: {
      schemaId: string;
      classId: string;
      data: Parameters<typeof annotationSchemasApi.updateClassStyle>[2];
    }) => annotationSchemasApi.updateClassStyle(schemaId, classId, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: qk.annotationSchemas.classes(variables.schemaId) });
      toast.success('Class updated');
      setEditingClass(null);
    },
    onError: (error) => {
      console.error('Update class error:', error);
      const message = error instanceof Error ? error.message : 'Failed to update class';
      toast.error(message);
    },
  });

  const deleteClassMutation = useMutation({
    mutationFn: ({ classId }: { classId: string; schemaId: string }) => 
      annotationClassesApi.delete(classId),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: qk.annotationSchemas.classes(variables.schemaId) });
      toast.success('Class deleted');
    },
    onError: (error) => {
      console.error('Delete class error:', error);
      const message = error instanceof Error ? error.message : 'Failed to delete class';
      toast.error(message);
    },
  });

  // Handlers
  const toggleSchema = (id: string) => {
    setExpandedSchemas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreateSchema = (formData: SchemaFormData) => {
    createSchemaMutation.mutate({
      name: formData.name,
      description: formData.description || null,
      geometry_types: formData.geometry_types,
    });
  };

  const handleUpdateSchema = (formData: SchemaFormData) => {
    if (!editingSchema) return;
    updateSchemaMutation.mutate({
      id: editingSchema.id,
      data: {
        name: formData.name,
        description: formData.description || null,
        geometry_types: formData.geometry_types,
      },
    });
  };

  const handleDeleteSchema = (schema: AnnotationSchema) => {
    if (!confirm(`Delete schema "${schema.name}"? This cannot be undone.`)) return;
    deleteSchemaMutation.mutate(schema.id);
  };

  const handleCreateClass = (schemaId: string, parentId: string | null, formData: ClassFormData) => {
    createClassMutation.mutate({
      schemaId,
      data: {
        name: formData.name,
        description: formData.description || null,
        parent_id: parentId,
        style_id: null,
      },
      style: {
        fillColor: formData.fillColor,
        strokeColor: formData.strokeColor,
        strokeWidth: formData.strokeWidth,
        fillOpacity: formData.fillOpacity,
      },
    });
  };

  const handleUpdateClass = (schemaId: string, classId: string, formData: ClassFormData) => {
    updateClassMutation.mutate({
      schemaId,
      classId,
      data: {
        name: `${formData.name} Style`,
        type: 'polygon',
        definition: {
          fillColor: formData.fillColor,
          strokeColor: formData.strokeColor,
          strokeWidth: formData.strokeWidth,
          fillOpacity: formData.fillOpacity,
        },
      },
    });
  };

  const handleDeleteClass = (schemaId: string, cls: AnnotationClass) => {
    if (!confirm(`Delete class "${cls.name}"? This will also delete any subclasses.`)) return;
    deleteClassMutation.mutate({ classId: cls.id, schemaId });
  };

  // Get parent options for class forms
  const getParentOptions = (schema: AnnotationSchema, excludeId?: string) => {
    return (schema.classes ?? [])
      .filter((c) => c.id !== excludeId)
      .map((c) => ({ id: c.id, name: c.name }));
  };

  return (
    <div
      style={{
        maxWidth: 900,
        margin: '0 auto',
        padding: '32px 24px',
        fontFamily: 'var(--font-sans, system-ui)',
        color: C.text,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28, gap: 16 }}>
        <div>
          <h1
            style={{
              fontFamily: 'var(--font-display, Georgia, serif)',
              fontSize: 'clamp(1.625rem, 3vw, 2.25rem)',
              fontWeight: 700,
              color: C.text,
              lineHeight: 1.1,
              marginBottom: 6,
            }}
          >
            Annotation Schemas
          </h1>
          <p style={{ fontSize: '0.9375rem', color: C.textSec }}>
            {data ? `${data.total} schema${data.total !== 1 ? 's' : ''}` : 'Define annotation categories and styles'}
          </p>
        </div>

        <button
          onClick={() => setShowSchemaForm(true)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            height: 36,
            padding: '0 16px',
            borderRadius: 8,
            border: 'none',
            background: C.accent,
            color: '#faf8f4',
            fontSize: '0.8125rem',
            fontWeight: 600,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <Plus size={13} />
          New schema
        </button>
      </div>

      {/* Search */}
      {(data?.total ?? 0) > 3 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            height: 36,
            padding: '0 12px',
            marginBottom: 16,
            borderRadius: 7,
            border: `1px solid ${C.border}`,
            background: '#fff',
          }}
        >
          <Search size={13} style={{ color: C.textMuted, flexShrink: 0 }} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search schemas…"
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              fontSize: '0.875rem',
              color: C.text,
              background: 'transparent',
            }}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, padding: 0 }}
            >
              <X size={13} />
            </button>
          )}
        </div>
      )}

      {/* Schema list */}
      {isLoading ? (
        <SkeletonRows />
      ) : filtered.length === 0 && !query ? (
        <EmptyState onCreateSchema={() => setShowSchemaForm(true)} />
      ) : filtered.length === 0 ? (
        <div style={{ padding: '40px 20px', textAlign: 'center' }}>
          <p style={{ fontSize: '0.875rem', color: C.textMuted }}>
            No schemas match &ldquo;{query}&rdquo;
          </p>
        </div>
      ) : (
        <div>
          {filtered.map((schema) => (
            <SchemaRow
              key={schema.id}
              schema={schema}
              isExpanded={expandedSchemas.has(schema.id)}
              onToggle={() => toggleSchema(schema.id)}
              onEdit={() => setEditingSchema(schema)}
              onDelete={() => handleDeleteSchema(schema)}
              onAddClass={() => setAddingClassToSchema(schema.id)}
              onEditClass={(cls) => setEditingClass({ schemaId: schema.id, cls })}
              onDeleteClass={(cls) => handleDeleteClass(schema.id, cls)}
              onAddSubclass={(parentId) => setAddingSubclassTo({ schemaId: schema.id, parentId })}
            />
          ))}
        </div>
      )}

      {/* Create Schema Drawer */}
      {showSchemaForm && (
        <Drawer title="Create Annotation Schema" onClose={() => setShowSchemaForm(false)}>
          <SchemaForm
            onSubmit={handleCreateSchema}
            onCancel={() => setShowSchemaForm(false)}
            isSubmitting={createSchemaMutation.isPending}
          />
        </Drawer>
      )}

      {/* Edit Schema Drawer */}
      {editingSchema && (
        <Drawer title="Edit Schema" onClose={() => setEditingSchema(null)}>
          <SchemaForm
            initialData={{
              name: editingSchema.name,
              description: editingSchema.description ?? '',
              geometry_types: editingSchema.geometry_types,
            }}
            onSubmit={handleUpdateSchema}
            onCancel={() => setEditingSchema(null)}
            isSubmitting={updateSchemaMutation.isPending}
            isEdit
          />
        </Drawer>
      )}

      {/* Add Class Drawer */}
      {addingClassToSchema && (
        <Drawer title="Add Annotation Class" onClose={() => setAddingClassToSchema(null)} width="min(540px, 100vw)">
          <ClassForm
            parentOptions={getParentOptions(schemasWithClasses.find((s) => s.id === addingClassToSchema)!)}
            onSubmit={(data) => handleCreateClass(addingClassToSchema, data.parent_id, data)}
            onCancel={() => setAddingClassToSchema(null)}
            isSubmitting={createClassMutation.isPending}
          />
        </Drawer>
      )}

      {/* Add Subclass Drawer */}
      {addingSubclassTo && (
        <Drawer title="Add Subclass" onClose={() => setAddingSubclassTo(null)} width="min(540px, 100vw)">
          <ClassForm
            initialData={{ parent_id: addingSubclassTo.parentId }}
            parentOptions={getParentOptions(schemasWithClasses.find((s) => s.id === addingSubclassTo.schemaId)!)}
            onSubmit={(data) => handleCreateClass(addingSubclassTo.schemaId, addingSubclassTo.parentId, data)}
            onCancel={() => setAddingSubclassTo(null)}
            isSubmitting={createClassMutation.isPending}
          />
        </Drawer>
      )}

      {/* Edit Class Drawer */}
      {editingClass && (
        <Drawer title="Edit Class" onClose={() => setEditingClass(null)} width="min(540px, 100vw)">
          <ClassForm
            initialData={{
              name: editingClass.cls.name,
              description: '',
              parent_id: editingClass.cls.parent_id,
              fillColor: editingClass.cls.style?.definition?.fillColor ?? '#3498db',
              strokeColor: editingClass.cls.style?.definition?.strokeColor ?? '#2980b9',
              strokeWidth: editingClass.cls.style?.definition?.strokeWidth ?? 2,
              fillOpacity: editingClass.cls.style?.definition?.fillOpacity ?? 0.5,
            }}
            parentOptions={getParentOptions(
              schemasWithClasses.find((s) => s.id === editingClass.schemaId)!,
              editingClass.cls.id
            )}
            onSubmit={(data) => handleUpdateClass(editingClass.schemaId, editingClass.cls.id, data)}
            onCancel={() => setEditingClass(null)}
            isSubmitting={updateClassMutation.isPending}
            isEdit
          />
        </Drawer>
      )}
    </div>
  );
}
