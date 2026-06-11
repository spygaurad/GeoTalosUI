'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
import {
  Search, Plus, X, Bot, Globe, Key, ChevronDown, ChevronUp,
  Trash2, Pencil, AlertCircle, CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';
import { modelsApi, type AIModelCreatePayload, type AIModelUpdatePayload } from '@/lib/api/models';
import { adaptersApi, type AdapterDescriptor } from '@/lib/api/adapters';
import { annotationSchemasApi } from '@/lib/api/annotation-schemas';
import { qk } from '@/lib/query-keys';
import type { AIModel } from '@/types/api';

// ── Color tokens ───────────────────────────────────────────────────────────────
const C = {
  bg: '#f5ede0',
  card: '#fff',
  cardBorder: 'rgba(140,109,44,0.15)',
  cardHover: 'rgba(140,109,44,0.05)',
  accent: '#8c6d2c',
  accentDim: 'rgba(140,109,44,0.1)',
  accentBright: '#7e6228',
  text: '#1a1208',
  textMuted: '#7a6040',
  textLight: 'rgba(26,18,8,0.45)',
  inputBg: '#faf8f4',
  inputBorder: 'rgba(140,109,44,0.2)',
  inputFocus: '#8c6d2c',
  danger: '#b91c1c',
  dangerDim: '#fef2f2',
  success: '#15803d',
  successDim: '#f0fdf4',
  shadow: '0 1px 3px rgba(140,109,44,0.08), 0 1px 2px rgba(0,0,0,0.04)',
} as const;

const TYPE_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  detection:     { bg: 'rgba(14,165,233,0.1)',  text: '#0369a1', label: 'Detection' },
  segmentation:  { bg: 'rgba(168,85,247,0.1)',  text: '#7e22ce', label: 'Segmentation' },
  classification:{ bg: 'rgba(34,197,94,0.1)',   text: '#15803d', label: 'Classification' },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: string | null }) {
  const t = type ?? 'unknown';
  const style = TYPE_COLORS[t] ?? { bg: 'rgba(100,100,100,0.1)', text: '#555', label: t };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600,
      background: style.bg, color: style.text, textTransform: 'capitalize',
    }}>
      {style.label}
    </span>
  );
}

function MetaTag({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: C.textMuted }}>
      <span style={{ fontWeight: 600, color: C.textLight }}>{label}:</span>
      <span>{value}</span>
    </div>
  );
}

function JsonField({
  label, value, onChange,
}: { label: string; value: string; onChange: (v: string) => void }) {
  const [error, setError] = useState('');
  const handleChange = (v: string) => {
    onChange(v);
    if (!v.trim()) { setError(''); return; }
    try { JSON.parse(v); setError(''); } catch { setError('Invalid JSON'); }
  };
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.textMuted, marginBottom: 4 }}>
        {label}
      </label>
      <textarea
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        rows={4}
        placeholder="{}"
        style={{
          width: '100%', boxSizing: 'border-box', padding: '8px 10px',
          borderRadius: 6, border: `1px solid ${error ? C.danger : C.inputBorder}`,
          background: C.inputBg, fontSize: 11, fontFamily: 'monospace',
          color: C.text, resize: 'vertical', outline: 'none',
        }}
      />
      {error && <p style={{ fontSize: 10, color: C.danger, marginTop: 2 }}>{error}</p>}
    </div>
  );
}

// Object field: local draft state so typing isn't blocked by transient invalid JSON.
// Commits to parent only when JSON parses cleanly to an object.
function ObjectField({
  fieldKey,
  initialJson,
  description,
  placeholder,
  onCommit,
}: {
  fieldKey: string;
  initialJson: string;
  description?: string;
  placeholder?: string;
  onCommit: (parsed: Record<string, unknown>) => void;
}) {
  const [raw, setRaw] = useState(initialJson);
  const [error, setError] = useState('');

  const handleChange = (v: string) => {
    setRaw(v);
    if (!v.trim()) { setError(''); onCommit({}); return; }
    try {
      const parsed = JSON.parse(v);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        setError('Must be a JSON object'); return;
      }
      setError('');
      onCommit(parsed as Record<string, unknown>);
    } catch {
      setError('Invalid JSON');
    }
  };

  return (
    <div>
      <label style={{
        display: 'block' as const, fontSize: 10, fontWeight: 600, color: C.textMuted, marginBottom: 3,
      }}>
        {fieldKey}
      </label>
      <textarea
        value={raw}
        onChange={(e) => handleChange(e.target.value)}
        rows={5}
        placeholder={placeholder ?? '{}'}
        style={{
          width: '100%', boxSizing: 'border-box' as const, padding: '6px 8px',
          borderRadius: 5, border: `1px solid ${error ? C.danger : C.inputBorder}`,
          background: C.inputBg, fontSize: 11, fontFamily: 'monospace',
          color: C.text, outline: 'none', resize: 'vertical',
        }}
      />
      {error && (
        <p style={{ fontSize: 9, color: C.danger, marginTop: 2, marginBottom: 0 }}>
          {error}
        </p>
      )}
      {description && (
        <p style={{ fontSize: 9, color: C.textMuted, marginTop: 2, marginBottom: 0 }}>
          {description}
        </p>
      )}
    </div>
  );
}

// ── Model Form ─────────────────────────────────────────────────────────────────

interface ModelFormState {
  name: string;
  description: string;
  type: string;
  framework: string;
  version: string;
  endpoint_url: string;
  annotation_schema_id: string;
  adapter_name: string;
  adapter_config_json: string;
  output_config_json: string;
  request_config_json: string;
  auth_token: string;
}

const EMPTY_FORM: ModelFormState = {
  name: '', description: '', type: 'detection', framework: '', version: '',
  endpoint_url: '', annotation_schema_id: '', adapter_name: '', adapter_config_json: '{}',
  output_config_json: '', request_config_json: '', auth_token: '',
};

function modelToForm(m: AIModel): ModelFormState {
  const outputCfg = m.output_config || {};
  const adapterName = (outputCfg.adapter as string) || '';
  const adapterConfig = (outputCfg.adapter_config as Record<string, unknown>) || {};

  // Remove adapter keys from outputCfg for the JSON field
  const outputCfgForJson = { ...outputCfg };
  delete outputCfgForJson.adapter;
  delete outputCfgForJson.adapter_config;

  return {
    name: m.name,
    description: m.description ?? '',
    type: m.type ?? 'detection',
    framework: m.framework ?? '',
    version: m.version ?? '',
    endpoint_url: m.endpoint_url ?? '',
    annotation_schema_id: m.annotation_schema_id ?? '',
    adapter_name: adapterName,
    adapter_config_json: JSON.stringify(adapterConfig, null, 2),
    output_config_json: Object.keys(outputCfgForJson).length > 0 ? JSON.stringify(outputCfgForJson, null, 2) : '',
    request_config_json: m.request_config ? JSON.stringify(m.request_config, null, 2) : '',
    auth_token: '',
  };
}

function parseJson(s: string): Record<string, unknown> | null {
  if (!s.trim()) return null;
  try { return JSON.parse(s); } catch { return null; }
}

function getDefaultsFromSchema(schema: AdapterDescriptor['config_schema']): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  if (schema?.properties) {
    Object.entries(schema.properties).forEach(([key, prop]) => {
      if ('default' in prop && prop.default !== undefined) {
        defaults[key] = prop.default;
      }
    });
  }
  return defaults;
}

function formToPayload(f: ModelFormState): AIModelCreatePayload {
  const outputCfgBase = parseJson(f.output_config_json) || {};
  const adapterConfig = parseJson(f.adapter_config_json) || {};

  const outputConfig: Record<string, unknown> = { ...outputCfgBase };
  if (f.adapter_name.trim()) {
    outputConfig.adapter = f.adapter_name.trim();
    if (Object.keys(adapterConfig).length > 0) {
      outputConfig.adapter_config = adapterConfig;
    }
  }

  const payload: AIModelCreatePayload = {
    name: f.name.trim(),
    description: f.description.trim() || null,
    type: f.type || null,
    framework: f.framework.trim() || null,
    version: f.version.trim() || null,
    endpoint_url: f.endpoint_url.trim() || null,
    annotation_schema_id: f.annotation_schema_id.trim() || null,
    output_config: Object.keys(outputConfig).length > 0 ? outputConfig : null,
    request_config: parseJson(f.request_config_json),
  };
  if (f.auth_token.trim()) {
    payload.auth_config = { bearer_token: f.auth_token.trim() };
  }
  return payload;
}

// ── Schema Section ────────────────────────────────────────────────────────────
// Picks the annotation schema this model's outputs land in. Backend auto-binds
// `adapter_config.category_map` values → annotation_classes by name within this
// schema (see model_manager._resolve_class_mapping). Without a schema, every
// prediction is dropped silently.

interface SchemaSectionProps {
  annotation_schema_id: string;
  on_change: (id: string) => void;
}

function SchemaSection({ annotation_schema_id, on_change }: SchemaSectionProps) {
  const { data, isLoading } = useQuery({
    queryKey: qk.annotationSchemas.list(),
    queryFn: () => annotationSchemasApi.list(100, 0),
  });
  const schemas = data?.items ?? [];

  return (
    <div>
      <label style={{
        display: 'block' as const, fontSize: 12, fontWeight: 600, color: C.textMuted, marginBottom: 4,
      }}>
        Annotation Schema <span style={{ color: C.danger }}>*</span>
      </label>
      <select
        value={annotation_schema_id}
        onChange={(e) => on_change(e.target.value)}
        disabled={isLoading}
        style={{
          width: '100%', boxSizing: 'border-box' as const, padding: '8px 10px',
          borderRadius: 6, border: `1px solid ${C.inputBorder}`, background: C.inputBg,
          fontSize: 13, color: C.text, outline: 'none', cursor: 'pointer',
        }}
      >
        <option value="">— select schema —</option>
        {schemas.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
      <p style={{ fontSize: 11, color: C.textMuted, marginTop: 4, marginBottom: 0 }}>
        Outputs land in this schema. The adapter&apos;s <code>category_map</code> values
        below are matched to annotation classes <strong>by name</strong> within this schema.
      </p>
    </div>
  );
}

// ── Adapter Section ───────────────────────────────────────────────────────────

interface AdapterSectionProps {
  adapter_name: string;
  adapter_config_json: string;
  on_adapter_change: (name: string) => void;
  on_config_change: (json: string) => void;
}

function AdapterSection({
  adapter_name, adapter_config_json, on_adapter_change, on_config_change,
}: AdapterSectionProps) {
  const { data: adaptersResp, isLoading } = useQuery({
    queryKey: qk.adapters.list(),
    queryFn: () => adaptersApi.list(),
  });

  const adapters = adaptersResp?.items ?? [];
  const selectedAdapter = adapters.find((a) => a.name === adapter_name);
  const configParsed = parseJson(adapter_config_json) ?? {};

  const handleAdapterChange = (newName: string) => {
    on_adapter_change(newName);
    if (newName && adapters.length > 0) {
      const adapter = adapters.find((a) => a.name === newName);
      const defaults = adapter ? getDefaultsFromSchema(adapter.config_schema) : {};
      on_config_change(JSON.stringify(defaults, null, 2));
    } else {
      on_config_change('{}');
    }
  };

  return (
    <div>
      <label style={{ display: 'block' as const, fontSize: 12, fontWeight: 600, color: C.textMuted, marginBottom: 4 }}>
        Adapter
      </label>
      <select
        value={adapter_name}
        onChange={(e) => handleAdapterChange(e.target.value)}
        disabled={isLoading}
        style={{
          width: '100%', boxSizing: 'border-box' as const, padding: '8px 10px',
          borderRadius: 6, border: `1px solid ${C.inputBorder}`, background: C.inputBg,
          fontSize: 13, color: C.text, outline: 'none', cursor: 'pointer',
        }}
      >
        <option value="">— none —</option>
        {adapters.map((a) => (
          <option key={a.name} value={a.name}>
            {a.label}
          </option>
        ))}
      </select>

      {selectedAdapter && (
        <>
          <p style={{
            fontSize: 11, color: C.textMuted, marginTop: 4, marginBottom: 0,
          }}>
            {selectedAdapter.description}
          </p>

          {Object.keys(selectedAdapter.config_schema.properties).length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.textMuted }}>
                Adapter Config
              </div>

              {Object.entries(selectedAdapter.config_schema.properties).map(([key, prop]) => {
                const value = configParsed[key] ?? prop.default ?? '';
                const handleChange = (newVal: unknown) => {
                  on_config_change(JSON.stringify({ ...configParsed, [key]: newVal }, null, 2));
                };

                if (prop.type === 'string') {
                  return (
                    <div key={key}>
                      <label style={{
                        display: 'block' as const, fontSize: 10, fontWeight: 600, color: C.textMuted, marginBottom: 3,
                      }}>
                        {key}
                      </label>
                      <input
                        type="text"
                        value={typeof value === 'string' ? value : String(value || '')}
                        onChange={(e) => handleChange(e.target.value)}
                        placeholder={String(prop.default ?? '')}
                        style={{
                          width: '100%', boxSizing: 'border-box' as const, padding: '6px 8px',
                          borderRadius: 5, border: `1px solid ${C.inputBorder}`, background: C.inputBg,
                          fontSize: 11, color: C.text, outline: 'none',
                        }}
                      />
                      {prop.description && (
                        <p style={{ fontSize: 9, color: C.textMuted, marginTop: 2, marginBottom: 0 }}>
                          {prop.description}
                        </p>
                      )}
                    </div>
                  );
                }

                if (prop.type === 'number') {
                  return (
                    <div key={key}>
                      <label style={{
                        display: 'block' as const, fontSize: 10, fontWeight: 600, color: C.textMuted, marginBottom: 3,
                      }}>
                        {key}
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={typeof value === 'number' ? value : (value ? Number(value) : '')}
                        onChange={(e) => handleChange(e.target.value ? parseFloat(e.target.value) : null)}
                        placeholder={String(prop.default ?? '')}
                        style={{
                          width: '100%', boxSizing: 'border-box' as const, padding: '6px 8px',
                          borderRadius: 5, border: `1px solid ${C.inputBorder}`, background: C.inputBg,
                          fontSize: 11, color: C.text, outline: 'none',
                        }}
                      />
                      {prop.description && (
                        <p style={{ fontSize: 9, color: C.textMuted, marginTop: 2, marginBottom: 0 }}>
                          {prop.description}
                        </p>
                      )}
                    </div>
                  );
                }

                if (prop.type === 'object') {
                  const initialJson =
                    typeof value === 'object' && value !== null
                      ? JSON.stringify(value, null, 2)
                      : (typeof value === 'string' && value.trim()) ? value : '{}';
                  const placeholder = key === 'category_map'
                    ? '{\n  "0": "Class A",\n  "1": "Class B"\n}'
                    : '{}';
                  return (
                    <ObjectField
                      key={`${adapter_name}-${key}`}
                      fieldKey={key}
                      initialJson={initialJson}
                      description={prop.description}
                      placeholder={placeholder}
                      onCommit={(parsed) => {
                        on_config_change(
                          JSON.stringify({ ...configParsed, [key]: parsed }, null, 2),
                        );
                      }}
                    />
                  );
                }

                return null;
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

interface ModelFormProps {
  initial?: AIModel;
  onCancel: () => void;
  onSave: (payload: AIModelCreatePayload | AIModelUpdatePayload, id?: string) => void;
  saving: boolean;
}

function ModelForm({ initial, onCancel, onSave, saving }: ModelFormProps) {
  const [form, setForm] = useState<ModelFormState>(initial ? modelToForm(initial) : EMPTY_FORM);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const set = (k: keyof ModelFormState) => (v: string) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    onSave(formToPayload(form), initial?.id);
  };

  const inputStyle = {
    width: '100%', boxSizing: 'border-box' as const, padding: '8px 10px',
    borderRadius: 6, border: `1px solid ${C.inputBorder}`, background: C.inputBg,
    fontSize: 13, color: C.text, outline: 'none',
  };
  const labelStyle = { display: 'block' as const, fontSize: 12, fontWeight: 600, color: C.textMuted, marginBottom: 4 };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Name */}
      <div>
        <label style={labelStyle}>Name <span style={{ color: C.danger }}>*</span></label>
        <input
          value={form.name}
          onChange={(e) => set('name')(e.target.value)}
          placeholder="My detection model"
          required
          style={inputStyle}
        />
      </div>

      {/* Description */}
      <div>
        <label style={labelStyle}>Description</label>
        <input value={form.description} onChange={(e) => set('description')(e.target.value)}
          placeholder="Optional description" style={inputStyle} />
      </div>

      {/* Type + Framework row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <label style={labelStyle}>Type</label>
          <select value={form.type} onChange={(e) => set('type')(e.target.value)}
            style={{ ...inputStyle, cursor: 'pointer' }}>
            <option value="detection">Detection</option>
            <option value="segmentation">Segmentation</option>
            <option value="classification">Classification</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Framework</label>
          <input value={form.framework} onChange={(e) => set('framework')(e.target.value)}
            placeholder="yolo, sam3, custom" style={inputStyle} />
        </div>
      </div>

      {/* Version + Endpoint row */}
      <div>
        <label style={labelStyle}>Version</label>
        <input value={form.version} onChange={(e) => set('version')(e.target.value)}
          placeholder="v1.0" style={inputStyle} />
      </div>

      <div>
        <label style={labelStyle}>Endpoint URL <span style={{ color: C.danger }}>*</span></label>
        <input value={form.endpoint_url} onChange={(e) => set('endpoint_url')(e.target.value)}
          placeholder="https://your-model-api.com/predict" style={inputStyle} />
      </div>

      {/* Annotation schema picker */}
      <SchemaSection
        annotation_schema_id={form.annotation_schema_id}
        on_change={(id) => set('annotation_schema_id')(id)}
      />

      {/* Adapter selection */}
      <AdapterSection
        adapter_name={form.adapter_name}
        adapter_config_json={form.adapter_config_json}
        on_adapter_change={(name) => set('adapter_name')(name)}
        on_config_change={(json) => set('adapter_config_json')(json)}
      />

      {/* Auth token */}
      <div>
        <label style={labelStyle}>
          Bearer Token {initial?.has_auth_config && (
            <span style={{ color: C.success, fontSize: 10, fontWeight: 500, marginLeft: 4 }}>
              (currently set — enter new to replace)
            </span>
          )}
        </label>
        <input
          value={form.auth_token}
          onChange={(e) => set('auth_token')(e.target.value)}
          type="password"
          placeholder={initial?.has_auth_config ? '••••••••' : 'Optional — leave blank if not needed'}
          style={inputStyle}
          autoComplete="new-password"
        />
      </div>

      {/* Advanced toggle */}
      <div>
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          style={{
            display: 'flex', alignItems: 'center', gap: 4, background: 'none',
            border: 'none', cursor: 'pointer', fontSize: 12, color: C.accent,
            padding: 0, fontWeight: 600,
          }}
        >
          {showAdvanced ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          Advanced config
        </button>

        {showAdvanced && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
            <JsonField
              label="Other Output Config (patch_size_px, stride_px, confidence_threshold…)"
              value={form.output_config_json}
              onChange={set('output_config_json')}
            />
            <JsonField
              label="Request Config (method, timeout_seconds, payload overrides…)"
              value={form.request_config_json}
              onChange={set('request_config_json')}
            />
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 4 }}>
        <button
          type="button" onClick={onCancel}
          style={{
            padding: '8px 16px', borderRadius: 6, border: `1px solid ${C.cardBorder}`,
            background: 'transparent', color: C.textMuted, fontSize: 13, cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          type="submit" disabled={saving}
          style={{
            padding: '8px 18px', borderRadius: 6, border: 'none',
            background: saving ? C.accentDim : C.accent, color: saving ? C.accent : '#fff',
            fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? 'Saving…' : initial ? 'Save Changes' : 'Register Model'}
        </button>
      </div>
    </form>
  );
}

// ── Drawer ─────────────────────────────────────────────────────────────────────

function Drawer({
  open, title, onClose, children,
}: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      display: 'flex', justifyContent: 'flex-end',
    }}>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.25)' }}
      />
      {/* Panel */}
      <div style={{
        position: 'relative', zIndex: 1,
        width: 480, maxWidth: '95vw',
        background: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
        display: 'flex', flexDirection: 'column', overflowY: 'auto',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: `1px solid ${C.cardBorder}`,
          position: 'sticky', top: 0, background: '#fff', zIndex: 1,
        }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{title}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted }}>
            <X size={16} />
          </button>
        </div>
        <div style={{ padding: '20px' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// ── Model Card ─────────────────────────────────────────────────────────────────

function ModelCard({
  model, onEdit, onDelete,
}: { model: AIModel; onEdit: () => void; onDelete: () => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div style={{
      background: C.card, borderRadius: 10, border: `1px solid ${C.cardBorder}`,
      boxShadow: C.shadow, padding: '16px 18px',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 8, flexShrink: 0,
          background: C.accentDim, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Bot size={17} color={C.accent} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 4 }}>
            {model.name}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <TypeBadge type={model.type} />
            {model.framework && (
              <span style={{
                fontSize: 11, padding: '2px 7px', borderRadius: 99,
                background: 'rgba(0,0,0,0.05)', color: C.textMuted, fontFamily: 'monospace',
              }}>
                {model.framework}
              </span>
            )}
            {model.has_auth_config && (
              <span title="Auth configured" style={{ display: 'flex', alignItems: 'center' }}>
                <Key size={11} color={C.success} />
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <button
            onClick={onEdit}
            title="Edit model"
            style={{
              width: 28, height: 28, borderRadius: 5, border: `1px solid ${C.cardBorder}`,
              background: 'transparent', cursor: 'pointer', display: 'flex',
              alignItems: 'center', justifyContent: 'center', color: C.textMuted,
            }}
          >
            <Pencil size={12} />
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            title="Delete model"
            style={{
              width: 28, height: 28, borderRadius: 5, border: `1px solid rgba(185,28,28,0.15)`,
              background: 'transparent', cursor: 'pointer', display: 'flex',
              alignItems: 'center', justifyContent: 'center', color: C.danger,
            }}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Meta */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
        <MetaTag label="Version" value={model.version} />
        {model.endpoint_url && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: C.textMuted }}>
            <Globe size={10} color={C.textLight} />
            <span style={{
              maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {model.endpoint_url}
            </span>
          </div>
        )}
      </div>

      {model.description && (
        <p style={{ fontSize: 12, color: C.textMuted, margin: 0 }}>
          {model.description}
        </p>
      )}

      {/* Output config summary */}
      {model.output_config && (
        <div style={{
          padding: '6px 10px', borderRadius: 6, background: C.accentDim,
          display: 'flex', flexWrap: 'wrap', gap: '2px 12px',
        }}>
          {typeof model.output_config.adapter === 'string' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: C.textMuted }}>
              <span style={{ fontWeight: 600, color: C.textLight }}>adapter:</span>
              <span>{model.output_config.adapter as string}</span>
              {typeof model.output_config.adapter_config === 'object' && model.output_config.adapter_config && Object.keys(model.output_config.adapter_config).length > 0 && (
                <span style={{ fontSize: 9, color: C.textMuted }}>
                  · {Object.keys(model.output_config.adapter_config).length} config
                </span>
              )}
            </div>
          )}
          {typeof model.output_config.patch_size_px === 'number' && (
            <MetaTag label="patch" value={`${model.output_config.patch_size_px}px`} />
          )}
          {typeof model.output_config.confidence_threshold === 'number' && (
            <MetaTag label="conf" value={`${model.output_config.confidence_threshold}`} />
          )}
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div style={{
          padding: '10px 12px', borderRadius: 7, background: C.dangerDim,
          border: `1px solid rgba(185,28,28,0.2)`,
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertCircle size={13} color={C.danger} />
            <span style={{ fontSize: 12, color: C.danger, fontWeight: 600 }}>
              Delete &ldquo;{model.name}&rdquo;?
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => setConfirmDelete(false)}
              style={{
                flex: 1, padding: '5px', fontSize: 12, borderRadius: 5,
                border: `1px solid ${C.cardBorder}`, background: '#fff',
                cursor: 'pointer', color: C.textMuted,
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => { onDelete(); setConfirmDelete(false); }}
              style={{
                flex: 1, padding: '5px', fontSize: 12, borderRadius: 5,
                border: 'none', background: C.danger,
                cursor: 'pointer', color: '#fff', fontWeight: 600,
              }}
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

interface ModelsContentProps {
  workspaceId: string;
}

export function ModelsContent({ workspaceId: _workspaceId }: ModelsContentProps) {
  const { orgId } = useAuth();
  const queryClient = useQueryClient();

  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<AIModel | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: qk.models.list(),
    queryFn: () => modelsApi.list({ page_size: 100 }),
    enabled: !!orgId,
  });

  const models = data?.items ?? [];

  const filtered = models.filter((m) => {
    const matchesQuery = !query || m.name.toLowerCase().includes(query.toLowerCase());
    const matchesType = typeFilter === 'all' || m.type === typeFilter;
    return matchesQuery && matchesType;
  });

  const createMutation = useMutation({
    mutationFn: (payload: AIModelCreatePayload) => modelsApi.create(payload),
    onSuccess: (model) => {
      queryClient.invalidateQueries({ queryKey: qk.models.list() });
      toast.success(`Model "${model.name}" registered`);
      setDrawerOpen(false);
    },
    onError: () => toast.error('Failed to register model'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: AIModelUpdatePayload }) =>
      modelsApi.update(id, payload),
    onSuccess: (model) => {
      queryClient.invalidateQueries({ queryKey: qk.models.list() });
      toast.success(`Model "${model.name}" updated`);
      setEditingModel(null);
    },
    onError: () => toast.error('Failed to update model'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => modelsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.models.list() });
      toast.success('Model deleted');
    },
    onError: () => toast.error('Failed to delete model'),
  });

  const handleSave = (payload: AIModelCreatePayload | AIModelUpdatePayload, id?: string) => {
    if (id) {
      updateMutation.mutate({ id, payload: payload as AIModelUpdatePayload });
    } else {
      createMutation.mutate(payload as AIModelCreatePayload);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: C.bg }}>
      {/* ── Header ── */}
      <div style={{
        padding: '24px 28px 0',
        borderBottom: `1px solid ${C.cardBorder}`,
        background: '#fff',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: C.text, margin: 0 }}>AI Models</h1>
            <p style={{ fontSize: 13, color: C.textMuted, margin: '4px 0 0' }}>
              Register and manage inference models for your organization
            </p>
          </div>
          <button
            onClick={() => setDrawerOpen(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '9px 16px', borderRadius: 7, border: 'none',
              background: C.accent, color: '#fff',
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            <Plus size={14} /> Register Model
          </button>
        </div>

        {/* Search + filter bar */}
        <div style={{ display: 'flex', gap: 10, paddingBottom: 16 }}>
          <div style={{ position: 'relative', flex: 1, maxWidth: 340 }}>
            <Search size={13} style={{
              position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
              color: C.textLight, pointerEvents: 'none',
            }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search models…"
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '8px 10px 8px 30px', borderRadius: 7,
                border: `1px solid ${C.inputBorder}`, background: C.inputBg,
                fontSize: 13, color: C.text, outline: 'none',
              }}
            />
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            style={{
              padding: '8px 10px', borderRadius: 7, border: `1px solid ${C.inputBorder}`,
              background: C.inputBg, fontSize: 13, color: C.text, cursor: 'pointer',
            }}
          >
            <option value="all">All types</option>
            <option value="detection">Detection</option>
            <option value="segmentation">Segmentation</option>
            <option value="classification">Classification</option>
          </select>
        </div>
      </div>

      {/* ── Content ── */}
      <div style={{ padding: '24px 28px' }}>
        {isLoading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{
                height: 140, borderRadius: 10, background: '#f0e8d9',
                animation: 'pulse 1.5s ease-in-out infinite',
              }} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', padding: '80px 20px', gap: 14,
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: 14, background: C.accentDim,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Bot size={24} color={C.accent} />
            </div>
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 15, fontWeight: 700, color: C.text, margin: 0 }}>
                {query || typeFilter !== 'all' ? 'No models match your filters' : 'No models registered yet'}
              </p>
              <p style={{ fontSize: 13, color: C.textMuted, margin: '4px 0 0' }}>
                {query || typeFilter !== 'all'
                  ? 'Try adjusting your search or filter.'
                  : 'Register your first AI model to start running inference on your datasets.'}
              </p>
            </div>
            {!query && typeFilter === 'all' && (
              <button
                onClick={() => setDrawerOpen(true)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '9px 18px', borderRadius: 7, border: 'none',
                  background: C.accent, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >
                <Plus size={14} /> Register Model
              </button>
            )}
          </div>
        ) : (
          <>
            <p style={{ fontSize: 12, color: C.textMuted, marginBottom: 16 }}>
              {filtered.length} model{filtered.length !== 1 ? 's' : ''}
              {typeFilter !== 'all' ? ` (${typeFilter})` : ''}
            </p>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
              gap: 16,
            }}>
              {filtered.map((model) => (
                <ModelCard
                  key={model.id}
                  model={model}
                  onEdit={() => setEditingModel(model)}
                  onDelete={() => deleteMutation.mutate(model.id)}
                />
              ))}
            </div>

            {/* Stats bar */}
            {models.length > 0 && (
              <div style={{
                marginTop: 28, padding: '12px 16px', borderRadius: 8,
                background: C.accentDim, border: `1px solid ${C.cardBorder}`,
                display: 'flex', flexWrap: 'wrap', gap: '8px 24px',
              }}>
                {(['detection', 'segmentation', 'classification'] as const).map((t) => {
                  const count = models.filter((m) => m.type === t).length;
                  if (!count) return null;
                  return (
                    <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <TypeBadge type={t} />
                      <span style={{ fontSize: 12, color: C.textMuted }}>
                        {count} model{count !== 1 ? 's' : ''}
                      </span>
                    </div>
                  );
                })}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: C.textMuted }}>
                  <CheckCircle2 size={12} color={C.success} />
                  {models.filter((m) => m.has_auth_config).length} with auth
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Register Drawer ── */}
      <Drawer open={drawerOpen} title="Register AI Model" onClose={() => setDrawerOpen(false)}>
        <ModelForm
          onCancel={() => setDrawerOpen(false)}
          onSave={handleSave}
          saving={createMutation.isPending}
        />
      </Drawer>

      {/* ── Edit Drawer ── */}
      <Drawer
        open={!!editingModel}
        title={`Edit "${editingModel?.name ?? ''}"`}
        onClose={() => setEditingModel(null)}
      >
        {editingModel && (
          <ModelForm
            initial={editingModel}
            onCancel={() => setEditingModel(null)}
            onSave={handleSave}
            saving={updateMutation.isPending}
          />
        )}
      </Drawer>
    </div>
  );
}
