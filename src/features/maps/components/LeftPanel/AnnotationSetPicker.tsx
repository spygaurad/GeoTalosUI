'use client';

import { useEffect, useState } from 'react';
import { X, Plus } from 'lucide-react';
import { annotationSetsApi, type AnnotationSetListFilters } from '@/lib/api/annotation-sets';
import type { AnnotationSet } from '@/types/api';
import { MC, MAP_Z } from '../../mapColors';

export interface AnnotationSetPickerProps {
  open: boolean;
  onClose: () => void;
  /** Title shown in the modal header. */
  title: string;
  /** If set, list project-scoped sets via listByProject(projectId, filters). */
  projectId?: string;
  /** Filters passed to the list endpoint. */
  filters?: AnnotationSetListFilters;
  /** Invoked when the user picks a set. */
  onPick: (set: AnnotationSet) => void;
}

/**
 * Generic picker modal for annotation sets.
 *
 * Used in three contexts:
 *  • Top-level "Add annotation layer" → listByOrg({ unattached: true }) for standalone sets.
 *  • Per dataset card → listByProject(projectId, { datasetId }).
 *  • Per STAC item row → listByProject(projectId, { stacItemId }).
 */
export function AnnotationSetPicker({
  open,
  onClose,
  title,
  projectId,
  filters,
  onPick,
}: AnnotationSetPickerProps) {
  const [items, setItems] = useState<AnnotationSet[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setItems(null);
    setError(null);
    const p = projectId
      ? annotationSetsApi.listByProject(projectId, filters)
      : annotationSetsApi.listByOrg(filters);
    p.then((r) => setItems(r.items))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [open, projectId, filters]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        zIndex: MAP_Z.panel + 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 360,
          maxHeight: '70vh',
          background: MC.panelBg,
          border: `1px solid ${MC.panelBorder}`,
          borderRadius: 8,
          boxShadow: MC.shadowMd,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: 40,
            padding: '0 8px 0 14px',
            borderBottom: `1px solid ${MC.navBorder}`,
            background: MC.navBg,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span
            style={{
              flex: 1,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              color: MC.navText,
            }}
          >
            {title}
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 26,
              height: 26,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              color: MC.navTextMuted,
              cursor: 'pointer',
              borderRadius: 4,
            }}
          >
            <X size={14} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
          {error && (
            <div style={{ padding: '16px 14px', color: MC.danger, fontSize: 12 }}>{error}</div>
          )}
          {!error && items === null && (
            <div style={{ padding: '16px 14px', color: MC.textMuted, fontSize: 12 }}>
              Loading…
            </div>
          )}
          {!error && items && items.length === 0 && (
            <div style={{ padding: '16px 14px', color: MC.textMuted, fontSize: 12 }}>
              No annotation sets match.
            </div>
          )}
          {!error &&
            items?.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  onPick(s);
                  onClose();
                }}
                style={{
                  width: '100%',
                  padding: '8px 14px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: `1px solid ${MC.borderLight}`,
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  cursor: 'pointer',
                  color: MC.text,
                }}
              >
                <Plus size={12} style={{ color: MC.accent, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {s.name}
                  </div>
                  {s.schema?.name && (
                    <div style={{ fontSize: 10, color: MC.textMuted }}>{s.schema.name}</div>
                  )}
                </div>
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
