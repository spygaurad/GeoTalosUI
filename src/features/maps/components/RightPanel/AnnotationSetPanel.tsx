'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pencil, Layers, Trash2, ImageIcon, Download } from 'lucide-react';
import { useMapLayersStore } from '@/stores/mapLayersStore';
import { annotationSetsApi } from '@/lib/api/annotation-sets';
import { datasetsApi } from '@/lib/api/datasets';
import { annotationSchemasApi } from '@/lib/api/annotation-schemas';
import { qk } from '@/lib/query-keys';
import type { AnnotationClass } from '@/types/api';
import { MC } from '../../mapColors';
import { normalizeClassStyleDefinition } from '../../utils/annotationStyles';

function asNonEmptyText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getClassDescription(cls: AnnotationClass): string | undefined {
  return asNonEmptyText(cls.description) ?? asNonEmptyText(cls.properties?.description);
}

interface AnnotationSetPanelProps {
  annotationSetId: string;
  mapId?: string;
}

export function AnnotationSetPanel({ annotationSetId, mapId }: AnnotationSetPanelProps) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const openAnnotationPanel = useMapLayersStore((s) => s.openAnnotationPanel);
  const removeLayer = useMapLayersStore((s) => s.removeLayer);
  const closeRightPanel = useMapLayersStore((s) => s.closeRightPanel);
  const backendLayerIds = useMapLayersStore((s) => s.backendLayerIds);
  const layerId = `annset-${annotationSetId}`;
  const layer = useMapLayersStore((s) => s.layers[layerId]);
  const setLayerOpacity = useMapLayersStore((s) => s.setLayerOpacity);
  const queryClient = useQueryClient();

  const isRasterMask = !!layer?.isRasterMask;

  const { data: annSet, isLoading } = useQuery({
    queryKey: qk.annotationSets.detail(annotationSetId),
    queryFn: () => annotationSetsApi.get(annotationSetId),
    enabled: !!annotationSetId,
    retry: 2,
    retryDelay: 1000,
  });

  const { data: schema } = useQuery({
    queryKey: qk.annotationSchemas.detail(annSet?.schema_id ?? ''),
    queryFn: () => annotationSchemasApi.get(annSet!.schema_id!),
    enabled: !!annSet?.schema_id,
  });

  // Raster config — only fetch for raster masks
  const { data: rasterConfig } = useQuery({
    queryKey: ['annotation-sets', annotationSetId, 'raster-config'],
    queryFn: () => annotationSetsApi.getRasterConfig(annotationSetId),
    enabled: !!annotationSetId && isRasterMask,
  });

  const classes = schema?.classes ?? annSet?.schema?.classes ?? [];
  const geometryTypes = schema?.geometry_types ?? [];

  const handleAddAnnotation = () => {
    // Open the annotation panel, pre-filled with this set's info
    openAnnotationPanel();
    // Set the pending annotation's set/class after a tick (after state update)
    setTimeout(() => {
      const store = useMapLayersStore.getState();
      if (store.pendingAnnotation) {
        store.setPendingAnnotationField({
          annotationSetId: annotationSetId,
          classId: classes[0]?.id,
        });
      }
    }, 0);
  };

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const fc = await annotationSetsApi.getAllFeatures(annotationSetId);
      const safeName = (annSet?.name ?? 'annotation-set').replace(/[^a-z0-9-_]+/gi, '_');
      const blob = new Blob([JSON.stringify(fc, null, 2)], { type: 'application/geo+json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeName}.geojson`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      const count = fc.features?.length ?? 0;
      toast.success(`Downloaded ${count} feature${count !== 1 ? 's' : ''}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  const handleRemoveFromMap = async () => {
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    if (mapId) {
      const backendId = backendLayerIds[layerId];
      if (backendId) {
        try {
          await datasetsApi.deleteMapLayer(mapId, backendId);
        } catch {
          toast.error('Unable to delete layer');
          setConfirmRemove(false);
          return;
        }
      }
    }
    removeLayer(layerId);
    closeRightPanel();
    if (mapId) {
      queryClient.invalidateQueries({ queryKey: qk.maps.detail(mapId) });
    }
  };

  useEffect(() => {
    if (!confirmRemove) return;
    const t = setTimeout(() => setConfirmRemove(false), 3000);
    return () => clearTimeout(t);
  }, [confirmRemove]);

  if (isLoading) {
    return (
      <div style={{ padding: '20px 14px', textAlign: 'center' }}>
        <div style={{ fontSize: 12, color: MC.textMuted }}>Loading...</div>
      </div>
    );
  }

  if (!annSet) {
    return (
      <div style={{ padding: '20px 14px', textAlign: 'center' }}>
        <div style={{ fontSize: 12, color: MC.textMuted }}>Annotation set not found</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
      {/* Header info */}
      <Section title={isRasterMask ? 'Raster Mask' : 'Annotation Set'}>
        <div style={{ marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {isRasterMask && (
              <ImageIcon size={13} style={{ color: MC.accent, flexShrink: 0 }} />
            )}
            <div style={{ fontSize: 13, fontWeight: 600, color: MC.text }}>{annSet.name}</div>
          </div>
          {isRasterMask && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              marginTop: 5, padding: '2px 7px', borderRadius: 10,
              background: MC.accentDim, border: `1px solid ${MC.border}`,
              fontSize: 10, fontWeight: 600, color: MC.accent, letterSpacing: '0.04em',
            }}>
              RASTER MASK
            </div>
          )}
          {annSet.description && (
            <div style={{ fontSize: 11, color: MC.textMuted, marginTop: 4, lineHeight: 1.4 }}>
              {annSet.description}
            </div>
          )}
        </div>
        {!isRasterMask && annSet.annotation_count != null && (
          <div style={{ fontSize: 11, color: MC.textMuted }}>
            {annSet.annotation_count} annotation{annSet.annotation_count !== 1 ? 's' : ''}
          </div>
        )}
        {schema && (
          <div style={{ fontSize: 11, color: MC.textMuted, marginTop: 4 }}>
            Schema: {schema.name} (v{schema.version})
          </div>
        )}
        {!isRasterMask && geometryTypes.length > 0 && (
          <div style={{ fontSize: 10, color: MC.textMuted, marginTop: 4 }}>
            Geometry: {geometryTypes.join(', ')}
          </div>
        )}
      </Section>

      {/* Raster mask config details */}
      {isRasterMask && rasterConfig && (
        <Section title="Raster Config">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
              <span style={{ color: MC.textMuted }}>Band</span>
              <span style={{ color: MC.text, fontWeight: 600 }}>{rasterConfig.band_index}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
              <span style={{ color: MC.textMuted }}>Mapped values</span>
              <span style={{ color: MC.text, fontWeight: 600 }}>
                {Object.keys(rasterConfig.colormap).length}
              </span>
            </div>
          </div>
        </Section>
      )}

      {/* Raster mask value→class colormap */}
      {isRasterMask && rasterConfig && classes.length > 0 && (
        <Section title="Value Mapping">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {Object.entries(rasterConfig.colormap).map(([val, rgba]) => {
              const [r, g, b, a] = rgba;
              if (a === 0) return null; // skip transparent (nodata)
              const hex = `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
              return (
                <div key={val} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{
                    width: 10, height: 10, borderRadius: 2, flexShrink: 0,
                    background: hex, border: `1px solid ${MC.borderLight}`,
                  }} />
                  <span style={{ fontSize: 10, color: MC.textMuted, fontFamily: 'monospace', width: 24, flexShrink: 0 }}>
                    {val}
                  </span>
                  <span style={{ fontSize: 11, color: MC.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {classes.find((c) => {
                      const style = c.style?.definition;
                      if (!style) return false;
                      const ch = (style as Record<string, string>).fillColor?.toLowerCase();
                      return ch === hex.toLowerCase();
                    })?.name ?? '—'}
                  </span>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Classes — for vector annotation sets */}
      {!isRasterMask && classes.length > 0 && (
        <Section title="Classes">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {renderClassTree(classes)}
          </div>
        </Section>
      )}

      {/* Layer opacity */}
      {layer && (
        <Section title="Opacity">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="range" min={0} max={100}
              value={Math.round(layer.opacity * 100)}
              aria-label="Layer opacity"
              aria-valuetext={`${Math.round(layer.opacity * 100)}%`}
              onChange={(e) => setLayerOpacity(layerId, Number(e.target.value) / 100)}
              style={{ flex: 1, accentColor: MC.accent, cursor: 'pointer' }}
            />
            <span style={{ fontSize: 11, color: MC.textMuted, width: 32, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {Math.round(layer.opacity * 100)}%
            </span>
          </div>
        </Section>
      )}

      {/* Footer actions */}
      <div style={{
        padding: '12px 14px 16px',
        borderTop: `1px solid ${MC.border}`,
        flexShrink: 0,
        marginTop: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}>
        <button
          onClick={handleRemoveFromMap}
          style={{
            width: '100%',
            height: 32,
            borderRadius: 4,
            border: `1px solid ${MC.accent}`,
            background: confirmRemove ? MC.accentDim : 'transparent',
            color: MC.accent,
            cursor: 'pointer',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.02em',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <Trash2 size={12} />
          {confirmRemove ? 'Click again to remove from map' : 'Remove from map'}
        </button>
        {!isRasterMask && (
          <button
            onClick={handleDownload}
            disabled={downloading}
            style={{
              width: '100%',
              height: 32,
              borderRadius: 4,
              border: `1px solid ${MC.border}`,
              background: 'transparent',
              color: MC.text,
              cursor: downloading ? 'default' : 'pointer',
              opacity: downloading ? 0.6 : 1,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.02em',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <Download size={12} />
            {downloading ? 'Preparing…' : 'Download GeoJSON'}
          </button>
        )}
        {!isRasterMask && (
          <button
            onClick={handleAddAnnotation}
            style={{
              width: '100%',
              height: 34,
              borderRadius: 4,
              border: `1.5px solid ${MC.accent}`,
              background: MC.accentDim,
              color: MC.accent,
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.03em',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <Pencil size={12} />
            Add Annotation
          </button>
        )}
      </div>
    </div>
  );
}

// ── Class tree rendering ─────────────────────────────────────────────────────

function renderClassTree(classes: AnnotationClass[]) {
  // Build a flat list, indented by path depth
  const sorted = [...classes].sort((a, b) => (a.path ?? a.name).localeCompare(b.path ?? b.name));

  return sorted.map((cls) => {
    const depth = cls.path ? cls.path.split('.').length - 1 : 0;
    const color = normalizeClassStyleDefinition(
      cls.style?.definition as Record<string, unknown> | undefined,
    ).fillColor;
    const description = getClassDescription(cls);

    return (
      <div
        key={cls.id}
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
          paddingLeft: depth * 16,
        }}
      >
        <div style={{
          width: 10,
          height: 10,
          borderRadius: 2,
          background: color,
          flexShrink: 0,
          opacity: 0.85,
          marginTop: description ? 2 : 3,
        }} />
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <span style={{
            fontSize: 12,
            color: MC.text,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {cls.name}
          </span>
          {description && (
            <span style={{
              marginTop: 1,
              fontSize: 10,
              color: MC.textMuted,
              lineHeight: 1.3,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}>
              {description}
            </span>
          )}
        </div>
      </div>
    );
  });
}

// ── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      padding: '12px 14px',
      borderBottom: `1px solid ${MC.border}`,
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700,
        letterSpacing: '0.08em', textTransform: 'uppercase',
        color: MC.sectionLabel,
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <Layers size={11} />
        {title}
      </div>
      {children}
    </div>
  );
}
