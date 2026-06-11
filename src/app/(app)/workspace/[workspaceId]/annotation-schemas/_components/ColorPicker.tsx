'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { C, PRESET_COLORS } from './constants';

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  label: string;
}

export function ColorPicker({ value, onChange, label }: ColorPickerProps) {
  const [showPicker, setShowPicker] = useState(false);

  return (
    <div style={{ position: 'relative' }}>
      <label style={{ display: 'block', fontSize: '0.75rem', color: C.textMuted, marginBottom: 4 }}>
        {label}
      </label>
      <button
        type="button"
        onClick={() => setShowPicker(!showPicker)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          borderRadius: 6,
          border: `1px solid ${C.border}`,
          background: C.canvas,
          cursor: 'pointer',
          width: '100%',
        }}
      >
        <div
          style={{
            width: 18,
            height: 18,
            borderRadius: 4,
            background: value,
            border: `1px solid ${C.borderAccent}`,
          }}
        />
        <span style={{ fontSize: '0.8125rem', color: C.text, flex: 1, textAlign: 'left' }}>
          {value}
        </span>
        <ChevronDown size={12} style={{ color: C.textMuted }} />
      </button>

      {showPicker && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            padding: 8,
            background: C.canvas,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
            zIndex: 50,
            width: 'max-content',
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4, marginBottom: 8 }}>
            {PRESET_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => {
                  onChange(color);
                  setShowPicker(false);
                }}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 4,
                  background: color,
                  border: value === color ? `2px solid ${C.text}` : `1px solid ${C.border}`,
                  cursor: 'pointer',
                }}
              />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="color"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              style={{ width: 32, height: 28, border: 'none', borderRadius: 4, cursor: 'pointer' }}
            />
            <input
              type="text"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              style={{
                flex: 1,
                fontSize: '0.75rem',
                padding: '4px 8px',
                border: `1px solid ${C.border}`,
                borderRadius: 4,
                outline: 'none',
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
