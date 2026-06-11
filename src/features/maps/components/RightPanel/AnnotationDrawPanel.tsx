'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PenLine, Check, StopCircle } from 'lucide-react';
import { useMapLayersStore } from '@/stores/mapLayersStore';
import { useMapStore } from '@/stores/mapStore';
import { annotationSetsApi } from '@/lib/api/annotation-sets';
import { MC } from '../../mapColors';

function asNonEmptyText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getClassDescription(
  cls: { description?: string | null; properties?: Record<string, unknown> | null } | undefined,
): string | undefined {
  if (!cls) return undefined;
  return asNonEmptyText(cls.description) ?? asNonEmptyText(cls.properties?.description);
}

/**
 * Right-panel content shown when the user is in annotation-draw mode.
 * Lets them pick a class before drawing polygons on the map.
 */
export function AnnotationDrawPanel() {
  const activeSetId = useMapLayersStore((s) => s.activeAnnotationSetId);
  const activeClassId = useMapLayersStore((s) => s.activeAnnotationClassId);
  const setAnnotationDrawClass = useMapLayersStore((s) => s.setAnnotationDrawClass);
  const stopAnnotationDraw = useMapLayersStore((s) => s.stopAnnotationDraw);
  const layers = useMapLayersStore((s) => s.layers);
  const setActiveDrawTool = useMapStore((s) => s.setActiveDrawTool);

  // Find the layer config for the active annotation set
  const layerId = activeSetId ? `annset-${activeSetId}` : null;
  const layer = layerId ? layers[layerId] : null;
  const classStyles = layer?.classStyles ?? {};

  // Fetch the annotation set (with schema.classes) to show real class names
  const { data: setData } = useQuery({
    queryKey: ['annotation-set-draw', activeSetId],
    queryFn: () => annotationSetsApi.get(activeSetId!),
    enabled: !!activeSetId,
    staleTime: 60_000,
  });
  const classes = setData?.schema?.classes ?? [];
  // Fall back to classStyles keys when schema not embedded
  const classIds = classes.length > 0
    ? classes.map((c) => c.id)
    : (() => {
      const keys = Object.keys(classStyles);
      const uuidLike = keys.filter((k) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(k));
      return uuidLike.length > 0 ? uuidLike : keys;
    })();

  // Enable Geoman polygon mode when this panel opens
  useEffect(() => {
    setActiveDrawTool('polygon');
    return () => {
      setActiveDrawTool(null);
    };
  }, [setActiveDrawTool]);

  if (!activeSetId) return null;

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Hint */}
      <div
        style={{
          background: `${MC.accent}15`,
          border: `1px solid ${MC.accent}30`,
          borderRadius: 6,
          padding: '10px 12px',
          fontSize: 12,
          color: MC.text,
          lineHeight: 1.5,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <PenLine size={13} style={{ color: MC.accent, flexShrink: 0 }} />
          <span style={{ fontWeight: 600, color: MC.accent }}>Annotation draw mode</span>
        </div>
        Pick a class below, then draw a polygon on the map. Each shape is saved immediately.
      </div>

      {/* Class picker */}
      {classIds.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: MC.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
            Select class
          </div>
          {classIds.map((cid) => {
            const cls = classes.find((c) => c.id === cid);
            const cs = classStyles[cid];
            const fillColor = cls?.style?.definition?.fillColor ?? cs?.fillColor ?? MC.accent;
            const strokeColor = cls?.style?.definition?.strokeColor ?? cs?.strokeColor ?? MC.accent;
            const label = cls?.name ?? cid.slice(0, 8) + '…';
            const description = getClassDescription(cls);
            const isSelected = activeClassId === cid;
            return (
              <button
                key={cid}
                onClick={() => setAnnotationDrawClass(isSelected ? null : cid)}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  padding: '8px 10px',
                  borderRadius: 5,
                  border: `1px solid ${isSelected ? MC.accent : MC.border}`,
                  background: isSelected ? `${MC.accent}18` : MC.panelBg,
                  cursor: 'pointer',
                  textAlign: 'left',
                  width: '100%',
                  transition: 'all 0.12s',
                }}
              >
                <span
                  style={{
                    width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                    background: fillColor,
                    border: `2px solid ${strokeColor}`,
                    marginTop: description ? 1 : 0,
                  }}
                />
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: 12, color: MC.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {label}
                  </span>
                  {description && (
                    <span style={{
                      marginTop: 1,
                      fontSize: 10,
                      color: MC.textMuted,
                      lineHeight: 1.3,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}>
                      {description}
                    </span>
                  )}
                </span>
                {isSelected && <Check size={12} style={{ color: MC.accent, flexShrink: 0 }} />}
              </button>
            );
          })}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: MC.textMuted, fontStyle: 'italic', textAlign: 'center', padding: '12px 0' }}>
          No classes defined — annotations will have no class.
        </div>
      )}

      {/* Stop button */}
      <button
        onClick={() => stopAnnotationDraw()}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          padding: '8px 12px', borderRadius: 5,
          border: `1px solid ${MC.danger}40`,
          background: `${MC.danger}10`,
          color: MC.danger,
          cursor: 'pointer', fontSize: 12, fontWeight: 600,
          marginTop: 'auto',
        }}
      >
        <StopCircle size={13} />
        Stop drawing
      </button>
    </div>
  );
}
