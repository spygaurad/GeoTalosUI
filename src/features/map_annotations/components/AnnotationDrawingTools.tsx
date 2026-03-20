'use client';

import React, { useState } from 'react';
import type { AnnotationClass } from '@/types/api';
import { useAnnotationStore } from '@/stores/annotationStore';
import { useCreateAnnotation } from '@/features/maps/hooks/useAnnotations';
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
  annotationSetId: string;
  schemaClasses: AnnotationClass[];
  onDrawingStart?: () => void;
  onDrawingEnd?: () => void;
}

/**
 * AnnotationDrawingTools
 * Provides UI controls for drawing annotations and saving them to the backend.
 * - Display available drawing tools (point, line, polygon)
 * - Allow user to select the annotation class
 * - Show pending geometry and save/cancel buttons
 * - POST drawn features to the backend
 */
export function AnnotationDrawingTools({
  annotationSetId,
  schemaClasses,
  onDrawingStart,
  onDrawingEnd,
}: AnnotationDrawingToolsProps) {
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const createAnnotationMutation = useCreateAnnotation();

  const {
    pendingAnnotation,
    isDrawing,
    setIsDrawing,
    clearPendingAnnotation,
  } = useAnnotationStore();

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
      await createAnnotationMutation.mutateAsync({
        setId: annotationSetId,
        classId: selectedClassId,
        geometry: pendingAnnotation.geometry as any,
        properties: pendingAnnotation.properties ?? undefined,
      });
      toast.success('Annotation saved');
      onDrawingEnd?.();
    } catch (error) {
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
                disabled={
                  !pendingAnnotation.geometry || createAnnotationMutation.isPending
                }
              >
                {createAnnotationMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
              <Button
                size="sm"
                className="flex-1"
                variant="outline"
                onClick={handleCancelDrawing}
                disabled={createAnnotationMutation.isPending}
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
