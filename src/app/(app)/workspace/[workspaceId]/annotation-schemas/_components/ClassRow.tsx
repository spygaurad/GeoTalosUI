'use client';

import { useState } from 'react';
import { ChevronRight, ChevronDown, Plus, Pencil, Trash2 } from 'lucide-react';
import type { AnnotationClass } from '@/types/api';
import { C } from './constants';
import { StyleSwatch } from './StyleSwatch';

interface ClassRowProps {
  cls: AnnotationClass;
  depth: number;
  isExpanded: boolean;
  hasChildren: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onAddSubclass: () => void;
  onDelete: () => void;
}

export function ClassRow({
  cls,
  depth,
  isExpanded,
  hasChildren,
  onToggle,
  onEdit,
  onAddSubclass,
  onDelete,
}: ClassRowProps) {
  const [hovered, setHovered] = useState(false);
  const style = cls.style?.definition;
  const fillColor = style?.fillColor ?? '#ccc';
  const strokeColor = style?.strokeColor ?? '#666';

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 16px',
        paddingLeft: 16 + depth * 24,
        borderBottom: `1px solid ${C.border}`,
        background: hovered ? C.rowHover : 'transparent',
        transition: 'background 0.1s',
      }}
    >
      {/* Expand toggle */}
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: 20,
          height: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'none',
          border: 'none',
          cursor: hasChildren ? 'pointer' : 'default',
          color: hasChildren ? C.textMuted : 'transparent',
          padding: 0,
        }}
        disabled={!hasChildren}
      >
        {hasChildren && (isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
      </button>

      {/* Style swatch */}
      <StyleSwatch fill={fillColor} stroke={strokeColor} />

      {/* Name */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.875rem', fontWeight: 500, color: C.text }}>
          {cls.name}
        </div>
        {cls.path && (
          <div style={{ fontSize: '0.7rem', color: C.textMuted, marginTop: 1 }}>
            {cls.path}
          </div>
        )}
      </div>

      {/* Style info */}
      <div style={{ fontSize: '0.75rem', color: C.textMuted, width: 100, textAlign: 'right' }}>
        {cls.style?.name ?? '—'}
      </div>

      {/* Actions */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          opacity: hovered ? 1 : 0,
          transition: 'opacity 0.15s',
        }}
      >
        <button
          type="button"
          onClick={onAddSubclass}
          title="Add subclass"
          style={{
            padding: 6,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: C.textMuted,
            borderRadius: 4,
          }}
        >
          <Plus size={14} />
        </button>
        <button
          type="button"
          onClick={onEdit}
          title="Edit class"
          style={{
            padding: 6,
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
          title="Delete class"
          style={{
            padding: 6,
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
  );
}
