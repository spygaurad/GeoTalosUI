'use client';

import React, { useState } from 'react';
import type { AnnotationClass } from '@/types/api';
import { useUpdateAnnotationClassStyle } from '@/features/maps/hooks/useAnnotations';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';

interface AnnotationStyleManagerProps {
  schemaId: string;
  classes: AnnotationClass[];
  isOpen: boolean;
  onClose: () => void;
}

/**
 * AnnotationStyleManager
 * Displays a list of annotation classes with their current colors.
 * Allows users to edit colors for each class.
 * Changes are persisted to the backend immediately.
 */
export function AnnotationStyleManager({
  schemaId,
  classes,
  isOpen,
  onClose,
}: AnnotationStyleManagerProps) {
  const [editingClassId, setEditingClassId] = useState<string | null>(null);
  const [tempColors, setTempColors] = useState<Record<string, { fill: string; stroke: string }>>({});

  const updateClassStyleMutation = useUpdateAnnotationClassStyle();

  const handleEditClass = (cls: AnnotationClass) => {
    setEditingClassId(cls.id);
    setTempColors((prev) => ({
      ...prev,
      [cls.id]: {
        fill: (cls.style?.definition?.fillColor as string) ?? '#ff0000',
        stroke: (cls.style?.definition?.strokeColor as string) ?? '#800000',
      },
    }));
  };

  const handleSaveStyle = async (classId: string) => {
    const colors = tempColors[classId];
    if (!colors) return;

    try {
      await updateClassStyleMutation.mutateAsync({
        schemaId,
        classId,
        style: {
          fillColor: colors.fill,
          strokeColor: colors.stroke,
          strokeWidth: 2,
          fillOpacity: 0.7,
        },
      });
      toast.success('Class color updated');
      setEditingClassId(null);
    } catch (error) {
      toast.error('Failed to update class color');
    }
  };

  const handleCancel = () => {
    setEditingClassId(null);
    setTempColors({});
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Annotation Class Colors</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 max-h-96 overflow-y-auto">
          {classes.map((cls) => {
            const isEditing = editingClassId === cls.id;
            const colors = tempColors[cls.id] ?? {
              fill: (cls.style?.definition?.fillColor as string) ?? '#ff0000',
              stroke: (cls.style?.definition?.strokeColor as string) ?? '#800000',
            };

            return (
              <div
                key={cls.id}
                className="flex items-center justify-between rounded-lg border p-4 hover:bg-gray-50"
              >
                <div className="flex items-center gap-4 flex-1">
                  <div className="flex gap-2">
                    {/* Fill color preview */}
                    <div
                      className="w-10 h-10 rounded border border-gray-300"
                      style={{ backgroundColor: colors.fill }}
                      title="Fill color"
                    />
                    {/* Stroke color preview */}
                    <div
                      className="w-10 h-10 rounded border-2"
                      style={{ borderColor: colors.stroke }}
                      title="Stroke color"
                    />
                  </div>
                  <div className="min-w-48">
                    <p className="font-medium">{cls.name}</p>
                    {cls.path && <p className="text-sm text-gray-600">{cls.path}</p>}
                  </div>
                </div>

                <div className="flex gap-2">
                  {isEditing ? (
                    <>
                      <div className="flex gap-2">
                        <div>
                          <Label className="text-xs">Fill</Label>
                          <Input
                            type="color"
                            value={colors.fill}
                            onChange={(e) =>
                              setTempColors((prev) => ({
                                ...prev,
                                [cls.id]: { ...prev[cls.id], fill: e.target.value },
                              }))
                            }
                            className="w-16 h-8"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Stroke</Label>
                          <Input
                            type="color"
                            value={colors.stroke}
                            onChange={(e) =>
                              setTempColors((prev) => ({
                                ...prev,
                                [cls.id]: { ...prev[cls.id], stroke: e.target.value },
                              }))
                            }
                            className="w-16 h-8"
                          />
                        </div>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleSaveStyle(cls.id)}
                        disabled={updateClassStyleMutation.isPending}
                        variant="default"
                      >
                        Save
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleCancel}
                        variant="outline"
                        disabled={updateClassStyleMutation.isPending}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleEditClass(cls)}
                    >
                      Edit
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button onClick={onClose} variant="default">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
