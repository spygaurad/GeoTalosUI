'use client';

import { useState, Fragment } from 'react';
import { ChevronRight, ChevronDown, Pencil, Trash2, Grid3X3, Plus, Layers } from 'lucide-react';
import type { AnnotationSchema, AnnotationClass } from '@/types/api';
import { C } from './constants';
import { ClassRow } from './ClassRow';

interface SchemaRowProps {
  schema: AnnotationSchema;
  isExpanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddClass: () => void;
  onEditClass: (cls: AnnotationClass) => void;
  onDeleteClass: (cls: AnnotationClass) => void;
  onAddSubclass: (parentId: string) => void;
}

export function SchemaRow({
  schema,
  isExpanded,
  onToggle,
  onEdit,
  onDelete,
  onAddClass,
  onEditClass,
  onDeleteClass,
  onAddSubclass,
}: SchemaRowProps) {
  const [headerHovered, setHeaderHovered] = useState(false);
  const [expandedClasses, setExpandedClasses] = useState<Set<string>>(new Set());

  // Build class hierarchy
  const classes = schema.classes ?? [];
  const rootClasses = classes.filter((c) => !c.parent_id);
  const childrenMap = new Map<string, AnnotationClass[]>();
  classes.forEach((c) => {
    if (c.parent_id) {
      const siblings = childrenMap.get(c.parent_id) || [];
      siblings.push(c);
      childrenMap.set(c.parent_id, siblings);
    }
  });

  const toggleClassExpand = (id: string) => {
    setExpandedClasses((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderClass = (cls: AnnotationClass, depth: number) => {
    const children = childrenMap.get(cls.id) || [];
    const hasChildren = children.length > 0;
    const isClsExpanded = expandedClasses.has(cls.id);

    return (
      <Fragment key={cls.id}>
        <ClassRow
          cls={cls}
          depth={depth}
          isExpanded={isClsExpanded}
          hasChildren={hasChildren}
          onToggle={() => toggleClassExpand(cls.id)}
          onEdit={() => onEditClass(cls)}
          onAddSubclass={() => onAddSubclass(cls.id)}
          onDelete={() => onDeleteClass(cls)}
        />
        {hasChildren && isClsExpanded && children.map((child) => renderClass(child, depth + 1))}
      </Fragment>
    );
  };

  return (
    <div
      style={{
        border: `1px solid ${C.borderAccent}`,
        borderRadius: 10,
        overflow: 'hidden',
        marginBottom: 12,
        background: C.canvas,
      }}
    >
      {/* Schema header */}
      <div
        onMouseEnter={() => setHeaderHovered(true)}
        onMouseLeave={() => setHeaderHovered(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '14px 16px',
          background: isExpanded ? C.accentDim : 'transparent',
          cursor: 'pointer',
          transition: 'background 0.1s',
        }}
        onClick={onToggle}
      >
        {/* Expand icon */}
        <div style={{ color: C.textMuted }}>
          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </div>

        {/* Schema icon */}
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            background: `linear-gradient(135deg, ${C.accentLight}, ${C.accent}20)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Grid3X3 size={18} style={{ color: C.accent }} />
        </div>

        {/* Name & meta */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.9375rem', fontWeight: 600, color: C.text }}>
            {schema.name}
          </div>
          <div style={{ fontSize: '0.75rem', color: C.textMuted, marginTop: 2 }}>
            {classes.length} class{classes.length !== 1 ? 'es' : ''} ·{' '}
            {schema.geometry_types.join(', ')}
          </div>
        </div>

        {/* Actions */}
        <div
          style={{
            display: 'flex',
            gap: 4,
            opacity: headerHovered ? 1 : 0,
            transition: 'opacity 0.15s',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={onEdit}
            title="Edit schema"
            style={{
              padding: 8,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: C.textMuted,
              borderRadius: 4,
            }}
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            title="Delete schema"
            style={{
              padding: 8,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: C.danger,
              borderRadius: 4,
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Classes */}
      {isExpanded && (
        <div style={{ borderTop: `1px solid ${C.border}` }}>
          {/* Classes header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 16px',
              background: C.bg,
              borderBottom: `1px solid ${C.border}`,
            }}
          >
            <span style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: C.textMuted }}>
              Classes
            </span>
            <button
              type="button"
              onClick={onAddClass}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 10px',
                fontSize: '0.75rem',
                fontWeight: 500,
                border: `1px solid ${C.accent}`,
                borderRadius: 6,
                background: 'transparent',
                color: C.accent,
                cursor: 'pointer',
              }}
            >
              <Plus size={12} />
              Add class
            </button>
          </div>

          {/* Class list */}
          {rootClasses.length === 0 ? (
            <div style={{ padding: '32px 16px', textAlign: 'center' }}>
              <Layers size={24} style={{ color: C.textMuted, marginBottom: 8, opacity: 0.5 }} />
              <div style={{ fontSize: '0.875rem', color: C.textMuted }}>
                No classes defined yet
              </div>
              <button
                type="button"
                onClick={onAddClass}
                style={{
                  marginTop: 12,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 16px',
                  fontSize: '0.8125rem',
                  fontWeight: 500,
                  border: 'none',
                  borderRadius: 6,
                  background: C.accent,
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                <Plus size={14} />
                Create first class
              </button>
            </div>
          ) : (
            <div>{rootClasses.map((cls) => renderClass(cls, 0))}</div>
          )}
        </div>
      )}
    </div>
  );
}
