'use client';

import React, { useState } from 'react';
import type { AnnotationClass } from '@/types/api';
import { useAnnotationStore } from '@/stores/annotationStore';
import { useCreateAnnotation, useCreateAnnotationOnMap } from '@/features/maps/hooks/useAnnotations';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { AlertCircle, CheckCircle2 } from 'lucide-react';

interface AnnotationDrawingToolsProps {
  /** Explicit set — if provided, annotations go directly to this set. */
  annotationSetId?: string;
  /** Map ID — used for auto-resolving annotation set when annotationSetId is absent. */
  mapId?: string;
  /** Schema ID — passed to backend for auto-set resolution. */
  schemaId?: string | null;
  schemaClasses: AnnotationClass[];
  allowedGeometryTypes?: string[];
  onDrawingStart?: () => void;
  onDrawingEnd?: () => void;
}

/**
 * AnnotationDrawingTools
 *
 * Supports two modes:
 * 1. Explicit set: `annotationSetId` provided → POST /annotation-sets/{id}/annotations
 * 2. Auto-set: only `mapId` provided → POST /maps/{mapId}/annotations (backend creates set if needed)
 */
export function AnnotationDrawingTools({
  annotationSetId,
  mapId,
  schemaId,
  schemaClasses,
  onDrawingStart,
  onDrawingEnd,
}: AnnotationDrawingToolsProps) {
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const createAnnotationMutation = useCreateAnnotation();
  const createOnMapMutation = useCreateAnnotationOnMap();

  const {
    pendingAnnotation,
    isDrawing,
    setIsDrawing,
    clearPendingAnnotation,
  } = useAnnotationStore();

  const isSaving = createAnnotationMutation.isPending || createOnMapMutation.isPending;

  const handleStartDrawing = () => {
    if (!selectedClassId) {
      toast.error('Please select an annotation class');
      return;
    }
    setIsDrawing(true);
    onDrawingStart?.();
  };

  const handleSaveDrawing = async () => {
    if (!pendingAnnotation.geometry || !selectedClassId) {
      toast.error('No geometry or class selected');
      return;
    }

    try {
      if (annotationSetId) {
        // Explicit set mode
        await createAnnotationMutation.mutateAsync({
          setId: annotationSetId,
          classId: selectedClassId,
          geometry: pendingAnnotation.geometry as any,
          properties: pendingAnnotation.properties ?? undefined,
        });
      } else if (mapId) {
        // Auto-set mode — backend finds or creates the set
        await createOnMapMutation.mutateAsync({
          mapId,
          classId: selectedClassId,
          geometry: pendingAnnotation.geometry as any,
          properties: pendingAnnotation.properties ?? undefined,
          schemaId: schemaId ?? null,
        });
      } else {
        toast.error('No annotation set or map specified');
        return;
      }
      toast.success('Annotation saved');
      onDrawingEnd?.();
    } catch {
      toast.error('Failed to save annotation');
    }
  };

  const handleCancelDrawing = () => {
    clearPendingAnnotation();
    onDrawingEnd?.();
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="font-semibold text-sm">Add Annotation</h3>
      </div>

      <div className="space-y-3">
        {/* Class selector */}
        <div>
          <label className="text-xs font-medium text-gray-700 block mb-1">
            Annotation Class
          </label>
          <Select value={selectedClassId} onValueChange={setSelectedClassId}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="Select a class..." />
            </SelectTrigger>
            <SelectContent>
              {schemaClasses.map((cls) => (
                <SelectItem key={cls.id} value={cls.id}>
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded"
                      style={{
                        backgroundColor: (cls.style?.definition?.fillColor as string) ?? '#ccc',
                      }}
                    />
                    {cls.name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Drawing status */}
        {isDrawing && (
          <div className="flex items-center gap-2 p-2 rounded-md bg-blue-50 text-blue-700 text-xs">
            <AlertCircle className="w-4 h-4" />
            <span>Draw on the map to create an annotation</span>
          </div>
        )}

        {pendingAnnotation.geometry && (
          <div className="flex items-center gap-2 p-2 rounded-md bg-green-50 text-green-700 text-xs">
            <CheckCircle2 className="w-4 h-4" />
            <span>Geometry ready to save</span>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2">
          {!isDrawing ? (
            <Button
              size="sm"
              className="flex-1"
              onClick={handleStartDrawing}
              disabled={!selectedClassId}
            >
              Start Drawing
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                className="flex-1"
                variant="default"
                onClick={handleSaveDrawing}
                disabled={!pendingAnnotation.geometry || isSaving}
              >
                {isSaving ? 'Saving...' : 'Save'}
              </Button>
              <Button
                size="sm"
                className="flex-1"
                variant="outline"
                onClick={handleCancelDrawing}
                disabled={isSaving}
              >
                Cancel
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
