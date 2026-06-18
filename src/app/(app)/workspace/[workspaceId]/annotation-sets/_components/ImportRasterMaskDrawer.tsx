'use client';

/**
 * ImportRasterMaskDrawer
 *
 * Multi-step wizard for ingesting a raster segmentation mask (.tif) as an
 * annotation set with class-value mapping.
 *
 * Flow:
 *  Step 1 – Source: pick raster dataset + dataset item
 *  Step 2 – Configure: name, schema, band index, nodata value
 *  Step 3 – Map Values: unique pixel values → schema classes
 *  Step 4 – Done: success state
 */

import { useState, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  X,
  ChevronRight,
  Layers,
  CheckCircle2,
  Loader2,
  AlertCircle,
  ImageIcon,
} from 'lucide-react';

import { annotationSetsApi, type RasterConfigPayload } from '@/lib/api/annotation-sets';
import { annotationSchemasApi } from '@/lib/api/annotation-schemas';
import { datasetsApi } from '@/lib/api/datasets';
import { qk } from '@/lib/query-keys';
import type { AnnotationClass, RasterValuesResponse } from '@/types/api';

// ── Palette ───────────────────────────────────────────────────────────────────
const C = {
  bg: '#faf8f4',
  border: '#e8d8c4',
  accent: '#7f5539',
  accentLight: '#e8d5b8',
  text: '#2e3428',
  textSec: '#6a5c4e',
  textMuted: '#9a8878',
  danger: '#b35e4c',
  success: '#4a7a4a',
  stepActive: '#7f5539',
  stepDone: '#4a7a4a',
  stepPending: '#c5b49a',
};

type Step = 'source' | 'configure' | 'mapping' | 'done';

interface ValueRow {
  value: number;
  classId: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: (setId: string) => void;
}

// ── Step indicator ─────────────────────────────────────────────────────────────
const STEPS: { key: Step; label: string }[] = [
  { key: 'source', label: 'Source' },
  { key: 'configure', label: 'Configure' },
  { key: 'mapping', label: 'Map Values' },
  { key: 'done', label: 'Done' },
];

function StepBar({ current }: { current: Step }) {
  const idx = STEPS.findIndex((s) => s.key === current);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
      {STEPS.map((s, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? '1 1 0' : undefined }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div
                style={{
                  width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700,
                  background: done ? C.stepDone : active ? C.stepActive : C.stepPending,
                  color: done || active ? '#fff' : C.text,
                }}
              >
                {done ? '✓' : i + 1}
              </div>
              <span style={{
                fontSize: 12, fontWeight: active ? 600 : 400,
                color: done ? C.stepDone : active ? C.stepActive : C.textMuted,
                whiteSpace: 'nowrap',
              }}>
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div style={{ flex: 1, height: 1, background: done ? C.stepDone : C.border, margin: '0 8px' }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Field helpers ──────────────────────────────────────────────────────────────
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: C.textSec, marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label} {required && <span style={{ color: C.danger }}>*</span>}
      </label>
      {children}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  width: '100%', height: 36, padding: '0 10px', borderRadius: 6,
  border: `1px solid ${C.border}`, background: '#fff',
  fontSize: 13, color: C.text, outline: 'none',
};

const inputStyle: React.CSSProperties = {
  width: '100%', height: 36, padding: '0 10px', borderRadius: 6,
  border: `1px solid ${C.border}`, background: '#fff',
  fontSize: 13, color: C.text, outline: 'none',
};

// ── Value-to-class row ─────────────────────────────────────────────────────────
function ValueMappingRow({
  value,
  classId,
  classes,
  isNodata,
  onChange,
}: {
  value: number;
  classId: string;
  classes: AnnotationClass[];
  isNodata: boolean;
  onChange: (classId: string) => void;
}) {
  const cls = classes.find((c) => c.id === classId);
  const color = cls?.style?.definition?.fillColor ?? null;

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '60px 20px 1fr',
      alignItems: 'center', gap: 10,
      padding: '6px 12px',
      borderBottom: `1px solid ${C.border}`,
    }}>
      {/* Value badge */}
      <div style={{
        fontSize: 12, fontWeight: 700, fontFamily: 'monospace',
        color: isNodata ? C.textMuted : C.text,
        background: isNodata ? '#f0e8dc' : C.accentLight,
        borderRadius: 4, padding: '2px 6px', textAlign: 'center',
      }}>
        {isNodata ? `${value} ✕` : value}
      </div>

      {/* Color swatch */}
      <div style={{
        width: 16, height: 16, borderRadius: 3, flexShrink: 0,
        background: color ?? '#e0e0e0',
        border: `1px solid rgba(0,0,0,0.12)`,
      }} />

      {/* Class selector */}
      {isNodata ? (
        <span style={{ fontSize: 12, color: C.textMuted, fontStyle: 'italic' }}>Excluded (nodata)</span>
      ) : (
        <select
          value={classId}
          onChange={(e) => onChange(e.target.value)}
          style={{ ...selectStyle, height: 30, fontSize: 12 }}
        >
          <option value="">— Unassigned —</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      )}
    </div>
  );
}

// ── Main drawer ────────────────────────────────────────────────────────────────
export function ImportRasterMaskDrawer({ open, onClose, onCreated }: Props) {
  const { orgId } = useAuth();
  const qc = useQueryClient();

  // Step state
  const [step, setStep] = useState<Step>('source');

  // Step 1 — Source
  const [datasetId, setDatasetId] = useState('');
  const [datasetItemId, setDatasetItemId] = useState('');

  // Step 2 — Configure
  const [setName, setSetName] = useState('');
  const [description, setDescription] = useState('');
  const [schemaId, setSchemaId] = useState('');
  const [bandIndex, setBandIndex] = useState(1);
  const [nodataValue, setNodataValue] = useState<number | ''>(0);

  // Step 3 — Mapping (set after API calls)
  const [createdSetId, setCreatedSetId] = useState<string | null>(null);
  const [rasterValues, setRasterValues] = useState<RasterValuesResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [valueMap, setValueMap] = useState<ValueRow[]>([]);

  // Queries
  const datasetsQ = useQuery({
    queryKey: qk.datasets.list(),
    queryFn: () => datasetsApi.list({ page_size: 200 }),
    enabled: !!orgId && open,
    select: (d) => d.items.filter((it) => it.dataset_type === 'imagery' || it.dataset_type === 'segmentation_mask'),
  });

  const itemsQ = useQuery({
    queryKey: qk.datasets.items(datasetId),
    queryFn: () => datasetsApi.listItems(datasetId, { page_size: 200 }),
    enabled: !!datasetId,
  });

  const schemasQ = useQuery({
    queryKey: qk.annotationSchemas.list(),
    queryFn: () => annotationSchemasApi.list(100, 0),
    enabled: !!orgId && open,
  });

  const classesQ = useQuery({
    queryKey: qk.annotationSchemas.classes(schemaId),
    queryFn: () => annotationSchemasApi.getClasses(schemaId),
    enabled: !!schemaId,
  });

  const classes = classesQ.data?.items ?? [];

  const selectedItem = itemsQ.data?.items.find((it) => it.id === datasetItemId || it.stac_item_id === datasetItemId);

  const onDatasetChange = useCallback((id: string) => {
    setDatasetId(id);
    setDatasetItemId('');
    const ds = datasetsQ.data?.find((d) => d.id === id);
    if (ds && !setName) setSetName(`${ds.name} mask`);
  }, [datasetsQ.data, setName]);

  // ── Advance from step 2 → 3 (create set + fetch values) ───────────────────
  const prepareMapping = useMutation({
    mutationFn: async () => {
      if (!schemaId) throw new Error('Select a schema');
      if (!setName.trim()) throw new Error('Enter a set name');
      if (!datasetId) throw new Error('Select a raster dataset');
      if (!datasetItemId) throw new Error('Select a dataset item');

      // Resolve the stac_item_id string for the chosen item
      const stacItemId = selectedItem?.stac_item_id ?? datasetItemId;

      // Create the annotation set
      const created = await annotationSetsApi.createStandalone({
        name: setName.trim(),
        description: description.trim() || null,
        schema_id: schemaId,
        dataset_id: datasetId,
        stac_item_id: stacItemId,
      });

      // Fetch unique raster values for mapping UI.
      // If this fails, clean up the just-created annotation set so we don't leave orphans.
      let values;
      try {
        values = await annotationSetsApi.getRasterValues(created.id, stacItemId, bandIndex);
      } catch (err) {
        // Best-effort cleanup — don't surface this secondary error
        try { await annotationSetsApi.delete(created.id); } catch { /* ignore */ }
        throw err;
      }

      return { set: created, values };
    },
    onSuccess: ({ set, values }) => {
      setCreatedSetId(set.id);
      setRasterValues(values);
      setLoadError(null);

      // Initialise value map (all unassigned by default)
      const nodata = typeof nodataValue === 'number' ? nodataValue : null;
      setValueMap(
        values.values
          .filter((v) => v !== nodata)
          .map((v) => ({ value: v, classId: '' })),
      );

      setStep('mapping');
    },
    onError: (e) => {
      setLoadError(e instanceof Error ? e.message : 'Failed to load raster values');
    },
  });

  // ── Save mapping (step 3 → done) ───────────────────────────────────────────
  const saveMapping = useMutation({
    mutationFn: async () => {
      if (!createdSetId) throw new Error('No annotation set');
      const stacItemId = selectedItem?.stac_item_id ?? datasetItemId;
      const nodata = typeof nodataValue === 'number' ? nodataValue : null;

      const payload: RasterConfigPayload = {
        dataset_item_id: stacItemId,
        map_layer_id: null,
        band_index: bandIndex,
        nodata_value: nodata,
        value_class_map: Object.fromEntries(
          valueMap
            .filter((r) => r.classId)
            .map((r) => [String(r.value), r.classId]),
        ),
      };

      return annotationSetsApi.saveRasterConfig(createdSetId, payload);
    },
    onSuccess: () => {
      toast.success(`Raster mask "${setName}" saved`);
      qc.invalidateQueries({ queryKey: ['annotation-sets'] });
      onCreated?.(createdSetId!);
      setStep('done');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to save mapping'),
  });

  // ── Reset all state ────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    setStep('source');
    setDatasetId('');
    setDatasetItemId('');
    setSetName('');
    setDescription('');
    setSchemaId('');
    setBandIndex(1);
    setNodataValue(0);
    setCreatedSetId(null);
    setRasterValues(null);
    setLoadError(null);
    setValueMap([]);
  }, []);

  const handleClose = useCallback(() => {
    if (!prepareMapping.isPending && !saveMapping.isPending) {
      reset();
      onClose();
    }
  }, [prepareMapping.isPending, saveMapping.isPending, reset, onClose]);

  if (!open) return null;

  const isPending = prepareMapping.isPending || saveMapping.isPending;
  const nodata = typeof nodataValue === 'number' ? nodataValue : null;
  const mappedCount = valueMap.filter((r) => r.classId).length;
  const totalCount = valueMap.length;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex' }}>
      {/* Backdrop */}
      <div
        style={{ flex: 1, background: 'rgba(0,0,0,0.4)' }}
        onClick={handleClose}
      />

      {/* Panel */}
      <div style={{
        width: '100%', maxWidth: 560, background: '#fff',
        display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.15)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: `1px solid ${C.border}`,
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Layers size={16} style={{ color: C.accent }} />
              <h2 style={{ fontSize: 16, fontWeight: 700, color: C.text, fontFamily: 'var(--font-display, Georgia, serif)' }}>
                Import Raster Mask
              </h2>
            </div>
            <p style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>
              Assign schema classes to raster pixel values
            </p>
          </div>
          <button onClick={handleClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        {/* Step bar */}
        <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.border}`, background: C.bg }}>
          <StepBar current={step} />
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>

          {/* ── Step 1: Source ────────────────────────────────────────────── */}
          {step === 'source' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <p style={{ fontSize: 13, color: C.textSec, margin: 0 }}>
                Select a raster dataset that has already been ingested. Upload new rasters via the Datasets page first.
              </p>

              <Field label="Raster dataset" required>
                <select
                  value={datasetId}
                  onChange={(e) => onDatasetChange(e.target.value)}
                  style={selectStyle}
                >
                  <option value="">— Select dataset —</option>
                  {datasetsQ.isLoading ? (
                    <option disabled>Loading…</option>
                  ) : (datasetsQ.data ?? []).length === 0 ? (
                    <option disabled>No raster datasets found</option>
                  ) : (
                    (datasetsQ.data ?? []).map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))
                  )}
                </select>
              </Field>

              <Field label="Dataset item" required>
                <select
                  value={datasetItemId}
                  onChange={(e) => setDatasetItemId(e.target.value)}
                  disabled={!datasetId}
                  style={{ ...selectStyle, background: !datasetId ? '#f8f5f0' : '#fff', color: !datasetId ? C.textMuted : C.text }}
                >
                  <option value="">— Select item —</option>
                  {itemsQ.isLoading ? (
                    <option disabled>Loading…</option>
                  ) : (itemsQ.data?.items ?? []).map((it) => (
                    <option key={it.id} value={it.stac_item_id}>
                      {it.filename ?? it.stac_item_id}
                    </option>
                  ))}
                </select>
                {datasetId && !itemsQ.isLoading && (itemsQ.data?.items ?? []).length === 0 && (
                  <p style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>No items in this dataset.</p>
                )}
              </Field>

              {selectedItem && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: C.bg, borderRadius: 6, border: `1px solid ${C.border}` }}>
                  <ImageIcon size={14} style={{ color: C.accent, flexShrink: 0 }} />
                  <div style={{ fontSize: 12, color: C.textSec, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {selectedItem.filename ?? selectedItem.stac_item_id}
                    </div>
                    {selectedItem.datetime && (
                      <div style={{ color: C.textMuted }}>
                        {new Date(selectedItem.datetime).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Step 2: Configure ─────────────────────────────────────────── */}
          {step === 'configure' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Field label="Set name" required>
                <input
                  value={setName}
                  onChange={(e) => setSetName(e.target.value)}
                  placeholder="e.g. Land cover mask 2024"
                  style={inputStyle}
                />
              </Field>

              <Field label="Description">
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  style={{ ...inputStyle, height: 'auto', padding: '8px 10px', resize: 'vertical' }}
                />
              </Field>

              <Field label="Annotation schema" required>
                <select value={schemaId} onChange={(e) => setSchemaId(e.target.value)} style={selectStyle}>
                  <option value="">— Select schema —</option>
                  {schemasQ.data?.items.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                {schemaId && classesQ.data && (
                  <p style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>
                    {classesQ.data.items.length} classes available
                  </p>
                )}
              </Field>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="Band index">
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={bandIndex}
                    onChange={(e) => setBandIndex(Math.max(1, parseInt(e.target.value) || 1))}
                    style={inputStyle}
                  />
                  <p style={{ fontSize: 11, color: C.textMuted, marginTop: 3 }}>1-based band to read values from</p>
                </Field>

                <Field label="Nodata value">
                  <input
                    type="number"
                    value={nodataValue}
                    onChange={(e) => setNodataValue(e.target.value === '' ? '' : parseFloat(e.target.value))}
                    placeholder="0"
                    style={inputStyle}
                  />
                  <p style={{ fontSize: 11, color: C.textMuted, marginTop: 3 }}>Pixel value to exclude</p>
                </Field>
              </div>

              {loadError && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: '#fef2f0', border: `1px solid #f0b8af`, borderRadius: 6 }}>
                  <AlertCircle size={14} style={{ color: C.danger, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: C.danger }}>{loadError}</span>
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: Mapping ───────────────────────────────────────────── */}
          {step === 'mapping' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <p style={{ fontSize: 13, color: C.textSec, margin: 0 }}>
                  Assign a schema class to each pixel value.
                </p>
                <span style={{ fontSize: 12, color: mappedCount === totalCount ? C.success : C.textMuted, fontWeight: 600 }}>
                  {mappedCount}/{totalCount} mapped
                </span>
              </div>

              {rasterValues?.truncated && (
                <div style={{ fontSize: 12, color: C.textMuted, background: C.bg, padding: '6px 10px', borderRadius: 5, border: `1px solid ${C.border}` }}>
                  Showing first {rasterValues.values.length} of {rasterValues.total_unique} unique values.
                </div>
              )}

              <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
                {/* Header row */}
                <div style={{
                  display: 'grid', gridTemplateColumns: '60px 20px 1fr',
                  gap: 10, padding: '7px 12px',
                  background: C.bg, borderBottom: `1px solid ${C.border}`,
                  fontSize: 11, fontWeight: 600, color: C.textMuted,
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                }}>
                  <span>Value</span>
                  <span />
                  <span>Class</span>
                </div>

                {/* Nodata row */}
                {nodata !== null && rasterValues?.values.includes(nodata) && (
                  <ValueMappingRow
                    value={nodata}
                    classId=""
                    classes={[]}
                    isNodata
                    onChange={() => {}}
                  />
                )}

                {/* Value rows */}
                {valueMap.map((row) => (
                  <ValueMappingRow
                    key={row.value}
                    value={row.value}
                    classId={row.classId}
                    classes={classes}
                    isNodata={false}
                    onChange={(classId) =>
                      setValueMap((prev) =>
                        prev.map((r) => (r.value === row.value ? { ...r, classId } : r)),
                      )
                    }
                  />
                ))}

                {valueMap.length === 0 && (
                  <div style={{ padding: '20px 12px', textAlign: 'center', color: C.textMuted, fontSize: 13 }}>
                    No mappable values found (all values may be nodata).
                  </div>
                )}
              </div>

              {mappedCount === 0 && valueMap.length > 0 && (
                <p style={{ fontSize: 12, color: C.textMuted, margin: 0 }}>
                  You can save without assigning classes — the mask will render with a default colormap.
                </p>
              )}
            </div>
          )}

          {/* ── Step 4: Done ─────────────────────────────────────────────── */}
          {step === 'done' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '32px 0' }}>
              <CheckCircle2 size={48} style={{ color: C.success }} />
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 6 }}>
                  Raster mask saved
                </p>
                <p style={{ fontSize: 13, color: C.textSec, maxWidth: 340, margin: '0 auto' }}>
                  <strong>{setName}</strong> is ready. Add it to a map from the Library panel to render the classified raster overlay.
                </p>
              </div>
              {mappedCount > 0 && (
                <div style={{ fontSize: 12, color: C.textMuted }}>
                  {mappedCount} of {totalCount} values mapped to classes
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 20px', borderTop: `1px solid ${C.border}`,
          background: '#fafaf9',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        }}>
          <div>
            {step !== 'source' && step !== 'done' && (
              <button
                onClick={() => {
                  if (step === 'configure') setStep('source');
                  else if (step === 'mapping') setStep('configure');
                }}
                disabled={isPending}
                style={{
                  height: 34, padding: '0 14px', borderRadius: 6,
                  border: `1px solid ${C.border}`, background: '#fff',
                  fontSize: 13, color: C.textSec, cursor: 'pointer',
                  opacity: isPending ? 0.5 : 1,
                }}
              >
                Back
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleClose}
              disabled={isPending}
              style={{
                height: 34, padding: '0 14px', borderRadius: 6,
                border: `1px solid ${C.border}`, background: '#fff',
                fontSize: 13, color: C.textSec, cursor: 'pointer',
                opacity: isPending ? 0.5 : 1,
              }}
            >
              {step === 'done' ? 'Close' : 'Cancel'}
            </button>

            {step === 'source' && (
              <button
                onClick={() => setStep('configure')}
                disabled={!datasetId || !datasetItemId}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  height: 34, padding: '0 16px', borderRadius: 6, border: 'none',
                  background: !datasetId || !datasetItemId ? C.accentLight : C.accent,
                  color: '#fff', fontSize: 13, fontWeight: 600,
                  cursor: !datasetId || !datasetItemId ? 'default' : 'pointer',
                }}
              >
                Next <ChevronRight size={14} />
              </button>
            )}

            {step === 'configure' && (
              <button
                onClick={() => prepareMapping.mutate()}
                disabled={!schemaId || !setName.trim() || prepareMapping.isPending}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  height: 34, padding: '0 16px', borderRadius: 6, border: 'none',
                  background: !schemaId || !setName.trim() ? C.accentLight : C.accent,
                  color: '#fff', fontSize: 13, fontWeight: 600,
                  cursor: !schemaId || !setName.trim() ? 'default' : 'pointer',
                  opacity: prepareMapping.isPending ? 0.7 : 1,
                }}
              >
                {prepareMapping.isPending ? (
                  <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Loading values…</>
                ) : (
                  <>Load values <ChevronRight size={14} /></>
                )}
              </button>
            )}

            {step === 'mapping' && (
              <button
                onClick={() => saveMapping.mutate()}
                disabled={saveMapping.isPending}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  height: 34, padding: '0 16px', borderRadius: 6, border: 'none',
                  background: C.accent, color: '#fff', fontSize: 13, fontWeight: 600,
                  cursor: saveMapping.isPending ? 'default' : 'pointer',
                  opacity: saveMapping.isPending ? 0.7 : 1,
                }}
              >
                {saveMapping.isPending ? (
                  <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</>
                ) : (
                  <><CheckCircle2 size={13} /> Save mask</>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
