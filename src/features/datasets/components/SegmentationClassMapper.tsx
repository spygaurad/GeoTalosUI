'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, Palette } from 'lucide-react';
import { toast } from 'sonner';
import { MC } from '@/features/maps/mapColors';
import { datasetsApi } from '@/lib/api/datasets';
import { annotationSchemasApi } from '@/lib/api/annotation-schemas';
import { qk } from '@/lib/query-keys';
import type { AnnotationClass } from '@/types/api';

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: MC.sectionLabel,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  display: 'block',
  marginBottom: 5,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: MC.inputBg,
  border: `1px solid ${MC.inputBorder}`,
  borderRadius: 5,
  padding: '5px 8px',
  fontSize: 12,
  color: MC.text,
  outline: 'none',
  boxSizing: 'border-box',
};

function classFill(cls: AnnotationClass | undefined): string {
  const fill = cls?.style?.definition?.fillColor;
  return typeof fill === 'string' ? fill : '#888888';
}

/**
 * Map a segmentation_mask dataset's pixel values to annotation classes.
 * Mirrors the annotation-set "Import Raster Mask" flow: reads the unique pixel
 * values live from the raster, excludes the nodata value, then maps each
 * remaining value to a class. Colors are derived from the classes' styles at
 * render time — only the value→class association is saved.
 *
 * Reused both in the upload wizard (post-ingest) and on the dataset page (works
 * for already-ingested / old masks since values are read live).
 */
export function SegmentationClassMapper({
  datasetId,
  onDone,
}: {
  datasetId: string;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const [schemaId, setSchemaId] = useState('');
  const [bandIndex, setBandIndex] = useState(1);
  const [nodataValue, setNodataValue] = useState<number | ''>(0);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  const datasetQ = useQuery({
    queryKey: qk.datasets.detail(datasetId),
    queryFn: () => datasetsApi.get(datasetId),
  });
  // Unique class IDs read live from the mask raster (same as the raster-mask import).
  const valuesQ = useQuery({
    queryKey: [...qk.datasets.detail(datasetId), 'raster-values', bandIndex],
    queryFn: () => datasetsApi.getRasterValues(datasetId, bandIndex),
    staleTime: 5 * 60_000,
  });
  const schemasQ = useQuery({
    queryKey: qk.annotationSchemas.list(),
    queryFn: () => annotationSchemasApi.list(100, 0),
  });
  const classesQ = useQuery({
    queryKey: qk.annotationSchemas.classes(schemaId),
    queryFn: () => annotationSchemasApi.getClasses(schemaId),
    enabled: !!schemaId,
  });

  const rc = datasetQ.data?.metadata?.rendering_config;
  const allValues = valuesQ.data?.values ?? rc?.class_values ?? [];
  const nodata = typeof nodataValue === 'number' ? nodataValue : null;
  const mappableValues = allValues.filter((v) => v !== nodata);
  const schemas = schemasQ.data?.items ?? [];
  const classes = classesQ.data?.items ?? [];
  const classById = new Map(classes.map((c) => [c.id, c]));

  // Prefill from an existing class_map (re-mapping after a previous save).
  useEffect(() => {
    const existing = rc?.class_map;
    if (existing && !schemaId) {
      setSchemaId(existing.schema_id);
      setBandIndex(existing.band_index ?? 1);
      setNodataValue(existing.nodata_value ?? '');
      setMapping(existing.value_class_map ?? {});
    }
  }, [rc?.class_map, schemaId]);

  const save = useMutation({
    mutationFn: () =>
      datasetsApi.saveClassMap(datasetId, {
        schema_id: schemaId,
        band_index: bandIndex,
        nodata_value: nodata,
        value_class_map: Object.fromEntries(
          Object.entries(mapping)
            .filter(([value, classId]) => classId && Number(value) !== nodata),
        ),
      }),
    onSuccess: () => {
      toast.success('Class mapping saved — overlay will render with class colors.');
      setSaved(true);
      qc.invalidateQueries({ queryKey: qk.datasets.detail(datasetId) });
      onDone?.();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : 'Failed to save class mapping'),
  });

  const mappedCount = mappableValues.filter((v) => mapping[String(v)]).length;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: '12px',
        border: `1px solid ${MC.border}`,
        borderRadius: 8,
        background: MC.hoverBg,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <Palette size={14} style={{ color: MC.accent }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: MC.text }}>
          Map mask classes
        </span>
      </div>
      <div style={{ fontSize: 11, color: MC.textMuted, lineHeight: 1.5, marginTop: -6 }}>
        Assign each pixel value to an annotation class so the overlay renders with
        class colors.
      </div>

      {/* Band + nodata */}
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ width: 80 }}>
          <label style={labelStyle}>Band</label>
          <input
            type="number"
            min={1}
            value={bandIndex}
            onChange={(e) => setBandIndex(Math.max(1, Number(e.target.value) || 1))}
            style={inputStyle}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Nodata value</label>
          <input
            type="number"
            value={nodataValue}
            placeholder="none"
            onChange={(e) =>
              setNodataValue(e.target.value === '' ? '' : Number(e.target.value))
            }
            style={inputStyle}
          />
        </div>
      </div>

      {/* Live value read status */}
      {valuesQ.isLoading && (
        <div style={{ fontSize: 12, color: MC.textMuted, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
          Reading pixel values from the mask…
        </div>
      )}
      {valuesQ.isError && (
        <div style={{ fontSize: 11, color: MC.danger }}>
          Could not read pixel values from the raster.
        </div>
      )}
      {valuesQ.isSuccess && (
        <div style={{ fontSize: 11, color: MC.textMuted }}>
          {allValues.length} unique value{allValues.length === 1 ? '' : 's'} found
          {valuesQ.data?.truncated ? ' (truncated)' : ''}.
        </div>
      )}

      {/* Schema picker */}
      <div>
        <label style={labelStyle}>Annotation schema</label>
        <select
          value={schemaId}
          onChange={(e) => {
            setSchemaId(e.target.value);
            setMapping({});
          }}
          style={inputStyle}
        >
          <option value="">Select a schema…</option>
          {schemas.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {/* Loading classes */}
      {schemaId && classesQ.isLoading && (
        <div style={{ fontSize: 12, color: MC.textMuted, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
          Loading classes…
        </div>
      )}

      {/* Value → class rows */}
      {schemaId && !classesQ.isLoading && valuesQ.isSuccess && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
          {/* Excluded nodata row (mirrors Import Raster Mask) */}
          {nodata !== null && allValues.includes(nodata) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: 0.6 }}>
              <span style={{ width: 14, height: 14, borderRadius: 3, flexShrink: 0, border: `1px dashed ${MC.borderLight}` }} />
              <span style={{ width: 34, flexShrink: 0, fontSize: 12, fontFamily: 'monospace', color: MC.textSecondary }}>
                {nodata}
              </span>
              <span style={{ flex: 1, fontSize: 11, color: MC.textMuted, fontStyle: 'italic' }}>
                Excluded (nodata)
              </span>
            </div>
          )}

          {mappableValues.map((value) => {
            const key = String(value);
            const chosen = classById.get(mapping[key]);
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 3,
                    flexShrink: 0,
                    background: mapping[key] ? classFill(chosen) : 'transparent',
                    border: `1px solid ${mapping[key] ? classFill(chosen) : MC.borderLight}`,
                  }}
                />
                <span style={{ width: 34, flexShrink: 0, fontSize: 12, fontFamily: 'monospace', color: MC.textSecondary }}>
                  {key}
                </span>
                <select
                  value={mapping[key] ?? ''}
                  onChange={(e) => setMapping((m) => ({ ...m, [key]: e.target.value }))}
                  style={{ ...inputStyle, flex: 1 }}
                >
                  <option value="">— unmapped —</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}

          {mappableValues.length === 0 && (
            <div style={{ fontSize: 11, color: MC.textMuted }}>
              No class values to map (all values are nodata).
            </div>
          )}
        </div>
      )}

      {/* Save */}
      <button
        onClick={() => save.mutate()}
        disabled={!schemaId || mappedCount === 0 || save.isPending}
        style={{
          height: 32,
          borderRadius: 6,
          border: 'none',
          background: schemaId && mappedCount > 0 ? MC.accent : MC.borderLight,
          color: schemaId && mappedCount > 0 ? '#1c2119' : MC.textMuted,
          fontSize: 12,
          fontWeight: 700,
          cursor: schemaId && mappedCount > 0 ? 'pointer' : 'default',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
        }}
      >
        {save.isPending ? (
          <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
        ) : saved ? (
          <CheckCircle2 size={13} />
        ) : null}
        {saved ? 'Saved — save again to update' : `Save mapping${mappedCount ? ` (${mappedCount})` : ''}`}
      </button>
    </div>
  );
}
