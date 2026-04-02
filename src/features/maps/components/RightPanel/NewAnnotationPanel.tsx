'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMapLayersStore } from '@/stores/mapLayersStore';
import { useMapStore } from '@/stores/mapStore';
import { annotationSetsApi } from '@/lib/api/annotation-sets';
import { annotationSchemasApi } from '@/lib/api/annotation-schemas';
import { qk } from '@/lib/query-keys';
import { MC } from '../../mapColors';
import { AnnotationGeometryPreview } from './_annotation/AnnotationGeometryPreview';
import { AnnotationStylePicker } from './_annotation/AnnotationStylePicker';
import { AnnotationAttributeEditor } from './_annotation/AnnotationAttributeEditor';
import type { AnnotationClass, AnnotationSchema } from '@/types/api';
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  CheckCircle2,
  Trash2,
} from 'lucide-react';

// ── Styles ──────────────────────────────────────────────────────────────────

const dropdownStyle: React.CSSProperties = {
  width: '100%',
  background: MC.inputBg,
  border: `1px solid ${MC.inputBorder}`,
  borderRadius: 5,
  color: MC.text,
  fontSize: 12,
  padding: '6px 8px',
  outline: 'none',
  boxSizing: 'border-box',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  position: 'relative' as const,
};

const dropdownMenuStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  right: 0,
  marginTop: 2,
  background: MC.inputBg,
  border: `1px solid ${MC.inputBorder}`,
  borderRadius: 5,
  boxShadow: MC.shadow,
  maxHeight: 220,
  overflowY: 'auto',
  zIndex: 100,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: MC.inputBg,
  border: `1px solid ${MC.inputBorder}`,
  borderRadius: 5,
  color: MC.text,
  fontSize: 12,
  padding: '6px 8px',
  outline: 'none',
  boxSizing: 'border-box',
};

// ── Helpers: build a class tree from flat list ──────────────────────────────

interface ClassTreeNode {
  cls: AnnotationClass;
  children: ClassTreeNode[];
  depth: number;
}

function buildClassTree(classes: AnnotationClass[]): ClassTreeNode[] {
  const childrenMap = new Map<string | null, AnnotationClass[]>();

  for (const cls of classes) {
    const parentKey = cls.parent_id ?? null;
    if (!childrenMap.has(parentKey)) childrenMap.set(parentKey, []);
    childrenMap.get(parentKey)!.push(cls);
  }

  function buildNodes(parentId: string | null, depth: number): ClassTreeNode[] {
    const children = childrenMap.get(parentId) ?? [];
    return children.map((cls) => ({
      cls,
      children: buildNodes(cls.id, depth + 1),
      depth,
    }));
  }

  return buildNodes(null, 0);
}

/** Flatten tree to ordered list with depth for indentation */
function flattenTree(nodes: ClassTreeNode[]): ClassTreeNode[] {
  const result: ClassTreeNode[] = [];
  function walk(list: ClassTreeNode[]) {
    for (const node of list) {
      result.push(node);
      walk(node.children);
    }
  }
  walk(nodes);
  return result;
}

// ── Component ────────────────────────────────────────────────────────────────

interface NewAnnotationPanelProps {
  mapId?: string;
  projectId?: string;
}

export function NewAnnotationPanel({ mapId }: NewAnnotationPanelProps) {
  const queryClient = useQueryClient();
  const pending      = useMapLayersStore((s) => s.pendingAnnotation);
  const setField     = useMapLayersStore((s) => s.setPendingAnnotationField);
  const setStyle     = useMapLayersStore((s) => s.setPendingAnnotationStyle);
  const addAttr      = useMapLayersStore((s) => s.addPendingAnnotationAttribute);
  const updateAttr   = useMapLayersStore((s) => s.updatePendingAnnotationAttribute);
  const removeAttr   = useMapLayersStore((s) => s.removePendingAnnotationAttribute);
  const clearPending = useMapLayersStore((s) => s.clearPendingAnnotation);

  const drawnShapeType    = useMapStore((s) => s.drawnShapeType);
  const drawnGeometry     = useMapStore((s) => s.drawnGeometry);
  const drawnCircleRadius = useMapStore((s) => s.drawnCircleRadius);

  // ── Local state ───────────────────────────────────────────────────────────
  const [selectedSchemaId, setSelectedSchemaId] = useState<string>('');
  const [selectedClassId, setSelectedClassId] = useState<string>(pending?.classId ?? '');
  const [classDropdownOpen, setClassDropdownOpen] = useState(false);
  const [schemaDropdownOpen, setSchemaDropdownOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const savingRef = useRef(false);
  const classDropdownRef = useRef<HTMLDivElement>(null);
  const schemaDropdownRef = useRef<HTMLDivElement>(null);

  // ── Recent classes (persisted in localStorage) ──────────────────────────
  const RECENT_KEY = 'awakeforest:recentAnnotationClasses';
  const MAX_RECENT = 5;

  const getRecentClasses = useCallback((): { schemaId: string; classId: string; className: string; fillColor: string }[] => {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); } catch { return []; }
  }, []);

  const [recentClasses, setRecentClasses] = useState(getRecentClasses);

  const saveRecentClass = useCallback((schemaId: string, classId: string, className: string, fillColor: string) => {
    const recent = getRecentClasses().filter((r) => r.classId !== classId);
    recent.unshift({ schemaId, classId, className, fillColor });
    const trimmed = recent.slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(trimmed));
    setRecentClasses(trimmed);
  }, [getRecentClasses]);

  // ── Fetch org-level schemas ───────────────────────────────────────────────
  const { data: schemasData, isLoading: schemasLoading } = useQuery({
    queryKey: qk.annotationSchemas.list(),
    queryFn: () => annotationSchemasApi.list(),
    staleTime: 60_000,
  });
  const availableSchemas: AnnotationSchema[] = schemasData?.items ?? [];

  // ── Fetch classes for the selected schema (separate endpoint) ─────────────
  const { data: classesData, isLoading: classesLoading } = useQuery({
    queryKey: qk.annotationSchemas.classes(selectedSchemaId),
    queryFn: () => annotationSchemasApi.getClasses(selectedSchemaId),
    enabled: !!selectedSchemaId,
    staleTime: 60_000,
  });
  const classes: AnnotationClass[] = classesData?.items ?? [];
  const classTree = buildClassTree(classes);
  const flatClasses = flattenTree(classTree);
  const hasSubClasses = classes.some((c) => c.parent_id !== null);

  // ── Close dropdowns on outside click ──────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (classDropdownRef.current && !classDropdownRef.current.contains(e.target as Node)) {
        setClassDropdownOpen(false);
      }
      if (schemaDropdownRef.current && !schemaDropdownRef.current.contains(e.target as Node)) {
        setSchemaDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Sync class to pending annotation store ────────────────────────────────
  useEffect(() => {
    if (selectedClassId) {
      setField({ classId: selectedClassId });
    }
  }, [selectedClassId, setField]);

  // Reset class selection when schema changes
  useEffect(() => {
    setSelectedClassId('');
    setSaved(false);
  }, [selectedSchemaId]);

  // ── Save mutation: auto-set (map-level) ───────────────────────────────────
  const saveToMapMutation = useMutation({
    mutationFn: (params: { mapId: string; classId: string; geometry: unknown; properties: Record<string, unknown> | null; schemaId: string; setName?: string }) =>
      annotationSetsApi.addFeatureOnMap(params.mapId, {
        class_id: params.classId,
        geometry: params.geometry as Parameters<typeof annotationSetsApi.addFeatureOnMap>[1]['geometry'],
        properties: params.properties,
        schema_id: params.schemaId,
        set_name: params.setName ?? undefined,
      }),
    onSuccess: (result, vars) => {
      queryClient.invalidateQueries({ queryKey: qk.annotationSets.features(result.annotation_set_id) });
      queryClient.invalidateQueries({ queryKey: qk.annotationSets.detail(result.annotation_set_id) });
      queryClient.invalidateQueries({ queryKey: qk.annotationSets.listByMap(vars.mapId) });
      // Signal MapEditorShell to re-fetch this set's features on the map
      useMapLayersStore.getState().requestAnnotationSetRefresh(result.annotation_set_id);
      setSaved(true);
      toast.success('Annotation saved');
    },
    onError: () => {
      toast.error('Failed to save annotation');
      savingRef.current = false;
    },
  });

  const isSaving = saveToMapMutation.isPending;

  // ── Auto-save when class is selected and geometry exists ──────────────────
  const doAutoSave = useCallback(() => {
    if (!drawnGeometry || !selectedClassId || !selectedSchemaId || !mapId || savingRef.current || saved) return;

    savingRef.current = true;
    const props: Record<string, unknown> = {};
    if (pending) {
      pending.attributes.forEach((attr) => {
        if (attr.key.trim()) props[attr.key] = attr.value;
      });
    }
    const properties = Object.keys(props).length > 0 ? props : null;

    // Use selected class name as set_name so each class gets its own annotation set
    const cls = classes.find((c) => c.id === selectedClassId);
    const className = cls?.name;

    // Save to recent classes
    if (cls) {
      saveRecentClass(selectedSchemaId, cls.id, cls.name, (cls.style?.definition?.fillColor as string) ?? '#ccc');
    }

    saveToMapMutation.mutate(
      { mapId, classId: selectedClassId, geometry: drawnGeometry, properties, schemaId: selectedSchemaId, setName: className },
      { onSettled: () => { savingRef.current = false; } },
    );
  }, [drawnGeometry, selectedClassId, selectedSchemaId, saved, pending, mapId, saveToMapMutation, classes, saveRecentClass]);

  // Trigger auto-save when class is picked
  useEffect(() => {
    if (selectedClassId && drawnGeometry && !saved && mapId && selectedSchemaId) {
      doAutoSave();
    }
  }, [selectedClassId, mapId, selectedSchemaId, drawnGeometry, saved, doAutoSave]);

  // ── Delete: remove drawn geometry and close panel ─────────────────────────
  const handleDelete = () => {
    useMapStore.getState().setDrawnGeometry(null);
    clearPending();
  };

  if (!pending) return null;

  const isPoint = drawnShapeType === 'point';
  const selectedClassName = classes.find((c) => c.id === selectedClassId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>

      {/* ── Geometry stats ── */}
      <AnnotationGeometryPreview
        shapeType={drawnShapeType}
        geometry={drawnGeometry}
        circleRadius={drawnCircleRadius}
      />

      {/* ── Style — hidden for point markers ── */}
      {!isPoint && (
        <Section title="Style">
          <AnnotationStylePicker
            style={pending.style}
            shapeType={drawnShapeType}
            onChange={setStyle}
          />
        </Section>
      )}

      {/* ── Recent classes quick-pick ── */}
      {recentClasses.length > 0 && !saved && (
        <Section title="Recent">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {recentClasses.map((r) => {
              const isActive = r.classId === selectedClassId && r.schemaId === selectedSchemaId;
              return (
                <button
                  key={r.classId}
                  onClick={() => {
                    setSelectedSchemaId(r.schemaId);
                    // Defer class selection until schema classes load
                    setTimeout(() => setSelectedClassId(r.classId), 0);
                  }}
                  type="button"
                  title={r.className}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '4px 8px', borderRadius: 4, fontSize: 11,
                    border: `1px solid ${isActive ? MC.accent : MC.inputBorder}`,
                    background: isActive ? MC.accentDim : MC.inputBg,
                    color: isActive ? MC.accent : MC.text,
                    cursor: 'pointer',
                    maxWidth: '100%',
                  }}
                >
                  <span style={{
                    width: 8, height: 8, borderRadius: 2, flexShrink: 0,
                    background: r.fillColor,
                    border: '1px solid rgba(0,0,0,0.1)',
                  }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.className}
                  </span>
                </button>
              );
            })}
          </div>
        </Section>
      )}

      {/* ── Schema selector ── */}
      <Section title="Schema">
        <div style={{ position: 'relative' }} ref={schemaDropdownRef}>
          <button
            onClick={() => setSchemaDropdownOpen(!schemaDropdownOpen)}
            style={dropdownStyle}
            type="button"
          >
            <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {schemasLoading
                ? 'Loading...'
                : availableSchemas.find((s) => s.id === selectedSchemaId)?.name ?? 'Select schema...'}
            </span>
            {schemasLoading ? (
              <Loader2 size={12} style={{ color: MC.textMuted, animation: 'spin 1s linear infinite' }} />
            ) : (
              <ChevronDown size={12} style={{ color: MC.textMuted, flexShrink: 0 }} />
            )}
          </button>

          {schemaDropdownOpen && (
            <div style={dropdownMenuStyle}>
              {availableSchemas.length === 0 ? (
                <div style={{ padding: '10px 12px', fontSize: 11, color: MC.textMuted }}>
                  No schemas available
                </div>
              ) : (
                availableSchemas.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      setSelectedSchemaId(s.id);
                      setSchemaDropdownOpen(false);
                    }}
                    type="button"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                      padding: '7px 10px', border: 'none',
                      background: s.id === selectedSchemaId ? MC.accentDim : 'transparent',
                      color: MC.text, fontSize: 12, cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.name}
                    </span>
                    <span style={{ fontSize: 10, color: MC.textMuted, flexShrink: 0 }}>
                      v{s.version}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </Section>

      {/* ── Class selector ── */}
      {selectedSchemaId && (
        <Section title="Class">
          {classesLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}>
              <Loader2 size={12} style={{ color: MC.textMuted, animation: 'spin 1s linear infinite' }} />
              <span style={{ fontSize: 11, color: MC.textMuted }}>Loading classes...</span>
            </div>
          ) : classes.length === 0 ? (
            <div style={{ fontSize: 11, color: MC.textMuted, fontStyle: 'italic' }}>
              No classes in this schema
            </div>
          ) : (
            <div style={{ position: 'relative' }} ref={classDropdownRef}>
              <button
                onClick={() => setClassDropdownOpen(!classDropdownOpen)}
                style={dropdownStyle}
                type="button"
              >
                {selectedClassName ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        width: 10, height: 10, borderRadius: 2, flexShrink: 0,
                        border: '1px solid rgba(0,0,0,0.1)',
                        backgroundColor: (selectedClassName.style?.definition?.fillColor as string) ?? '#ccc',
                      }}
                    />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {selectedClassName.name}
                    </span>
                  </span>
                ) : (
                  <span style={{ color: MC.textMuted }}>Select class...</span>
                )}
                <ChevronDown size={12} style={{ color: MC.textMuted, flexShrink: 0 }} />
              </button>

              {classDropdownOpen && (
                <div style={dropdownMenuStyle}>
                  {flatClasses.map(({ cls, children, depth }) => {
                    const fillColor = (cls.style?.definition?.fillColor as string) ?? '#ccc';
                    const isSelected = cls.id === selectedClassId;
                    const isParent = children.length > 0;
                    const indent = depth * 16;

                    return (
                      <button
                        key={cls.id}
                        onClick={() => {
                          setSelectedClassId(cls.id);
                          setClassDropdownOpen(false);
                        }}
                        type="button"
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                          padding: `6px 10px 6px ${10 + indent}px`, border: 'none',
                          background: isSelected ? MC.accentDim : 'transparent',
                          color: MC.text, fontSize: 12, cursor: 'pointer', textAlign: 'left',
                          fontWeight: isParent && depth === 0 ? 600 : 400,
                        }}
                      >
                        {depth > 0 && (
                          <span style={{ color: MC.textMuted, fontSize: 10, flexShrink: 0, marginRight: -2 }}>
                            {hasSubClasses ? '└' : ''}
                          </span>
                        )}
                        <span
                          style={{
                            width: 10, height: 10, flexShrink: 0,
                            borderRadius: depth === 0 ? 2 : '50%',
                            border: '1px solid rgba(0,0,0,0.1)',
                            backgroundColor: fillColor,
                          }}
                        />
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {cls.name}
                        </span>
                        {isParent && (
                          <ChevronRight size={10} style={{ color: MC.textMuted, flexShrink: 0 }} />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </Section>
      )}

      {/* ── Description (optional) ── */}
      <Section title="Description">
        <textarea
          placeholder="Optional notes..."
          value={pending.description}
          aria-label="Annotation description"
          onChange={(e) => setField({ description: e.target.value })}
          rows={2}
          style={{ ...inputStyle, resize: 'vertical', lineHeight: '1.4' }}
        />
      </Section>

      {/* ── Custom attributes ── */}
      <Section title="Attributes">
        <AnnotationAttributeEditor
          attributes={pending.attributes}
          onAdd={addAttr}
          onUpdate={updateAttr}
          onRemove={removeAttr}
        />
      </Section>

      {/* ── Status indicator ── */}
      {isSaving && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '8px 14px',
          borderTop: `1px solid ${MC.border}`,
          fontSize: 11, color: MC.accent,
        }}>
          <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
          Saving annotation...
        </div>
      )}

      {saved && !isSaving && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '8px 14px',
          borderTop: `1px solid ${MC.border}`,
          fontSize: 11, color: MC.success,
        }}>
          <CheckCircle2 size={13} />
          Annotation saved
        </div>
      )}

      {/* ── Footer: Delete button ── */}
      <div style={{
        display: 'flex', gap: 8,
        padding: '12px 14px 16px',
        borderTop: `1px solid ${MC.border}`,
        flexShrink: 0, marginTop: 'auto',
      }}>
        <button
          onClick={handleDelete}
          aria-label="Delete drawn shape"
          style={{
            flex: 1, height: 34, borderRadius: 5,
            border: `1px solid ${MC.danger}40`,
            background: `${MC.danger}08`,
            color: MC.danger,
            cursor: 'pointer', fontSize: 12, fontWeight: 600,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}
        >
          <Trash2 size={13} />
          Delete
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      padding: '12px 14px',
      borderBottom: `1px solid ${MC.border}`,
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700,
        letterSpacing: '0.08em', textTransform: 'uppercase',
        color: MC.sectionLabel,
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}
