'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import {
  SlidersHorizontal, ChevronDown, ChevronRight, Eye, EyeOff, Trash2, Layers as LayersIcon,
} from 'lucide-react';
import { annotationSetsApi } from '@/lib/api/annotation-sets';
import { annotationSchemasApi } from '@/lib/api/annotation-schemas';
import { useMapLayersStore } from '@/stores/mapLayersStore';
import { areaM2 } from '@/lib/geo';
import { normalizeClassStyleDefinition } from '../../utils/annotationStyles';
import { MC } from '../../mapColors';
import type { LayerConfig } from '../../types';
import type { GeoJSONGeometry } from '@/types/geo';
import { AnalysisDetailHeader } from './AnalysisDetailHeader';

interface AoiVisualizationPanelProps {
  aoiLayerId: string;
  /** Reserved — future per-AOI registry queries will key on the map. */
  mapId?: string;
  aoiBbox: [number, number, number, number] | undefined;
  onBack: () => void;
}

type ColorMode = 'class' | 'confidence';
type LayerLite = LayerConfig & { annotationSetId: string };

// Quadratic slider curve so the low end (small/noise masks) has fine control.
const AREA_SLIDER_MAX = 1000;

export function AoiVisualizationPanel({
  aoiLayerId, aoiBbox, onBack,
}: AoiVisualizationPanelProps) {
  const layerMap = useMapLayersStore((s) => s.layers);
  const setLayerAnnotationFilter = useMapLayersStore((s) => s.setLayerAnnotationFilter);
  const aoiName = layerMap[aoiLayerId]?.name ?? 'AOI';

  // ── Discover annotation-set layers attached to this AOI ──────────────────
  // We scope the visualization to annotation sets currently mounted on the
  // map whose bounds intersect the AOI bbox (or have no bounds, in which
  // case we include them — better to over-show than to drop something the
  // user just produced).
  const annotationSetLayers = useMemo<LayerLite[]>(() => {
    const all = Object.values(layerMap).filter(
      (l): l is LayerLite =>
        l.sourceType === 'annotation_set' && !!l.annotationSetId,
    );
    if (!aoiBbox) return all;
    return all.filter((l) => intersectsBbox(l.bounds ?? null, aoiBbox));
  }, [layerMap, aoiBbox]);

  const setIds = useMemo(
    () => annotationSetLayers.map((l) => l.annotationSetId),
    [annotationSetLayers],
  );

  // ── Per-set details (gives us schema_id for class lookup) ────────────────
  const setDetailQueries = useQueries({
    queries: setIds.map((id) => ({
      queryKey: ['aoi-viz', 'set-detail', id],
      queryFn: () => annotationSetsApi.get(id),
      staleTime: 5 * 60_000,
    })),
  });

  const schemaIds = useMemo(() => {
    const ids = new Set<string>();
    setDetailQueries.forEach((q) => {
      const sid = q.data?.schema_id;
      if (sid) ids.add(sid);
    });
    return Array.from(ids);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setDetailQueries.map((q) => q.data?.schema_id ?? '').join('|')]);

  const classQueries = useQueries({
    queries: schemaIds.map((sid) => ({
      queryKey: ['aoi-viz', 'classes', sid],
      queryFn: () => annotationSchemasApi.getClasses(sid),
      staleTime: 5 * 60_000,
    })),
  });

  const classById = useMemo(() => {
    const m = new Map<string, { name: string; color: string; stroke: string }>();
    classQueries.forEach((q) => {
      q.data?.items?.forEach((c) => {
        const def = normalizeClassStyleDefinition(
          (c.style?.definition ?? null) as Record<string, unknown> | null,
        );
        m.set(c.id, { name: c.name, color: def.fillColor, stroke: def.strokeColor });
      });
    });
    return m;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classQueries.map((q) => q.data).join('|')]);

  // ── Features per set (drives histogram / class chart / area filter) ──────
  const featureQueries = useQueries({
    queries: setIds.map((id) => ({
      queryKey: ['aoi-viz', 'features', id],
      queryFn: () => annotationSetsApi.getFeatures(id),
      staleTime: 60_000,
    })),
  });

  // Map setId → flattened feature summaries (kept so we can show per-set
  // counts when a set row is expanded without re-iterating the FC).
  const featuresBySet = useMemo(() => {
    const m = new Map<string, FeatureSummary[]>();
    setIds.forEach((id, i) => {
      const fc = featureQueries[i]?.data;
      const list: FeatureSummary[] = [];
      fc?.features?.forEach((f) => {
        const props = (f.properties ?? {}) as Record<string, unknown>;
        const classId = typeof props.class_id === 'string' ? props.class_id : undefined;
        const conf = typeof props.confidence === 'number' ? props.confidence : undefined;
        let m2: number | undefined;
        const geom = f.geometry as GeoJSONGeometry | undefined;
        if (geom && (geom.type === 'Polygon' || geom.type === 'MultiPolygon')) {
          try {
            const a = areaM2(geom);
            if (Number.isFinite(a) && a > 0) m2 = a;
          } catch {
            m2 = undefined;
          }
        }
        list.push({ classId, confidence: conf, areaM2: m2 });
      });
      m.set(id, list);
    });
    return m;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setIds.join('|'), featureQueries.map((q) => q.data).join('|')]);

  // Aggregated across every set in scope (filters work over this set).
  const allFeatures = useMemo<FeatureSummary[]>(
    () => Array.from(featuresBySet.values()).flat(),
    [featuresBySet],
  );

  // ── Filter state ─────────────────────────────────────────────────────────
  // Seed from the first scoped layer's persisted filter so reopening the panel
  // reflects the active on-map filter.
  const seedFilter = annotationSetLayers[0]?.annotationFilter;
  const [threshold, setThreshold] = useState(seedFilter?.minConfidence ?? 0);
  const [areaMin, setAreaMin] = useState(seedFilter?.minAreaM2 ?? 0);
  const [colorMode, setColorMode] = useState<ColorMode>(seedFilter?.colorMode ?? 'class');
  const [vizOpen, setVizOpen] = useState(true);

  // Push the filter to every annotation-set layer in scope so the map renderer
  // (MapManager.resolveAnnotationStyle) hides sub-threshold features and
  // recolors by confidence. Skips the very first render so we don't clobber a
  // freshly-seeded value.
  const didMountFilter = useRef(false);
  useEffect(() => {
    if (!didMountFilter.current) {
      didMountFilter.current = true;
      return;
    }
    annotationSetLayers.forEach((layer) => {
      setLayerAnnotationFilter(layer.id, {
        colorMode,
        minConfidence: threshold,
        minAreaM2: areaMin,
      });
    });
  // setIds string is a stable proxy for the layer set; layer objects change on
  // every store update which would otherwise re-fire this needlessly.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threshold, areaMin, colorMode, setIds.join('|')]);

  const stats = useMemo(() => {
    let total = 0, visible = 0;
    let withConf = 0, minConf = 1, maxConf = 0;
    let withArea = 0, maxArea = 0;
    allFeatures.forEach((f) => {
      total++;
      if (typeof f.confidence === 'number') {
        withConf++;
        if (f.confidence < minConf) minConf = f.confidence;
        if (f.confidence > maxConf) maxConf = f.confidence;
      }
      if (typeof f.areaM2 === 'number') {
        withArea++;
        if (f.areaM2 > maxArea) maxArea = f.areaM2;
      }
      let ok = true;
      if (typeof f.confidence === 'number' && f.confidence < threshold) ok = false;
      if (typeof f.areaM2 === 'number' && f.areaM2 < areaMin) ok = false;
      if (ok) visible++;
    });
    return {
      total, visible, withConf, withArea, maxArea,
      minConf: withConf ? minConf : 0, maxConf,
    };
  }, [allFeatures, threshold, areaMin]);

  const histogram = useMemo(() => {
    const bins = new Array(10).fill(0) as number[];
    allFeatures.forEach((f) => {
      if (typeof f.confidence !== 'number') return;
      const i = Math.min(9, Math.max(0, Math.floor(f.confidence * 10)));
      bins[i]++;
    });
    return { bins, peak: Math.max(1, ...bins) };
  }, [allFeatures]);

  const classDist = useMemo(() => {
    const byClass = new Map<string, { count: number; color: string; stroke: string }>();
    allFeatures.forEach((f) => {
      if (!f.classId) return;
      const cls = classById.get(f.classId);
      const name = cls?.name ?? 'Unknown';
      const entry = byClass.get(name);
      if (entry) {
        entry.count++;
      } else {
        byClass.set(name, {
          count: 1,
          color: cls?.color ?? '#888',
          stroke: cls?.stroke ?? '#666',
        });
      }
    });
    return Array.from(byClass.entries())
      .map(([name, info]) => ({ name, ...info }))
      .sort((a, b) => b.count - a.count);
  }, [allFeatures, classById]);
  const classDistTotal = classDist.reduce((s, c) => s + c.count, 0);

  const filtersDirty = threshold > 0 || areaMin > 0;
  const loading =
    featureQueries.some((q) => q.isLoading) ||
    setDetailQueries.some((q) => q.isLoading);

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <AnalysisDetailHeader
        title={`Visualization · ${aoiName}`}
        icon={<SlidersHorizontal size={11} />}
        onBack={onBack}
      />

      {!aoiBbox && (
        <p style={{ fontSize: 10, color: MC.textMuted, fontStyle: 'italic', margin: 0 }}>
          Draw an AOI to scope the visualization.
        </p>
      )}

      {/* ── Annotation set list ─────────────────────────────────────────── */}
      <section>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4,
        }}>
          <LayersIcon size={11} color={MC.accent} />
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
            textTransform: 'uppercase', color: MC.sectionLabel,
          }}>
            Annotation sets ({annotationSetLayers.length})
          </span>
        </div>
        {annotationSetLayers.length === 0 ? (
          <p style={{ fontSize: 10, color: MC.textMuted, fontStyle: 'italic', margin: 0 }}>
            No annotation sets are mounted in this AOI yet. Run an inference or mount
            an existing set from the layer library.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {annotationSetLayers.map((layer, i) => (
              <AnnotationSetRow
                key={layer.id}
                layer={layer}
                features={featuresBySet.get(layer.annotationSetId) ?? []}
                schemaName={setDetailQueries[i]?.data?.name ?? layer.name ?? layer.id}
                classById={classById}
                isLoadingFeatures={featureQueries[i]?.isLoading ?? false}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Aggregate visualization ─────────────────────────────────────── */}
      {annotationSetLayers.length > 0 && (
        <section style={{ borderTop: `1px dashed ${MC.border}`, paddingTop: 8 }}>
          <button
            type="button"
            onClick={() => setVizOpen(!vizOpen)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, width: '100%',
              background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 0',
            }}
          >
            {vizOpen
              ? <ChevronDown size={11} color={MC.textMuted} />
              : <ChevronRight size={11} color={MC.textMuted} />}
            <SlidersHorizontal size={11} color={MC.accent} />
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
              textTransform: 'uppercase', color: MC.sectionLabel,
            }}>
              Filters & distribution
            </span>
            <span style={{
              marginLeft: 'auto', fontSize: 9, fontWeight: 600,
              color: MC.textSecondary, background: MC.inputBg ?? '#1e2518',
              border: `1px solid ${MC.border}`, padding: '1px 6px', borderRadius: 8,
            }}>
              {stats.visible}/{stats.total}
            </span>
          </button>

          {vizOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '8px 0' }}>
              {loading && stats.total === 0 && (
                <p style={{ fontSize: 9, color: MC.textMuted, margin: 0 }}>
                  Loading annotation features…
                </p>
              )}

              <Field label="Color mode">
                <div style={{ display: 'flex', gap: 4 }}>
                  {(['class', 'confidence'] as const).map((m) => {
                    const active = colorMode === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setColorMode(m)}
                        style={{
                          flex: 1, padding: '5px 8px', borderRadius: 4,
                          fontSize: 10, fontWeight: 600,
                          background: active ? MC.accent : 'transparent',
                          border: `1px solid ${active ? MC.accent : MC.border}`,
                          color: active ? '#fff' : MC.textSecondary,
                          cursor: 'pointer', textTransform: 'capitalize',
                          transition: 'all 0.12s',
                        }}
                      >
                        By {m}
                      </button>
                    );
                  })}
                </div>
                {colorMode === 'confidence' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                    <div style={{
                      flex: 1, height: 6, borderRadius: 3,
                      background: 'linear-gradient(to right, hsl(0,75%,50%), hsl(60,75%,50%), hsl(120,75%,50%))',
                    }} />
                    <span style={{ fontSize: 8, color: MC.textMuted, whiteSpace: 'nowrap' }}>
                      low → high
                    </span>
                  </div>
                )}
              </Field>

              <Field label={`Confidence ≥ ${threshold.toFixed(2)}`}>
                <input
                  type="range" min={0} max={1} step={0.01}
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  style={{ width: '100%' }}
                />
                <div style={{
                  display: 'flex', justifyContent: 'space-between',
                  fontSize: 8, color: MC.textMuted, marginTop: 2,
                }}>
                  <span>0.00</span><span>0.50</span><span>1.00</span>
                </div>
              </Field>

              {stats.withConf > 0 && (
                <Field label="Distribution">
                  <div style={{
                    display: 'flex', alignItems: 'flex-end', gap: 1, height: 32,
                    padding: 2, border: `1px solid ${MC.border}`,
                    background: MC.inputBg ?? '#1e2518', borderRadius: 4,
                  }}>
                    {histogram.bins.map((count, i) => {
                      const binStart = i / 10;
                      const above = binStart + 0.0999 >= threshold;
                      const h = (count / histogram.peak) * 100;
                      const fill = !above
                        ? MC.border
                        : colorMode === 'confidence'
                          ? confidenceHueColor(binStart + 0.05)
                          : MC.accent;
                      return (
                        <div
                          key={i}
                          title={`[${binStart.toFixed(1)}, ${(binStart + 0.1).toFixed(1)}): ${count}`}
                          style={{
                            flex: 1, height: `${h}%`, minHeight: count > 0 ? 1 : 0,
                            background: fill, borderRadius: 1, transition: 'background 0.15s',
                          }}
                        />
                      );
                    })}
                  </div>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    fontSize: 8, color: MC.textMuted, marginTop: 2,
                  }}>
                    <span>min {stats.minConf.toFixed(2)}</span>
                    <span>max {stats.maxConf.toFixed(2)}</span>
                  </div>
                </Field>
              )}

              {stats.withArea > 0 && (
                <Field label={`Min area ≥ ${formatAreaM2(areaMin)}`}>
                  <input
                    type="range" min={0} max={AREA_SLIDER_MAX} step={1}
                    value={areaToSlider(areaMin, stats.maxArea)}
                    onChange={(e) => setAreaMin(sliderToArea(Number(e.target.value), stats.maxArea))}
                    style={{ width: '100%' }}
                  />
                  <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    fontSize: 8, color: MC.textMuted, marginTop: 2,
                  }}>
                    <span>0</span>
                    <span>{formatAreaM2(stats.maxArea / 4)}</span>
                    <span>{formatAreaM2(stats.maxArea)}</span>
                  </div>
                </Field>
              )}

              {classDist.length > 0 && (
                <Field label={`Class distribution (${classDistTotal})`}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {classDist.map(({ name, count, color, stroke }) => {
                      const pct = classDist[0].count > 0 ? (count / classDist[0].count) * 100 : 0;
                      const sharePct = classDistTotal > 0
                        ? ((count / classDistTotal) * 100).toFixed(0)
                        : '0';
                      return (
                        <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{
                            width: 10, height: 10, borderRadius: 2,
                            background: color, border: `1.5px solid ${stroke}`, flexShrink: 0,
                          }} />
                          <span
                            style={{
                              fontSize: 10, color: MC.text, minWidth: 70, flexShrink: 0,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}
                            title={name}
                          >
                            {name}
                          </span>
                          <div style={{
                            flex: 1, height: 6, borderRadius: 3,
                            background: MC.inputBg ?? '#1e2518', overflow: 'hidden',
                          }}>
                            <div style={{
                              width: `${pct}%`, height: '100%',
                              background: color, transition: 'width 0.2s',
                            }} />
                          </div>
                          <span style={{
                            fontSize: 10, fontWeight: 600, color: MC.text,
                            minWidth: 28, textAlign: 'right', flexShrink: 0,
                          }}>
                            {count}
                          </span>
                          <span style={{
                            fontSize: 8, color: MC.textMuted,
                            minWidth: 26, textAlign: 'right', flexShrink: 0,
                          }}>
                            {sharePct}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </Field>
              )}

              <div style={{
                display: 'flex', justifyContent: 'space-between',
                fontSize: 9, color: MC.textMuted,
              }}>
                <span>{stats.visible} of {stats.total} features above filters</span>
                <button
                  type="button"
                  onClick={() => { setThreshold(0); setAreaMin(0); }}
                  disabled={!filtersDirty}
                  style={{
                    background: 'transparent', border: 'none',
                    color: filtersDirty ? MC.accent : MC.textMuted,
                    fontSize: 9, fontWeight: 600,
                    cursor: filtersDirty ? 'pointer' : 'default',
                    padding: 0, textTransform: 'uppercase', letterSpacing: '0.05em',
                  }}
                >
                  Reset filters
                </button>
              </div>

              <p style={{ fontSize: 8, color: MC.textMuted, margin: 0, lineHeight: 1.4 }}>
                Aggregates across all annotation sets attached to this AOI. The
                confidence/area filters and color mode apply live to the map for
                every set above; per-set visibility is controlled by the eye icon.
              </p>
            </div>
          )}
        </section>
      )}
    </section>
  );
}

// ── Per-annotation-set row ──────────────────────────────────────────────────

interface AnnotationSetRowProps {
  layer: LayerLite;
  features: FeatureSummary[];
  schemaName: string;
  classById: Map<string, { name: string; color: string; stroke: string }>;
  isLoadingFeatures: boolean;
}

function AnnotationSetRow({
  layer, features, schemaName, classById, isLoadingFeatures,
}: AnnotationSetRowProps) {
  const setLayerVisible = useMapLayersStore((s) => s.setLayerVisible);
  const setLayerOpacity = useMapLayersStore((s) => s.setLayerOpacity);
  const removeLayer = useMapLayersStore((s) => s.removeLayer);
  const [expanded, setExpanded] = useState(false);

  const counts = useMemo(() => {
    const byClass = new Map<string, { count: number; color: string }>();
    let withConf = 0;
    let confSum = 0;
    features.forEach((f) => {
      if (typeof f.confidence === 'number') {
        withConf++;
        confSum += f.confidence;
      }
      if (!f.classId) return;
      const cls = classById.get(f.classId);
      const name = cls?.name ?? 'Unknown';
      const e = byClass.get(name);
      if (e) e.count++;
      else byClass.set(name, { count: 1, color: cls?.color ?? '#888' });
    });
    return {
      total: features.length,
      meanConf: withConf > 0 ? confSum / withConf : null,
      byClass: Array.from(byClass.entries())
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.count - a.count),
    };
  }, [features, classById]);

  return (
    <div style={{
      border: `1px solid ${MC.border}`, borderRadius: 5,
      background: 'transparent',
    }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px',
          cursor: 'pointer',
        }}
      >
        {expanded
          ? <ChevronDown size={10} color={MC.textMuted} />
          : <ChevronRight size={10} color={MC.textMuted} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: MC.text,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {layer.name ?? schemaName}
          </div>
          <div style={{
            fontSize: 9, color: MC.textMuted,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {isLoadingFeatures
              ? 'loading…'
              : `${counts.total} feature${counts.total === 1 ? '' : 's'}${
                counts.meanConf != null ? ` · mean conf ${counts.meanConf.toFixed(2)}` : ''
              }`}
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setLayerVisible(layer.id, !layer.visible);
          }}
          title={layer.visible ? 'Hide on map' : 'Show on map'}
          style={iconBtnStyle}
        >
          {layer.visible ? <Eye size={10} /> : <EyeOff size={10} />}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            removeLayer(layer.id);
          }}
          title="Remove from map"
          style={iconBtnStyle}
        >
          <Trash2 size={10} />
        </button>
      </div>

      {expanded && (
        <div style={{
          padding: '6px 10px 8px 10px', borderTop: `1px solid ${MC.border}`,
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <Field label={`Opacity (${Math.round((layer.opacity ?? 1) * 100)}%)`}>
            <input
              type="range" min={0} max={1} step={0.05}
              value={layer.opacity ?? 1}
              onChange={(e) => setLayerOpacity(layer.id, Number(e.target.value))}
              style={{ width: '100%' }}
            />
          </Field>

          {counts.byClass.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {counts.byClass.map(({ name, count, color }) => (
                <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: 2,
                    background: color, flexShrink: 0,
                  }} />
                  <span style={{
                    fontSize: 9, color: MC.text, flex: 1,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }} title={name}>
                    {name}
                  </span>
                  <span style={{
                    fontSize: 9, fontWeight: 600, color: MC.text,
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {count}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

interface FeatureSummary {
  classId: string | undefined;
  confidence: number | undefined;
  /** Polygon area in m². Undefined for non-polygon features (points/lines). */
  areaM2: number | undefined;
}

function intersectsBbox(
  a: [number, number, number, number] | null,
  b: [number, number, number, number],
): boolean {
  if (!a) return true; // unknown bounds → include
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

function confidenceHueColor(c: number): string {
  const hue = Math.max(0, Math.min(1, c)) * 120;
  return `hsl(${hue.toFixed(0)}, 75%, 50%)`;
}

function formatAreaM2(m2: number): string {
  if (!Number.isFinite(m2) || m2 <= 0) return '0 m²';
  if (m2 < 10_000) return `${Math.round(m2).toLocaleString()} m²`;
  const ha = m2 / 10_000;
  return `${ha.toFixed(ha < 10 ? 2 : 1)} ha`;
}

function sliderToArea(sliderVal: number, maxArea: number): number {
  if (maxArea <= 0 || sliderVal <= 0) return 0;
  const t = Math.min(1, sliderVal / AREA_SLIDER_MAX);
  return Math.round(t * t * maxArea);
}

function areaToSlider(areaVal: number, maxArea: number): number {
  if (maxArea <= 0 || areaVal <= 0) return 0;
  return Math.round(Math.sqrt(areaVal / maxArea) * AREA_SLIDER_MAX);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
        textTransform: 'uppercase', color: MC.textMuted,
        display: 'block', marginBottom: 3,
      }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const iconBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 4, borderRadius: 3,
  background: 'transparent', border: `1px solid ${MC.border}`,
  color: MC.textSecondary, cursor: 'pointer', flexShrink: 0,
};
