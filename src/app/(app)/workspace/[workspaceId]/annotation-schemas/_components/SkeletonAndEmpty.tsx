'use client';

import { Plus, Grid3X3 } from 'lucide-react';
import { C } from './constants';

export function SkeletonRows() {
  return (
    <div>
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            marginBottom: 12,
            padding: '16px',
            background: C.canvas,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: C.accentLight }} />
            <div style={{ flex: 1 }}>
              <div style={{ height: 14, width: `${40 + i * 15}%`, background: C.accentLight, borderRadius: 4 }} />
              <div style={{ height: 10, width: '30%', background: '#f0e4d4', borderRadius: 4, marginTop: 8 }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

interface EmptyStateProps {
  onCreateSchema: () => void;
}

export function EmptyState({ onCreateSchema }: EmptyStateProps) {
  return (
    <div style={{ padding: '64px 20px', textAlign: 'center' }}>
      <Grid3X3 size={32} style={{ color: C.textMuted, margin: '0 auto 16px', display: 'block', opacity: 0.4 }} />
      <p style={{ fontSize: '1rem', fontWeight: 600, color: C.text, marginBottom: 6 }}>
        No annotation schemas yet
      </p>
      <p
        style={{
          fontSize: '0.875rem',
          color: C.textMuted,
          marginBottom: 24,
          maxWidth: 400,
          marginLeft: 'auto',
          marginRight: 'auto',
        }}
      >
        Annotation schemas define the categories and styling for your map annotations.
        Create a schema to start organizing your annotation workflow.
      </p>
      <button
        onClick={onCreateSchema}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 7,
          height: 38,
          padding: '0 18px',
          borderRadius: 8,
          border: 'none',
          background: C.accent,
          color: '#faf8f4',
          fontSize: '0.875rem',
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        <Plus size={15} />
        Create first schema
      </button>
    </div>
  );
}
