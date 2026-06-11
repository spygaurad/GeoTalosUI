'use client';

import { useState, useRef, useEffect } from 'react';
import { HexColorPicker } from 'react-colorful';
import type { DrawTool } from '@/stores/mapStore';
import type { LayerStyle } from '@/features/maps/types';
import { MC } from '../../../mapColors';

const DASH_OPTIONS = [
  { label: 'Solid',     value: '' },
  { label: 'Dashed',    value: '8 4' },
  { label: 'Dotted',    value: '2 4' },
  { label: 'Long dash', value: '16 6' },
];

export interface AnnotationStylePickerProps {
  style: Pick<LayerStyle, 'color' | 'fillColor' | 'fillOpacity' | 'weight' | 'dashArray'>;
  shapeType: DrawTool | null;
  onChange: (partial: Partial<LayerStyle>) => void;
}

/**
 * Color pickers (react-colorful HSL), opacity/weight sliders, dash pattern
 * selector, and an inline SVG preview.
 */
export function AnnotationStylePicker({ style, shapeType, onChange }: AnnotationStylePickerProps) {
  const isPolyline = shapeType === 'polyline';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* ── Stroke color ──────────────────────────────────────── */}
      <ColorField
        label="Stroke color"
        value={style.color}
        onChange={(c) => onChange({ color: c })}
      />

      {/* ── Fill color — polygon shapes only ───────────────────── */}
      {!isPolyline && (
        <ColorField
          label="Fill color"
          value={style.fillColor}
          onChange={(c) => onChange({ fillColor: c })}
        />
      )}

      {/* ── Fill opacity — polygon shapes only ────────────────── */}
      {!isPolyline && (
        <SliderRow
          label="Fill opacity"
          value={Math.round(style.fillOpacity * 100)}
          min={0} max={100} unit="%"
          onChange={(v) => onChange({ fillOpacity: v / 100 })}
        />
      )}

      {/* ── Stroke width ──────────────────────────────────────── */}
      <SliderRow
        label="Line width"
        value={style.weight}
        min={1} max={10} step={0.5} unit="px"
        onChange={(v) => onChange({ weight: v })}
      />

      {/* ── Dash pattern ──────────────────────────────────────── */}
      <div>
        <div style={{ fontSize: 11, color: MC.sectionLabel, marginBottom: 4 }}>Line style</div>
        <div style={{ display: 'flex', gap: 4 }}>
          {DASH_OPTIONS.map((opt) => {
            const active = (style.dashArray ?? '') === opt.value;
            return (
              <button
                key={opt.label}
                onClick={() => onChange({ dashArray: opt.value || undefined })}
                title={opt.label}
                aria-pressed={active}
                style={{
                  flex: 1, height: 28, fontSize: 10, fontWeight: 600,
                  borderRadius: 4,
                  border: `1px solid ${active ? MC.accent : MC.inputBorder}`,
                  background: active ? MC.accentDim : MC.inputBg,
                  color: active ? MC.accent : MC.textMuted,
                  cursor: 'pointer',
                  transition: 'all 0.1s',
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── SVG preview ───────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 4 }}>
        {isPolyline ? (
          <svg width="120" height="24" viewBox="0 0 120 24" aria-hidden="true">
            <polyline
              points="8,18 30,8 60,16 90,6 112,14"
              fill="none"
              stroke={style.color}
              strokeWidth={Math.min(style.weight, 4)}
              strokeDasharray={style.dashArray || undefined}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.9}
            />
          </svg>
        ) : (
          <svg width="120" height="32" viewBox="0 0 120 32" aria-hidden="true">
            <polygon
              points="20,28 60,6 100,28"
              fill={style.fillColor}
              fillOpacity={style.fillOpacity}
              stroke={style.color}
              strokeWidth={Math.min(style.weight, 3)}
              strokeDasharray={style.dashArray || undefined}
            />
          </svg>
        )}
      </div>
    </div>
  );
}

// ── ColorField with HSL picker popover ──────────────────────────────────────

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  const [open, setOpen] = useState(false);
  const [hexInput, setHexInput] = useState(value);
  const ref = useRef<HTMLDivElement>(null);

  // Sync external value → local input
  useEffect(() => { setHexInput(value); }, [value]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleHexSubmit = () => {
    const hex = hexInput.startsWith('#') ? hexInput : `#${hexInput}`;
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
      onChange(hex);
    } else {
      setHexInput(value); // revert
    }
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div style={{ fontSize: 11, color: MC.sectionLabel, marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* Color swatch — click to open picker */}
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label={`Pick ${label.toLowerCase()}`}
          style={{
            width: 32, height: 28, borderRadius: 4,
            border: `1px solid ${MC.inputBorder}`,
            background: value,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        />
        {/* Hex input */}
        <input
          type="text"
          value={hexInput}
          onChange={(e) => setHexInput(e.target.value)}
          onBlur={handleHexSubmit}
          onKeyDown={(e) => { if (e.key === 'Enter') handleHexSubmit(); }}
          aria-label={`${label} hex value`}
          style={{
            width: 72, fontSize: 11, fontFamily: 'monospace',
            color: MC.textSecondary,
            background: MC.inputBg,
            border: `1px solid ${MC.inputBorder}`,
            borderRadius: 4, padding: '4px 6px',
            outline: 'none',
          }}
        />
      </div>

      {/* HSL picker popover */}
      {open && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          marginTop: 4,
          zIndex: 120,
          background: MC.panelBg,
          border: `1px solid ${MC.panelBorder}`,
          borderRadius: 8,
          boxShadow: MC.shadowMd,
          padding: 8,
        }}>
          <HexColorPicker
            color={value}
            onChange={(hex) => { onChange(hex); setHexInput(hex); }}
            style={{ width: 180, height: 160 }}
          />
        </div>
      )}
    </div>
  );
}

// ── Slider ─────────────────────────────────────────────────────────────────

function SliderRow({
  label, value, min, max, step = 1, unit, onChange,
}: {
  label: string; value: number; min: number; max: number;
  step?: number; unit: string; onChange: (v: number) => void;
}) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: MC.sectionLabel }}>{label}</span>
        <span style={{ fontSize: 11, color: MC.textSecondary, fontVariantNumeric: 'tabular-nums' }}>
          {value}{unit}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        aria-label={label}
        aria-valuetext={`${value}${unit}`}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: MC.accent, cursor: 'pointer' }}
      />
    </div>
  );
}
