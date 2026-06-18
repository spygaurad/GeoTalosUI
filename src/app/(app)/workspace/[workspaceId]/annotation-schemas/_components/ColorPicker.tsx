'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { HexColorPicker } from 'react-colorful';
import { C, PRESET_COLORS } from './constants';

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  label: string;
}

export function ColorPicker({ value, onChange, label }: ColorPickerProps) {
  const [showPicker, setShowPicker] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside the picker.
  useEffect(() => {
    if (!showPicker) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPicker]);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <label style={{ display: 'block', fontSize: '0.75rem', color: C.textMuted, marginBottom: 4 }}>
        {label}
      </label>
      <button
        type="button"
        onClick={() => setShowPicker((s) => !s)}
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
            padding: 10,
            background: C.canvas,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
            zIndex: 50,
            width: 'max-content',
          }}
        >
          {/* Full-spectrum palette */}
          <HexColorPicker
            color={value}
            onChange={onChange}
            style={{ width: 200, height: 160 }}
          />

          {/* Quick presets */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(8, 1fr)',
              gap: 4,
              marginTop: 10,
            }}
          >
            {PRESET_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => onChange(color)}
                title={color}
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 4,
                  background: color,
                  border: value.toLowerCase() === color.toLowerCase() ? `2px solid ${C.text}` : `1px solid ${C.border}`,
                  cursor: 'pointer',
                  padding: 0,
                }}
              />
            ))}
          </div>

          {/* Hex input */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}>
            <input
              type="text"
              value={value}
              onChange={(e) => {
                const v = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`;
                onChange(v);
              }}
              style={{
                flex: 1,
                fontSize: '0.75rem',
                padding: '4px 8px',
                border: `1px solid ${C.border}`,
                borderRadius: 4,
                outline: 'none',
                fontFamily: 'monospace',
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
