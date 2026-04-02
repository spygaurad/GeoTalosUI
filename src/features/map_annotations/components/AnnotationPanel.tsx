'use client';

import React, { useState } from 'react';
import type { AnnotationSet, AnnotationSchema } from '@/types/api';
import { useAnnotationSchema } from '@/features/maps/hooks/useAnnotations';
import { useAnnotationStore } from '@/stores/annotationStore';
import {
  AnnotationStyleManager,
  AnnotationDrawingTools,
} from '@/features/map_annotations/components';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Palette } from 'lucide-react';

interface AnnotationPanelProps {
  annotationSet: AnnotationSet;
  onClose?: () => void;
}

/**
 * AnnotationPanel
 * Right-panel component for annotation management.
 * Shows:
 * - Class legend with colors
 * - Annotation drawing tools
 * - Option to edit class colors
 * - Feature list (if available)
 */
export function AnnotationPanel({ annotationSet }: AnnotationPanelProps) {
  const [showStyleManager, setShowStyleManager] = useState(false);
  const { schema } = useAnnotationSchema(annotationSet.schema_id);
  const { schemaClasses } = useAnnotationStore();

  const classes = (schema as any)?.classes ?? [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h2 className="font-bold text-lg">{annotationSet.name}</h2>
        {annotationSet.description && (
          <p className="text-sm text-gray-600">{annotationSet.description}</p>
        )}
      </div>

      <Separator />

      {/* Legend */}
      {classes.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-semibold text-sm">Classes</h3>
          <div className="space-y-2">
            {classes.map((cls: any) => {
              const fillColor = (cls.style?.definition?.fillColor as string) ?? '#ccc';
              return (
                <div key={cls.id} className="flex items-center gap-2">
                  <div
                    className="w-4 h-4 rounded border border-gray-300"
                    style={{ backgroundColor: fillColor }}
                  />
                  <span className="text-sm">{cls.name}</span>
                </div>
              );
            })}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="w-full gap-2 mt-2"
            onClick={() => setShowStyleManager(true)}
          >
            <Palette className="w-4 h-4" />
            Edit Colors
          </Button>
        </div>
      )}

      <Separator />

      {/* Drawing tools */}
      {annotationSet.schema_id && schema && (
        <AnnotationDrawingTools
          annotationSetId={annotationSet.id}
          schemaClasses={classes as any}
          allowedGeometryTypes={(schema as AnnotationSchema).geometry_types}
        />
      )}

      {/* Annotation count */}
      <div className="text-xs text-gray-500">
        {annotationSet.annotation_count ?? 0} annotations
      </div>

      {/* Style manager modal */}
      {schema && (
        <AnnotationStyleManager
          schemaId={(schema as any).id}
          classes={classes as any}
          isOpen={showStyleManager}
          onClose={() => setShowStyleManager(false)}
        />
      )}
    </div>
  );
}
