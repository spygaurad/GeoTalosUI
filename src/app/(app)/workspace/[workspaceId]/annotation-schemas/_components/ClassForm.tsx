'use client';

import { useState } from 'react';
import { Palette } from 'lucide-react';
import { C, darkenHex } from './constants';
import { ColorPicker } from './ColorPicker';

export interface ClassFormData {
  name: string;
  description: string;
  parent_id: string | null;
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  fillOpacity: number;
}

interface ClassFormProps {
  initialData?: Partial<ClassFormData>;
  parentOptions: { id: string; name: string }[];
  onSubmit: (data: ClassFormData) => void;
  onCancel: () => void;
  isSubmitting: boolean;
  isEdit?: boolean;
}

export function ClassForm({
  initialData,
  parentOptions,
  onSubmit,
  onCancel,
  isSubmitting,
  isEdit = false,
}: ClassFormProps) {
  const [form, setForm] = useState<ClassFormData>({
    name: initialData?.name ?? '',
    description: initialData?.description ?? '',
    parent_id: initialData?.parent_id ?? null,
    fillColor: initialData?.fillColor ?? '#3498db',
    strokeColor: initialData?.strokeColor ?? '#2980b9',
    strokeWidth: initialData?.strokeWidth ?? 2,
    fillOpacity: initialData?.fillOpacity ?? 0.5,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    onSubmit(form);
  };

  return (
    <form onSubmit={handleSubmit} style={{ padding: '16px 20px' }}>
      <div style={{ display: 'flex', gap: 20 }}>
        {/* Left column: Name & Parent */}
        <div style={{ flex: 1 }}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: '0.75rem', color: C.textMuted, marginBottom: 4 }}>
              Class Name *
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g., Deciduous Tree"
              required
              style={{
                width: '100%',
                padding: '8px 12px',
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
                padding: '8px 12px',
                fontSize: '0.875rem',
                border: `1px solid ${C.border}`,
                borderRadius: 6,
                outline: 'none',
                background: C.canvas,
                resize: 'vertical',
              }}
            />
          </div>

          {parentOptions.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: '0.75rem', color: C.textMuted, marginBottom: 4 }}>
                Parent Class
              </label>
              <select
                value={form.parent_id ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, parent_id: e.target.value || null }))}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  fontSize: '0.875rem',
                  border: `1px solid ${C.border}`,
                  borderRadius: 6,
                  outline: 'none',
                  background: C.canvas,
                }}
              >
                <option value="">None (top-level class)</option>
                {parentOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Right column: Style */}
        <div style={{ width: 200, borderLeft: `1px solid ${C.border}`, paddingLeft: 20 }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: C.text, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Palette size={12} />
            Style
          </div>

          {/* Preview */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: 60,
              marginBottom: 16,
              background: '#f5f5f5',
              borderRadius: 6,
              border: `1px solid ${C.border}`,
            }}
          >
            <svg width="50" height="40" viewBox="0 0 50 40">
              <polygon
                points="25,5 45,35 5,35"
                fill={form.fillColor}
                fillOpacity={form.fillOpacity}
                stroke={form.strokeColor}
                strokeWidth={form.strokeWidth}
              />
            </svg>
          </div>

          <ColorPicker
            label="Color"
            value={form.fillColor}
            onChange={(c) => setForm((f) => ({ ...f, fillColor: c, strokeColor: darkenHex(c) }))}
          />

          <div style={{ marginTop: 12 }}>
            <label style={{ display: 'block', fontSize: '0.75rem', color: C.textMuted, marginBottom: 4 }}>
              Stroke Width
            </label>
            <input
              type="range"
              min="0"
              max="10"
              step="0.5"
              value={form.strokeWidth}
              onChange={(e) => setForm((f) => ({ ...f, strokeWidth: Number(e.target.value) }))}
              style={{ width: '100%' }}
            />
            <div style={{ fontSize: '0.7rem', color: C.textMuted, textAlign: 'center' }}>
              {form.strokeWidth}px
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <label style={{ display: 'block', fontSize: '0.75rem', color: C.textMuted, marginBottom: 4 }}>
              Fill Opacity
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={form.fillOpacity}
              onChange={(e) => setForm((f) => ({ ...f, fillOpacity: Number(e.target.value) }))}
              style={{ width: '100%' }}
            />
            <div style={{ fontSize: '0.7rem', color: C.textMuted, textAlign: 'center' }}>
              {Math.round(form.fillOpacity * 100)}%
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
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
          disabled={isSubmitting || !form.name.trim()}
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
          {isSubmitting ? 'Saving...' : isEdit ? 'Update Class' : 'Add Class'}
        </button>
      </div>
    </form>
  );
}
