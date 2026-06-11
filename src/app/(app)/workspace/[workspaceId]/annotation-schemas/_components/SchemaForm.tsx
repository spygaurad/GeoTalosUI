'use client';

import { useState } from 'react';
import { C, GEOMETRY_TYPES } from './constants';

export interface SchemaFormData {
  name: string;
  description: string;
  geometry_types: string[];
}

interface SchemaFormProps {
  initialData?: Partial<SchemaFormData>;
  onSubmit: (data: SchemaFormData) => void;
  onCancel: () => void;
  isSubmitting: boolean;
  isEdit?: boolean;
}

export function SchemaForm({ initialData, onSubmit, onCancel, isSubmitting, isEdit = false }: SchemaFormProps) {
  const [form, setForm] = useState<SchemaFormData>({
    name: initialData?.name ?? '',
    description: initialData?.description ?? '',
    geometry_types: initialData?.geometry_types ?? ['Polygon'],
  });

  const toggleGeometry = (g: string) => {
    setForm((f) => ({
      ...f,
      geometry_types: f.geometry_types.includes(g)
        ? f.geometry_types.filter((x) => x !== g)
        : [...f.geometry_types, g],
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || form.geometry_types.length === 0) return;
    onSubmit(form);
  };

  return (
    <form onSubmit={handleSubmit} style={{ padding: 20 }}>
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: '0.75rem', color: C.textMuted, marginBottom: 4 }}>
          Schema Name *
        </label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="e.g., Forest Species Classification"
          required
          style={{
            width: '100%',
            padding: '10px 12px',
            fontSize: '0.875rem',
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            outline: 'none',
            background: C.canvas,
          }}
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: '0.75rem', color: C.textMuted, marginBottom: 4 }}>
          Description
        </label>
        <textarea
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          placeholder="Optional description..."
          rows={2}
          style={{
            width: '100%',
            padding: '10px 12px',
            fontSize: '0.875rem',
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            outline: 'none',
            background: C.canvas,
            resize: 'vertical',
          }}
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: '0.75rem', color: C.textMuted, marginBottom: 8 }}>
          Allowed Geometry Types *
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {GEOMETRY_TYPES.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => toggleGeometry(g)}
              style={{
                padding: '6px 12px',
                fontSize: '0.8125rem',
                border: `1px solid ${form.geometry_types.includes(g) ? C.accent : C.border}`,
                borderRadius: 6,
                background: form.geometry_types.includes(g) ? C.accentLight : 'transparent',
                color: form.geometry_types.includes(g) ? C.accent : C.textSec,
                cursor: 'pointer',
                fontWeight: form.geometry_types.includes(g) ? 500 : 400,
              }}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: '8px 16px',
            fontSize: '0.8125rem',
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            background: 'transparent',
            color: C.textSec,
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting || !form.name.trim() || form.geometry_types.length === 0}
          style={{
            padding: '8px 16px',
            fontSize: '0.8125rem',
            border: 'none',
            borderRadius: 6,
            background: C.accent,
            color: '#fff',
            cursor: isSubmitting ? 'not-allowed' : 'pointer',
            opacity: isSubmitting ? 0.7 : 1,
          }}
        >
          {isSubmitting ? 'Saving...' : isEdit ? 'Update Schema' : 'Create Schema'}
        </button>
      </div>
    </form>
  );
}
