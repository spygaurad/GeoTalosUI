'use client';

import { useState, useMemo, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
import { toast } from 'sonner';
import { Trash2, Edit2, ChevronRight, ChevronDown, BadgeCheck } from 'lucide-react';
import type { SelectedFeature } from '@/features/maps/types';
import type { AnnotationClass } from '@/types/api';
import { getFeatureConfig, type PropertySchema } from '@/features/maps/featureRegistry';
import { qk } from '@/lib/query-keys';
import { useMapLayersStore } from '@/stores/mapLayersStore';
import { useAnnotationStore } from '@/stores/annotationStore';
import { annotationClassesApi } from '@/lib/api/annotation-classes';
import { annotationSchemasApi } from '@/lib/api/annotation-schemas';
import { MC } from '../../mapColors';
import {
  extractClassIdFromProperties,
  normalizeClassStyleDefinition,
  resolveClassStyle,
} from '../../utils/annotationStyles';

const CLASS_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Permissive UUID matcher — any opaque id we should keep out of the UI as a raw value.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}
// Acronyms that prettyKey would otherwise sentence-case incorrectly.
const LABEL_OVERRIDES: Record<string, string> = { aoi: 'AOI', ndvi: 'NDVI' };
const HIDDEN_INFO_KEYS = new Set([
  'class',
  'class_id',
  '_class_id',
  'annotation_class',
  'annotation_class_id',
  'ns_span',
  'ew_span',
]);

// ── Value formatters ──────────────────────────────────────────────────────────
function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number' && key === 'confidence') {
    return `${(value * 100).toFixed(1)}%`;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  // Render arrays/objects readably rather than dumping raw JSON.
  if (Array.isArray(value)) {
    return value.map((v) => formatValue(key, v)).join(', ');
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${formatValue(k, v)}`)
      .join(', ') || '—';
  }
  return String(value);
}

function asNonEmptyText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

// snake_case / camelCase key → human "Sentence case" label.
function prettyKey(key: string): string {
  const spaced = key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// Label for an id/name field with the trailing "_id"/"_name" stripped so the
// human row reads e.g. "AOI" (from aoi_name) or "Verified from set"
// (from verified_from_set_id) instead of "Aoi name" / "Verified from set id".
function baseFieldLabel(key: string): string {
  const base = key.replace(/_(id|name)$/i, '');
  return LABEL_OVERRIDES[base.toLowerCase()] ?? prettyKey(base);
}

// Recursively render nested objects/arrays as indented key/value rows so the
// advanced metadata stays readable instead of one long comma-joined string.
function MetaRows({ value, depth }: { value: unknown; depth: number }) {
  if (value === null || value === undefined || value === '') {
    return <span style={{ color: MC.textMuted }}>—</span>;
  }
  if (typeof value !== 'object') {
    return <span style={{ color: MC.textMuted, wordBreak: 'break-word' }}>{formatValue('', value)}</span>;
  }
  const entries = Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);
  return (
    <>
      {entries.map(([k, v]) => {
        const nested = v !== null && typeof v === 'object';
        return (
          <div key={k} style={{ marginLeft: depth > 0 ? 10 : 0, marginBottom: 2 }}>
            <span style={{ color: MC.sectionLabel }}>
              {Array.isArray(value) ? `#${k}` : prettyKey(k)}:
            </span>{' '}
            {nested ? (
              <div style={{ marginTop: 2 }}><MetaRows value={v} depth={depth + 1} /></div>
            ) : (
              <span style={{ color: MC.textMuted, wordBreak: 'break-word' }}>{formatValue(k, v)}</span>
            )}
          </div>
        );
      })}
    </>
  );
}

function getClassDescription(cls: AnnotationClass | null | undefined): string | undefined {
  const direct = asNonEmptyText(cls?.description);
  if (direct) return direct;
  if (!cls?.properties || typeof cls.properties !== 'object') return undefined;
  const props = cls.properties as Record<string, unknown>;
  return asNonEmptyText(props.description);
}

function getNestedClassInfo(properties: Record<string, unknown>): { name?: string; description?: string } {
  const nested = properties.annotation_class ?? properties.annotationClass;
  if (!nested || typeof nested !== 'object') return {};
  const rec = nested as Record<string, unknown>;
  return {
    name: asNonEmptyText(rec.name) ?? asNonEmptyText(rec.path),
    description: asNonEmptyText(rec.description),
  };
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
  mapId?: string;
}

export function FeaturePropertiesPanel({ feature, mapId }: FeaturePropertiesPanelProps) {
  const queryClient = useQueryClient();
  const { userId } = useAuth();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);
  const [loadingFull, setLoadingFull] = useState(false);
  const [fullProps, setFullProps] = useState<Record<string, unknown> | null>(null);
  const [resolvedClass, setResolvedClass] = useState<AnnotationClass | null>(null);
  // UUID → human name for referenced annotation sets (e.g. verified_from_set_id).
  const [resolvedSetNames, setResolvedSetNames] = useState<Record<string, string>>({});
  // Name of the schema the feature's class belongs to.
  const [schemaName, setSchemaName] = useState<string | null>(null);

  // Annotation delete support
  const annotationSetId = feature.properties._annotation_set_id as string | undefined;
  const annotationId = feature.properties._annotation_id as string | undefined;
  const canDelete = !!annotationSetId && !!annotationId;
  // Verify = move this annotation into the map's human-verified (map, schema)
  // set. Needs a map context; hidden once already verified.
  const alreadyVerified = feature.properties.review_status === 'verified';
  const canVerify = canDelete && !!mapId && !alreadyVerified;
  // MVT-click flag — the clicked feature came from a vector-tile layer and has
  // only the minimal properties baked into the tile. Full annotation (custom
  // properties + full geometry) must be lazy-fetched from the backend.
  const isMvtClick = feature.properties._mvt === true;

  const handleLoadFull = async () => {
    if (!annotationId) return;
    setLoadingFull(true);
    try {
      const { annotationsApi } = await import('@/lib/api/annotations');
      const ann = await annotationsApi.get(annotationId);
      setFullProps({
        ...(ann.properties ?? {}),
        label: ann.label,
        confidence: ann.confidence,
        status: ann.status,
        created_at: ann.created_at,
        updated_at: ann.updated_at,
      });
      toast.success('Loaded full annotation');
    } catch {
      toast.error('Failed to load annotation');
    } finally {
      setLoadingFull(false);
    }
  };

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

  const handleVerify = async () => {
    if (!annotationSetId || !annotationId || !mapId) return;
    setVerifying(true);
    try {
      const { annotationSetsApi } = await import('@/lib/api/annotation-sets');
      const { getMapManager } = await import('@/features/maps/MapManager');
      const res = await annotationSetsApi.verifyFeature(annotationSetId, annotationId, mapId);
      const store = useMapLayersStore.getState();
      const mm = getMapManager();
      const verifiedLayerId = `annset-${res.verified_set_id}`;
      // 1. Source: drop the moved point from its original (model/raw) layer.
      //    Uses the single-slot store refresh — kept as the ONLY such call so it
      //    can't be clobbered by a second refresh in the same tick.
      store.requestAnnotationSetRefresh(res.source_set_id);
      // 2. Verified: ensure the layer exists (new sets are added + auto-fetched
      //    by the sync effect); refresh existing ones directly via the manager.
      if (!store.layers[verifiedLayerId]) {
        let name = 'Verified annotations';
        try {
          const set = await annotationSetsApi.get(res.verified_set_id);
          name = set.name ?? name;
        } catch { /* keep default name */ }
        store.addAnnotationSetLayer({ setId: res.verified_set_id, name });
      } else {
        try {
          const fc = await annotationSetsApi.getFeatures(res.verified_set_id);
          mm.setLayerData(verifiedLayerId, fc);
        } catch { /* layer may have been removed */ }
      }
      queryClient.invalidateQueries({ queryKey: qk.maps.detail(mapId) });
      toast.success(
        res.verified_set_created ? 'Verified — verified set created' : 'Annotation verified',
      );
      store.closeRightPanel();
    } catch {
      toast.error('Failed to verify annotation');
    } finally {
      setVerifying(false);
    }
  };

  // Look up registry config; fall back to generic display if not registered
  const config = getFeatureConfig(feature.featureType);
  const typeLabel = config?.label ?? feature.featureType;

  // Partition schema into read-only info fields and editable style fields
  const readOnlySchema = useMemo(
    () => config?.schema.filter((s) => s.readOnly) ?? [],
    [config],
  );
  const editableSchema = useMemo(
    () => config?.schema.filter((s) => !s.readOnly) ?? [],
    [config],
  );
  const visibleReadOnlySchema = useMemo(
    () => readOnlySchema.filter((s) => !HIDDEN_INFO_KEYS.has(s.name)),
    [readOnlySchema],
  );

  // Keys explicitly in the schema
  const schemaKeys = new Set(config?.schema.map((s) => s.name) ?? []);
  // Merge feature.properties with any lazy-fetched full annotation properties
  const mergedProps: Record<string, unknown> = {
    ...feature.properties,
    ...(fullProps ?? {}),
  };
  const classRef = useMemo(
    () => extractClassIdFromProperties(fullProps ? { ...feature.properties, ...fullProps } : feature.properties),
    [feature.properties, fullProps]
  );
  const nestedClassInfo = useMemo(
    () => getNestedClassInfo(fullProps ? { ...feature.properties, ...fullProps } : feature.properties),
    [feature.properties, fullProps],
  );
  // Additional properties not in schema. Split into readable primitives (shown
  // inline) and structured metadata (objects/arrays like patch, model_meta,
  // georef_metadata) which are tucked under a collapsible "Metadata" section so
  // the panel stays human-readable by default.
  const extraKeys = Object.keys(mergedProps).filter(
    (k) => !schemaKeys.has(k) && !k.startsWith('_') && !HIDDEN_INFO_KEYS.has(k)
  );
  const simpleExtraKeys = extraKeys.filter((k) => {
    const v = mergedProps[k];
    return v !== null && v !== undefined && v !== '' && typeof v !== 'object';
  });
  const metaKeys = extraKeys.filter((k) => {
    const v = mergedProps[k];
    return v !== null && typeof v === 'object';
  });

  // UUID-valued `*_set_id` references (e.g. verified_from_set_id) with no name
  // sibling are resolved to the set's human name. Joined into a stable string so
  // the effect only re-runs when the set of pending ids actually changes.
  const pendingSetIds = simpleExtraKeys
    .filter((k) => /_set_id$/i.test(k))
    .map((k) => mergedProps[k])
    .filter((v): v is string => isUuid(v) && !resolvedSetNames[v]);
  const pendingSetIdsKey = [...new Set(pendingSetIds)].sort().join(',');

  useEffect(() => {
    const ids = pendingSetIdsKey ? pendingSetIdsKey.split(',') : [];
    if (!ids.length) return;
    let cancelled = false;
    (async () => {
      const { annotationSetsApi } = await import('@/lib/api/annotation-sets');
      const entries = await Promise.all(
        ids.map(async (id) => {
          try {
            const set = await annotationSetsApi.get(id);
            return [id, set.name ?? id] as const;
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) return;
      setResolvedSetNames((prev) => {
        const next = { ...prev };
        for (const e of entries) if (e) next[e[0]] = e[1];
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [pendingSetIdsKey]);

  const layerClassStyles = useMapLayersStore((s) =>
    feature.layerId ? s.layers[feature.layerId]?.classStyles : undefined
  );

  // Prefer style from the active map layer class map, then fallback to annotationStore.
  const schemaClasses = useAnnotationStore((s) => s.schemaClasses);
  const schemaClass = classRef && schemaClasses ? schemaClasses[classRef] : undefined;

  useEffect(() => {
    let cancelled = false;
    if (!classRef || !CLASS_ID_RE.test(classRef) || schemaClass) {
      setResolvedClass(null);
      return () => {
        cancelled = true;
      };
    }
    annotationClassesApi.get(classRef)
      .then((cls) => {
        if (!cancelled) setResolvedClass(cls);
      })
      .catch(() => {
        if (!cancelled) setResolvedClass(null);
      });
    return () => {
      cancelled = true;
    };
  }, [classRef, schemaClass]);

  const classInfo = useMemo(() => {
    if (!classRef) return null;
    return {
      name:
        nestedClassInfo.name ??
        schemaClass?.name ??
        resolvedClass?.name ??
        (CLASS_ID_RE.test(classRef) ? `Class ${classRef.slice(0, 8)}` : classRef),
      description:
        nestedClassInfo.description ??
        getClassDescription(schemaClass) ??
        getClassDescription(resolvedClass),
    };
  }, [classRef, nestedClassInfo, schemaClass, resolvedClass]);

  // Resolve the annotation schema the class belongs to, so the panel can show a
  // human "Schema" line alongside the class name.
  const schemaId = schemaClass?.schema_id ?? resolvedClass?.schema_id ?? null;
  useEffect(() => {
    if (!schemaId) {
      setSchemaName(null);
      return;
    }
    let cancelled = false;
    annotationSchemasApi.get(schemaId)
      .then((s) => {
        if (!cancelled) setSchemaName(s.name ?? null);
      })
      .catch(() => {
        if (!cancelled) setSchemaName(null);
      });
    return () => {
      cancelled = true;
    };
  }, [schemaId]);

  // Turn a non-schema primitive prop into a human-readable { label, display }
  // row, or null to suppress it (raw UUIDs that carry no human meaning).
  const buildSimpleRow = (key: string): { label: string; display: string } | null => {
    const val = mergedProps[key];
    // user-id references → "You" / "Another user" (no users API to resolve
    // names). The stored value is a Clerk user id (e.g. "user_2abc…"), which is
    // what `userId` from useAuth() holds — so compare directly.
    if (/_user_id$/i.test(key)) {
      if (typeof val !== 'string' || val.length === 0) return null;
      const base = key.replace(/_user_id$/i, '');
      return { label: prettyKey(base), display: val === userId ? 'You' : 'Another user' };
    }
    // name fields: clean the label when a matching `_id` sibling exists
    if (/_name$/i.test(key)) {
      const hasIdSibling = `${key.replace(/_name$/i, '')}_id` in mergedProps;
      return {
        label: hasIdSibling ? baseFieldLabel(key) : prettyKey(key),
        display: formatValue(key, val),
      };
    }
    // UUID-valued id fields
    if (/_id$/i.test(key) && isUuid(val)) {
      // a name sibling already renders the readable value → drop the raw id
      if (asNonEmptyText(mergedProps[`${key.replace(/_id$/i, '')}_name`])) return null;
      // resolved set name available → show it
      const resolved = resolvedSetNames[val];
      if (resolved) return { label: baseFieldLabel(key), display: resolved };
      // a set id still resolving, or any other opaque uuid → hide raw value
      return null;
    }
    return { label: prettyKey(key), display: formatValue(key, val) };
  };

  const classStyle = useMemo(() => {
    const layerStyle = resolveClassStyle(layerClassStyles, classRef);
    if (layerStyle) return layerStyle;
    const fallbackDefinition = schemaClass?.style?.definition ?? resolvedClass?.style?.definition;
    if (!fallbackDefinition) return null;
    return normalizeClassStyleDefinition(fallbackDefinition as Record<string, unknown>);
  }, [classRef, layerClassStyles, schemaClass, resolvedClass]);

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
        <div title={feature.featureId} style={{ fontSize: 13, fontWeight: 700, color: MC.text }}>{typeLabel}</div>
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
        {classInfo?.name || visibleReadOnlySchema.length > 0 || simpleExtraKeys.length > 0 ? (
          <div style={{ padding: '10px 14px', borderBottom: `1px solid ${MC.border}` }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: MC.sectionLabel, marginBottom: 8 }}>
              Properties
            </div>

            {/* Class metadata */}
            {classInfo?.name && (
              <div style={{ marginBottom: 7 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: classInfo.description ? 3 : 0 }}>
                  <span style={{ fontSize: 11, color: MC.sectionLabel, flexShrink: 0, marginRight: 8 }}>Class</span>
                  <span style={{ fontSize: 11, color: MC.text, textAlign: 'right', wordBreak: 'break-all' }}>
                    {classInfo.name}
                  </span>
                </div>
                {schemaName && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: classInfo.description ? 3 : 0 }}>
                    <span style={{ fontSize: 11, color: MC.sectionLabel, flexShrink: 0, marginRight: 8 }}>Schema</span>
                    <span style={{ fontSize: 11, color: MC.text, textAlign: 'right', wordBreak: 'break-all' }}>
                      {schemaName}
                    </span>
                  </div>
                )}
                {classInfo.description && (
                  <div style={{ fontSize: 11, color: MC.textMuted, lineHeight: 1.35, marginLeft: 48 }}>
                    {classInfo.description}
                  </div>
                )}
              </div>
            )}

            {/* Schema-defined read-only fields */}
            {visibleReadOnlySchema.map((s) => {
              const val = mergedProps[s.name];
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

            {/* Extra primitive keys not in schema — humanized: ids resolved to
                names or suppressed so no raw UUID is shown. */}
            {simpleExtraKeys.map((key) => {
              const row = buildSimpleRow(key);
              if (!row) return null;
              return (
                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
                  <span style={{ fontSize: 11, color: MC.sectionLabel, flexShrink: 0, marginRight: 8 }}>{row.label}</span>
                  <span style={{ fontSize: 11, color: MC.textMuted, textAlign: 'right', wordBreak: 'break-all', fontVariantNumeric: 'tabular-nums' }}>
                    {row.display}
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}

        {/* Advanced metadata (objects/arrays) — collapsed by default */}
        {metaKeys.length > 0 ? (
          <div style={{ borderBottom: `1px solid ${MC.border}` }}>
            <button
              onClick={() => setMetaOpen((o) => !o)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '10px 14px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.07em',
                textTransform: 'uppercase',
                color: MC.sectionLabel,
              }}
            >
              {metaOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              Metadata
              <span style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0, color: MC.textMuted }}>
                ({metaKeys.length})
              </span>
            </button>
            {metaOpen && (
              <div style={{ padding: '0 14px 12px 14px', fontSize: 10, lineHeight: 1.5 }}>
                {metaKeys.map((key) => (
                  <div key={key} style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: MC.textSecondary, marginBottom: 3 }}>
                      {prettyKey(key)}
                    </div>
                    <div style={{ paddingLeft: 8, borderLeft: `1px solid ${MC.border}` }}>
                      <MetaRows value={mergedProps[key]} depth={0} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {/* Editable style controls (only for annotation types with a layerRef) */}
        {editableSchema.length > 0 && feature.layerRef ? (
          <div style={{ padding: '10px 14px' }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: MC.sectionLabel, marginBottom: 10 }}>
              Style
            </div>

            {editableSchema.map((s) => {
              // If feature has a class with a style, prefer the class's style value
              // Otherwise fall back to feature's own style properties
              let styleVal: unknown;
              if (classStyle) {
                // Map schema names to style definition field names
                const styleFieldMap: Record<string, keyof typeof classStyle> = {
                  'color': 'strokeColor',
                  'fillColor': 'fillColor',
                  'fillOpacity': 'fillOpacity',
                  'weight': 'strokeWidth',
                };
                const styleField = styleFieldMap[s.name];
                styleVal = styleField ? classStyle[styleField] : undefined;
              }
              // Fall back to feature's own properties if no class style
              const rawVal = styleVal !== undefined ? styleVal :
                            (feature.properties[`_${s.name}`] ?? feature.properties[s.name]);
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

        {/* Load full annotation (MVT-click only, before full data is loaded) */}
        {isMvtClick && annotationId && !fullProps && (
          <div style={{
            padding: '12px 14px',
            borderTop: `1px solid ${MC.border}`,
          }}>
            <button
              onClick={handleLoadFull}
              disabled={loadingFull}
              style={{
                width: '100%',
                height: 32,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                fontSize: 12,
                fontWeight: 600,
                color: MC.accent,
                background: `${MC.accent}12`,
                border: `1px solid ${MC.accent}30`,
                borderRadius: 6,
                cursor: loadingFull ? 'wait' : 'pointer',
                opacity: loadingFull ? 0.6 : 1,
                transition: 'all 0.15s',
              }}
            >
              <Edit2 size={13} />
              {loadingFull ? 'Loading…' : 'Load full annotation'}
            </button>
          </div>
        )}

        {/* Verify + Delete annotation actions */}
        {(canVerify || canDelete) && (
          <div style={{
            padding: '12px 14px',
            borderTop: `1px solid ${MC.border}`,
            marginTop: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}>
            {canVerify && (
              <button
                onClick={handleVerify}
                disabled={verifying}
                style={{
                  width: '100%',
                  height: 32,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#fff',
                  background: MC.accent,
                  border: `1px solid ${MC.accent}`,
                  borderRadius: 6,
                  cursor: verifying ? 'wait' : 'pointer',
                  opacity: verifying ? 0.6 : 1,
                  transition: 'all 0.15s',
                }}
              >
                <BadgeCheck size={13} />
                {verifying ? 'Verifying…' : 'Verify annotation'}
              </button>
            )}
            {canDelete && (
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
            )}
          </div>
        )}
      </div>
    </div>
  );
}
