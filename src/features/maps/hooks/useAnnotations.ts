import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { annotationSchemasApi } from '@/lib/api/annotation-schemas';
import { annotationSetsApi } from '@/lib/api/annotation-sets';
import { qk } from '@/lib/query-keys';
import { useAnnotationStore } from '@/stores/annotationStore';
import type { AnnotationSchema, AnnotationFeature } from '@/types/api';
import type { GeoJSONGeometry } from '@/types/geo';

/**
 * Hook to fetch and manage an annotation schema with all its classes.
 * Automatically syncs classes to the annotation store.
 */
export function useAnnotationSchema(schemaId: string | null | undefined) {
  const { setSchemaClasses, setIsLoadingSchema, setError } = useAnnotationStore();

  const query = useQuery({
    queryKey: qk.annotationSchemas.detail(schemaId ?? ''),
    queryFn: () => annotationSchemasApi.get(schemaId!),
    enabled: !!schemaId,
  });

  // Sync schema to store when it loads
  React.useEffect(() => {
    if (query.data) {
      const classesMap = query.data.classes.reduce(
        (acc, cls) => {
          acc[cls.id] = cls;
          return acc;
        },
        {} as Record<string, typeof query.data.classes[0]>,
      );
      setSchemaClasses(classesMap);
      setIsLoadingSchema(false);
    }
    if (query.error) {
      const message = query.error instanceof Error ? query.error.message : 'Failed to load schema';
      setError(message);
      setIsLoadingSchema(false);
    }
  }, [query.data, query.error, setSchemaClasses, setIsLoadingSchema, setError]);

  return {
    schema: query.data,
    isLoading: query.isLoading,
    error: query.error,
  };
}

/**
 * Hook to fetch features from an annotation set as GeoJSON.
 */
export function useAnnotationSetFeatures(setId: string | null | undefined) {
  return useQuery({
    queryKey: qk.annotationSets.features(setId ?? ''),
    queryFn: () => annotationSetsApi.getFeatures(setId!),
    enabled: !!setId,
  });
}

/**
 * Hook to create a new annotation in a set.
 * Returns a mutation that invalidates the features query on success.
 */
export function useCreateAnnotation() {
  const queryClient = useQueryClient();
  const { setIsSavingAnnotation, setError, clearPendingAnnotation } = useAnnotationStore();

  return useMutation({
    mutationFn: ({ setId, classId, geometry, properties }: {
      setId: string;
      classId: string;
      geometry: any; // GeoJSON geometry from drawing
      properties?: Record<string, unknown>;
    }) =>
      annotationSetsApi.addFeature(setId, {
        class_id: classId,
        geometry,
        properties: properties ?? null,
      }),
    onMutate: () => {
      setIsSavingAnnotation(true);
    },
    onSuccess: (_, variables) => {
      // Invalidate the annotation set features so they refresh
      queryClient.invalidateQueries({
        queryKey: qk.annotationSets.features(variables.setId),
      });
      // Also invalidate the annotation set itself
      queryClient.invalidateQueries({
        queryKey: qk.annotationSets.detail(variables.setId),
      });
      setIsSavingAnnotation(false);
      setError(null);
      clearPendingAnnotation();
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Failed to save annotation';
      setError(message);
      setIsSavingAnnotation(false);
    },
  });
}

/**
 * Hook to create an annotation on a map with auto-resolved annotation set.
 * Backend finds or creates an annotation set matching (map + schema + user).
 * Invalidates both the map's annotation sets list and the resolved set's features.
 */
export function useCreateAnnotationOnMap() {
  const queryClient = useQueryClient();
  const { setIsSavingAnnotation, setError, clearPendingAnnotation } = useAnnotationStore();

  return useMutation({
    mutationFn: ({ mapId, classId, geometry, properties, schemaId, datasetId, setName }: {
      mapId: string;
      classId: string;
      geometry: GeoJSONGeometry;
      properties?: Record<string, unknown>;
      schemaId?: string | null;
      datasetId?: string | null;
      setName?: string | null;
    }) =>
      annotationSetsApi.addFeatureOnMap(mapId, {
        class_id: classId,
        geometry,
        properties: properties ?? null,
        schema_id: schemaId,
        dataset_id: datasetId,
        set_name: setName,
      }),
    onMutate: () => {
      setIsSavingAnnotation(true);
    },
    onSuccess: (result, variables) => {
      // Invalidate the resolved set's features + detail
      queryClient.invalidateQueries({
        queryKey: qk.annotationSets.features(result.annotation_set_id),
      });
      queryClient.invalidateQueries({
        queryKey: qk.annotationSets.detail(result.annotation_set_id),
      });
      // Also refresh the map's annotation set list (a new set may have been created)
      queryClient.invalidateQueries({
        queryKey: qk.annotationSets.listByMap(variables.mapId),
      });
      setIsSavingAnnotation(false);
      setError(null);
      clearPendingAnnotation();
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Failed to save annotation';
      setError(message);
      setIsSavingAnnotation(false);
    },
  });
}

/**
 * Hook to update an existing annotation.
 * Returns a mutation that invalidates the features query on success.
 */
export function useUpdateAnnotation() {
  const queryClient = useQueryClient();
  const { setIsSavingAnnotation, setError } = useAnnotationStore();

  return useMutation({
    mutationFn: ({ setId, annId, geometry, classId, properties }: {
      setId: string;
      annId: string;
      geometry?: any;
      classId?: string;
      properties?: Record<string, unknown>;
    }) =>
      annotationSetsApi.updateFeature(setId, annId, {
        class_id: classId,
        geometry,
        properties: properties ?? null,
      }),
    onMutate: () => {
      setIsSavingAnnotation(true);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: qk.annotationSets.features(variables.setId),
      });
      queryClient.invalidateQueries({
        queryKey: qk.annotationSets.detail(variables.setId),
      });
      setIsSavingAnnotation(false);
      setError(null);
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Failed to update annotation';
      setError(message);
      setIsSavingAnnotation(false);
    },
  });
}

/**
 * Hook to update an annotation class's style.
 * Automatically invalidates the schema query and updates the store.
 */
export function useUpdateAnnotationClassStyle() {
  const queryClient = useQueryClient();
  const { updateClassStyle, setError } = useAnnotationStore();

  return useMutation({
    mutationFn: ({ schemaId, classId, style, name }: {
      schemaId: string;
      classId: string;
      style?: Record<string, unknown>;
      name?: string;
    }) =>
      annotationSchemasApi.updateClassStyle(schemaId, classId, {
        definition: (style ?? {}) as Record<string, unknown>,
        name,
      }),
    onSuccess: (updatedClass, variables) => {
      // Update store immediately with the returned class
      updateClassStyle(variables.classId, updatedClass);

      // Invalidate the schema query to refresh
      queryClient.invalidateQueries({
        queryKey: qk.annotationSchemas.detail(variables.schemaId),
      });

      // Invalidate all annotation sets that use this schema (prefix matching)
      queryClient.invalidateQueries({
        queryKey: ['annotation-sets'],
      });

      setError(null);
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Failed to update class style';
      setError(message);
    },
  });
}

/**
 * Hook to delete an annotation.
 */
export function useDeleteAnnotation() {
  const queryClient = useQueryClient();
  const { setError } = useAnnotationStore();

  return useMutation({
    mutationFn: ({ setId, annId }: { setId: string; annId: string }) =>
      annotationSetsApi.deleteFeature(setId, annId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: qk.annotationSets.features(variables.setId),
      });
      queryClient.invalidateQueries({
        queryKey: qk.annotationSets.detail(variables.setId),
      });
      setError(null);
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Failed to delete annotation';
      setError(message);
    },
  });
}
