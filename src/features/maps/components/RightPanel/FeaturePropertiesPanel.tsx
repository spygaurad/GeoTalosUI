'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import type { SelectedFeature } from '@/features/maps/types';
import { getFeatureConfig, type PropertySchema } from '@/features/maps/featureRegistry';
import { useMapLayersStore } from '@/stores/mapLayersStore';
import { MC } from '../../mapColors';

// ── Value formatters ──────────────────────────────────────────────────────────
function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number' && key === 'confidence') {
    return `${(value * 100).toFixed(1)}%`;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try { return JSON.stringify(value); } catch { return '—'; }
}

// ── Editable control renderers ────────────────────────────────────────────────
interface ControlProps {
  schema: PropertySchema;
  value: unknown;
  onChange: (v: unknown) => void;
}

function PropControl({ schema, value, onChange }: ControlProps) {
  const strVal = value !== null && value !== undefined ? String(value) : '';

  if (schema.ui === 'color') {
    const hex = strVal.startsWith('#') ? strVal : '#888888';
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="color"
          value={hex}
          aria-label={schema.label}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: 28, height: 24, cursor: 'pointer', borderRadius: 3, border: 'none', padding: 1 }}
        />
        <span style={{ fontSize: 11, color: MC.textSecondary, fontFamily: 'monospace' }}>
          {hex.toUpperCase()}
        </span>
      </div>
    );
  }

  if (schema.ui === 'slider') {
    const num = parseFloat(strVal) || 0;
    const displayVal = schema.step && schema.step < 1
      ? num.toFixed(2)
      : Math.round(num);
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
          <span style={{ fontSize: 10, color: MC.sectionLabel }}>{schema.label}</span>
          <span style={{ fontSize: 10, color: MC.textSecondary, fontVariantNumeric: 'tabular-nums' }}>
            {displayVal}{schema.unit ?? ''}
          </span>
        </div>
        <input
          type="range"
          min={schema.min ?? 0}
          max={schema.max ?? 1}
          step={schema.step ?? 0.01}
          value={num}
          aria-label={schema.label}
          aria-valuetext={`${displayVal}${schema.unit ?? ''}`}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ width: '100%', accentColor: MC.accent, cursor: 'pointer' }}
        />
      </div>
    );
  }

  if (schema.ui === 'select' && schema.options) {
    return (
      <select
        value={strVal}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%',
          background: MC.inputBg,
          border: `1px solid ${MC.inputBorder}`,
          borderRadius: 4,
          color: MC.text,
          fontSize: 11,
          padding: '4px 6px',
          cursor: 'pointer',
        }}
      >
        {schema.options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    );
  }

  // text / textarea / number / fallback → read-only display
  return (
    <span style={{ fontSize: 11, color: MC.text, wordBreak: 'break-all' }}>
      {formatValue(schema.name, value)}
    </span>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────
export interface FeaturePropertiesPanelProps {
  feature: SelectedFeature;
}

export function FeaturePropertiesPanel({ feature }: FeaturePropertiesPanelProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Annotation delete support
  const annotationSetId = feature.properties._annotation_set_id as string | undefined;
  const annotationId = feature.properties._annotation_id as string | undefined;
  const canDelete = !!annotationSetId && !!annotationId;

  const handleDeleteAnnotation = async () => {
    if (!annotationSetId || !annotationId) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    setDeleting(true);
    try {
      const { annotationSetsApi } = await import('@/lib/api/annotation-sets');
      await annotationSetsApi.deleteFeature(annotationSetId, annotationId);
      toast.success('Annotation deleted');
      // Refresh the annotation set layer and close panel
      useMapLayersStore.getState().requestAnnotationSetRefresh(annotationSetId);
      useMapLayersStore.getState().closeRightPanel();
    } catch {
      toast.error('Failed to delete annotation');
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  // Look up registry config; fall back to generic display if not registered
  const config = getFeatureConfig(feature.featureType);
  const typeLabel = config?.label ?? feature.featureType;

  // Partition schema into read-only info fields and editable style fields
  const readOnlySchema = config?.schema.filter((s) => s.readOnly) ?? [];
  const editableSchema = config?.schema.filter((s) => !s.readOnly) ?? [];

  // Keys explicitly in the schema
  const schemaKeys = new Set(config?.schema.map((s) => s.name) ?? []);
  // Additional properties not in schema — shown as a raw dump at the bottom
  const extraKeys = Object.keys(feature.properties).filter(
    (k) => !schemaKeys.has(k) && !k.startsWith('_')
  );

  const handlePropertyChange = (name: string, value: unknown) => {
    if (!config?.applyUpdate || !feature.layerRef) return;
    try {
      config.applyUpdate(feature.layerRef, name, value);
    } catch {
      toast.error('Could not update feature — the layer may no longer be on the map.');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Feature type header */}
      <div style={{
        padding: '10px 14px',
        borderBottom: `1px solid ${MC.border}`,
        flexShrink: 0,
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: MC.text }}>{typeLabel}</div>
        <div style={{ fontSize: 10, color: MC.textMuted, fontFamily: 'monospace', marginTop: 2 }}>
          {feature.featureId}
        </div>
      </div>

      {/* Location */}
      <div style={{
        padding: '7px 14px',
        borderBottom: `1px solid ${MC.border}`,
        flexShrink: 0,
        background: MC.inputBg,
      }}>
        <div style={{ fontSize: 9, color: MC.sectionLabel, marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Location
        </div>
        <div style={{ fontSize: 11, color: MC.textSecondary, fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums' }}>
          {feature.latlng[0].toFixed(6)}, {feature.latlng[1].toFixed(6)}
        </div>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>

        {/* Read-only properties (geometry stats + info fields) */}
        {readOnlySchema.length > 0 || extraKeys.length > 0 ? (
          <div style={{ padding: '10px 14px', borderBottom: `1px solid ${MC.border}` }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: MC.sectionLabel, marginBottom: 8 }}>
              Properties
            </div>

            {/* Schema-defined read-only fields */}
            {readOnlySchema.map((s) => {
              const val = feature.properties[s.name];
              if (val === null || val === undefined || val === '') return null;
              return (
                <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
                  <span style={{ fontSize: 11, color: MC.sectionLabel, flexShrink: 0, marginRight: 8 }}>{s.label}</span>
                  <span style={{ fontSize: 11, color: MC.text, textAlign: 'right', wordBreak: 'break-all', fontVariantNumeric: 'tabular-nums' }}>
                    {formatValue(s.name, val)}
                  </span>
                </div>
              );
            })}

            {/* Extra keys not in schema */}
            {extraKeys.map((key) => {
              const val = feature.properties[key];
              if (val === null || val === undefined || val === '') return null;
              return (
                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
                  <span style={{ fontSize: 11, color: MC.sectionLabel, flexShrink: 0, marginRight: 8 }}>{key}</span>
                  <span style={{ fontSize: 11, color: MC.textMuted, textAlign: 'right', wordBreak: 'break-all', fontVariantNumeric: 'tabular-nums' }}>
                    {formatValue(key, val)}
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}

        {/* Editable style controls (only for annotation types with a layerRef) */}
        {editableSchema.length > 0 && feature.layerRef ? (
          <div style={{ padding: '10px 14px' }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: MC.sectionLabel, marginBottom: 10 }}>
              Style
            </div>

            {editableSchema.map((s) => {
              // Initial value: prefer _prefixed store value, then raw property
              const rawVal = feature.properties[`_${s.name}`] ?? feature.properties[s.name];
              return (
                <div key={s.name} style={{ marginBottom: s.ui === 'slider' ? 10 : 8 }}>
                  {s.ui !== 'slider' && (
                    <div style={{ fontSize: 10, color: MC.sectionLabel, marginBottom: 3 }}>{s.label}</div>
                  )}
                  <PropControl
                    schema={s}
                    value={rawVal}
                    onChange={(v) => handlePropertyChange(s.name, v)}
                  />
                </div>
              );
            })}
          </div>
        ) : null}

        {/* No schema registered */}
        {!config ? (
          <div style={{ padding: '16px 14px', fontSize: 11, color: MC.textMuted, fontStyle: 'italic' }}>
            Feature type <code style={{ fontSize: 10 }}>{feature.featureType}</code> is not registered.
          </div>
        ) : null}

        {/* Delete annotation button */}
        {canDelete && (
          <div style={{
            padding: '12px 14px',
            borderTop: `1px solid ${MC.border}`,
            marginTop: 'auto',
          }}>
            <button
              onClick={handleDeleteAnnotation}
              disabled={deleting}
              style={{
                width: '100%',
                height: 32,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                fontSize: 12,
                fontWeight: 600,
                color: confirmDelete ? '#fff' : MC.danger,
                background: confirmDelete ? MC.danger : `${MC.danger}12`,
                border: `1px solid ${confirmDelete ? MC.danger : `${MC.danger}30`}`,
                borderRadius: 6,
                cursor: deleting ? 'wait' : 'pointer',
                opacity: deleting ? 0.6 : 1,
                transition: 'all 0.15s',
              }}
            >
              <Trash2 size={13} />
              {deleting ? 'Deleting…' : confirmDelete ? 'Click again to confirm' : 'Delete annotation'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
