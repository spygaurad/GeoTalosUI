'use client';

import { useQuery } from '@tanstack/react-query';
import { Pencil, Layers } from 'lucide-react';
import { useMapLayersStore } from '@/stores/mapLayersStore';
import { annotationSetsApi } from '@/lib/api/annotation-sets';
import { annotationSchemasApi } from '@/lib/api/annotation-schemas';
import { qk } from '@/lib/query-keys';
import type { AnnotationClass } from '@/types/api';
import { MC } from '../../mapColors';

interface AnnotationSetPanelProps {
  annotationSetId: string;
}

export function AnnotationSetPanel({ annotationSetId }: AnnotationSetPanelProps) {
  const openAnnotationPanel = useMapLayersStore((s) => s.openAnnotationPanel);
  const layerId = `annset-${annotationSetId}`;
  const layer = useMapLayersStore((s) => s.layers[layerId]);
  const setLayerOpacity = useMapLayersStore((s) => s.setLayerOpacity);

  const { data: annSet, isLoading } = useQuery({
    queryKey: qk.annotationSets.detail(annotationSetId),
    queryFn: () => annotationSetsApi.get(annotationSetId),
    enabled: !!annotationSetId,
    retry: 2,
    retryDelay: 1000,
  });

  const { data: schema } = useQuery({
    queryKey: qk.annotationSchemas.detail(annSet?.schema_id ?? ''),
    queryFn: () => annotationSchemasApi.get(annSet!.schema_id!),
    enabled: !!annSet?.schema_id,
  });

  const classes = schema?.classes ?? annSet?.schema?.classes ?? [];
  const geometryTypes = schema?.geometry_types ?? [];

  const handleAddAnnotation = () => {
    // Open the annotation panel, pre-filled with this set's info
    openAnnotationPanel();
    // Set the pending annotation's set/class after a tick (after state update)
    setTimeout(() => {
      const store = useMapLayersStore.getState();
      if (store.pendingAnnotation) {
        store.setPendingAnnotationField({
          annotationSetId: annotationSetId,
          classId: classes[0]?.id,
        });
      }
    }, 0);
  };

  if (isLoading) {
    return (
      <div style={{ padding: '20px 14px', textAlign: 'center' }}>
        <div style={{ fontSize: 12, color: MC.textMuted }}>Loading...</div>
      </div>
    );
  }

  if (!annSet) {
    return (
      <div style={{ padding: '20px 14px', textAlign: 'center' }}>
        <div style={{ fontSize: 12, color: MC.textMuted }}>Annotation set not found</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
      {/* Header info */}
      <Section title="Annotation Set">
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: MC.text }}>{annSet.name}</div>
          {annSet.description && (
            <div style={{ fontSize: 11, color: MC.textMuted, marginTop: 4, lineHeight: 1.4 }}>
              {annSet.description}
            </div>
          )}
        </div>
        {annSet.annotation_count != null && (
          <div style={{ fontSize: 11, color: MC.textMuted }}>
            {annSet.annotation_count} annotation{annSet.annotation_count !== 1 ? 's' : ''}
          </div>
        )}
        {schema && (
          <div style={{ fontSize: 11, color: MC.textMuted, marginTop: 4 }}>
            Schema: {schema.name} (v{schema.version})
          </div>
        )}
        {geometryTypes.length > 0 && (
          <div style={{ fontSize: 10, color: MC.textMuted, marginTop: 4 }}>
            Geometry: {geometryTypes.join(', ')}
          </div>
        )}
      </Section>

      {/* Classes */}
      {classes.length > 0 && (
        <Section title="Classes">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {renderClassTree(classes)}
          </div>
        </Section>
      )}

      {/* Layer opacity */}
      {layer && (
        <Section title="Opacity">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="range" min={0} max={100}
              value={Math.round(layer.opacity * 100)}
              aria-label="Layer opacity"
              aria-valuetext={`${Math.round(layer.opacity * 100)}%`}
              onChange={(e) => setLayerOpacity(layerId, Number(e.target.value) / 100)}
              style={{ flex: 1, accentColor: MC.accent, cursor: 'pointer' }}
            />
            <span style={{ fontSize: 11, color: MC.textMuted, width: 32, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {Math.round(layer.opacity * 100)}%
            </span>
          </div>
        </Section>
      )}

      {/* Add annotation button */}
      <div style={{
        padding: '12px 14px 16px',
        borderTop: `1px solid ${MC.border}`,
        flexShrink: 0,
        marginTop: 'auto',
      }}>
        <button
          onClick={handleAddAnnotation}
          style={{
            width: '100%',
            height: 34,
            borderRadius: 5,
            border: `1.5px solid ${MC.accent}`,
            background: MC.accentDim,
            color: MC.accent,
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.03em',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <Pencil size={12} />
          Add Annotation
        </button>
      </div>
    </div>
  );
}

// ── Class tree rendering ─────────────────────────────────────────────────────

function renderClassTree(classes: AnnotationClass[]) {
  // Build a flat list, indented by path depth
  const sorted = [...classes].sort((a, b) => (a.path ?? a.name).localeCompare(b.path ?? b.name));

  return sorted.map((cls) => {
    const depth = cls.path ? cls.path.split('.').length - 1 : 0;
    const color = cls.style?.definition?.fillColor ?? MC.accent;

    return (
      <div
        key={cls.id}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          paddingLeft: depth * 16,
        }}
      >
        <div style={{
          width: 10,
          height: 10,
          borderRadius: 2,
          background: color,
          flexShrink: 0,
          opacity: 0.85,
        }} />
        <span style={{
          fontSize: 12,
          color: MC.text,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {cls.name}
        </span>
      </div>
    );
  });
}

// ── Section wrapper ──────────────────────────────────────────────────────────

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
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <Layers size={11} />
        {title}
      </div>
      {children}
    </div>
  );
}
