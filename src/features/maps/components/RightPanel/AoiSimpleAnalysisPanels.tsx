'use client';

import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Play, Loader2, Activity, BarChart3, Layers, GitCompare, ChevronDown,
} from 'lucide-react';
import { analysisApi } from '@/lib/api/analysis';
import { mapAoisApi } from '@/lib/api/map-aois';
import { refreshAuthToken } from '@/lib/api/client';
import { useMapLayersStore } from '@/stores/mapLayersStore';
import type { GeoJSONGeometry } from '@/types/geo';
import type { BandInfo, Dataset } from '@/types/api';
import { MC } from '../../mapColors';
import { AnalysisDetailHeader } from './AnalysisDetailHeader';
import {
  SPECTRAL_INDICES,
  getIndexDef,
  defaultBandsForIndex,
  rampGradient,
  type IndexRole,
} from '../../modules/timeline/indices';

interface CommonProps {
  aoiLayerId: string;
  mapId?: string;
  backendAoiId?: string;
  geometry: GeoJSONGeometry | undefined;
  selectedDatasets: Dataset[];
  onEnsureAoi: () => Promise<string>;
  onBack: () => void;
}

// ── Temporal Playback ───────────────────────────────────────────────────────

interface TemporalProps extends CommonProps {
  aoiBbox: [number, number, number, number] | undefined;
}

function bandLabel(band: BandInfo): string {
  if (band.spectral_name) return `${band.index}: ${band.spectral_name}`;
  if (band.description) return `${band.index}: ${band.description}`;
  return `Band ${band.index}`;
}

export function AoiTemporalPanel({
  aoiLayerId, aoiBbox, mapId, backendAoiId, selectedDatasets, onEnsureAoi, onBack,
}: TemporalProps) {
  const aoiSelectedDatasetIds = selectedDatasets.map((d) => d.id);

  // Bands come from the first selected dataset's rendering config — the same
  // source band-selection uses, so NDVI offers the identical band list.
  const bands = useMemo(
    () => selectedDatasets[0]?.metadata?.rendering_config?.bands ?? [],
    [selectedDatasets],
  );

  // Indices whose every band role can be auto-resolved from this dataset.
  const supportedIndices = useMemo(
    () => SPECTRAL_INDICES.filter((d) => defaultBandsForIndex(d, bands) != null),
    [bands],
  );

  // null = plain RGB; otherwise an index id from the registry.
  const [indexId, setIndexId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Partial<Record<IndexRole, number>>>({});
  const [threshold, setThreshold] = useState<number | null>(null);

  const indexDef = getIndexDef(indexId);
  const autoBands = useMemo(
    () => (indexDef ? defaultBandsForIndex(indexDef, bands) : null),
    [indexDef, bands],
  );

  // Auto-detected roles, with any manual picker overrides applied.
  const resolvedBands = useMemo(() => {
    if (!indexDef || !autoBands) return null;
    const out: Record<string, number> = { ...autoBands };
    for (const role of indexDef.roles) {
      const o = overrides[role];
      if (o != null) out[role] = o;
    }
    return out;
  }, [indexDef, autoBands, overrides]);

  const handleIndexChange = (id: string | null) => {
    setIndexId(id);
    setOverrides({});
    setThreshold(null);
  };

  const temporalMut = useMutation({
    mutationFn: async () => {
      if (!mapId) throw new Error('Map not available');
      if (!aoiBbox) throw new Error('AOI bbox missing');
      if (aoiSelectedDatasetIds.length === 0) throw new Error('Select at least one dataset');

      const aoiId = backendAoiId ?? (await onEnsureAoi());
      if (!aoiId) throw new Error('AOI could not be saved');

      try {
        await mapAoisApi.updateSelection(mapId, aoiId, {
          dataset_ids: aoiSelectedDatasetIds,
          dataset_item_ids: [],
        });
      } catch {
        // best-effort
      }

      await refreshAuthToken();
      const manifest = await mapAoisApi.prepareTimeline(mapId, aoiId);
      const tileJson = await mapAoisApi.getTileJSON(mapId, aoiId, { assets: 'data' });
      return { manifest, tileJson, backendAoiId: aoiId };
    },
    onSuccess: ({ manifest, tileJson, backendAoiId }) => {
      const collectionMap: Record<string, string> = {};
      selectedDatasets.forEach((ds) => {
        if (ds.stac_collection_id) collectionMap[ds.id] = ds.stac_collection_id;
      });
      const store = useMapLayersStore.getState();
      store.openAoiTimeline(
        aoiLayerId,
        aoiSelectedDatasetIds,
        collectionMap,
        indexDef && resolvedBands
          ? { renderMode: 'index', indexId: indexDef.id, indexBands: resolvedBands, threshold }
          : { renderMode: 'rgb' },
      );
      if (typeof window !== 'undefined') {
        sessionStorage.setItem(`aoi-tilejson-${backendAoiId}`, JSON.stringify(tileJson));
      }
      toast.success(
        indexDef
          ? `${manifest.frame_count} frames ready (${indexDef.label})`
          : `${manifest.frame_count} frames ready for playback`,
      );
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to prepare temporal analysis');
    },
  });

  return (
    <section>
      <AnalysisDetailHeader title="Temporal Playback" icon={<Play size={11} />} onBack={onBack} />
      <p style={{ fontSize: 11, color: MC.textMuted, padding: '6px 0 8px', margin: 0 }}>
        Play through dataset items in temporal sequence. Uses the selected datasets on this AOI.
      </p>

      {/* ── Spectral index dropdown ── */}
      <div style={{ marginBottom: 10 }}>
        <div style={{
          fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
          textTransform: 'uppercase', color: MC.textMuted, marginBottom: 4,
        }}>
          Index
        </div>
        <div style={{ position: 'relative' }}>
          <select
            value={indexId ?? 'rgb'}
            onChange={(e) => handleIndexChange(e.target.value === 'rgb' ? null : e.target.value)}
            style={{
              width: '100%', height: 28, fontSize: 11, padding: '0 22px 0 8px',
              borderRadius: 4, border: `1px solid ${MC.border}`,
              background: MC.inputBg, color: MC.text, cursor: 'pointer',
              appearance: 'none', outline: 'none',
            }}
          >
            <option value="rgb">RGB (true colour)</option>
            {supportedIndices.map((d) => (
              <option key={d.id} value={d.id}>{d.label} — {d.description}</option>
            ))}
          </select>
          <ChevronDown
            size={10}
            style={{
              position: 'absolute', right: 7, top: '50%',
              transform: 'translateY(-50%)', color: MC.textMuted, pointerEvents: 'none',
            }}
          />
        </div>
        {indexId && supportedIndices.length === 0 && (
          <p style={{ fontSize: 9, color: MC.textMuted, margin: '4px 0 0' }}>
            This dataset has no bands with the spectral metadata these indices need.
          </p>
        )}
      </div>

      {/* ── Per-role band pickers ── */}
      {indexDef && resolvedBands && (
        <div style={{ marginBottom: 10 }}>
          {indexDef.roles.map((role) => (
            <NdviBandRow
              key={role}
              label={ROLE_LABELS[role]}
              bands={bands}
              value={resolvedBands[role]}
              onChange={(idx) => setOverrides((o) => ({ ...o, [role]: idx }))}
            />
          ))}

          {/* Colour legend + live threshold marker */}
          <IndexLegend def={indexDef} threshold={threshold} />

          {/* Threshold slider (single lower bound, transparent below) */}
          <ThresholdSlider def={indexDef} threshold={threshold} onChange={setThreshold} />
        </div>
      )}

      <button
        onClick={() => temporalMut.mutate()}
        disabled={temporalMut.isPending || aoiSelectedDatasetIds.length === 0 || !mapId}
        style={runBtnStyle(temporalMut.isPending)}
      >
        {temporalMut.isPending ? (
          <><Loader2 size={11} className="animate-spin" /> Preparing…</>
        ) : (
          <><Play size={11} /> Start Playback{indexDef ? ` (${indexDef.label})` : ''}</>
        )}
      </button>
    </section>
  );
}

function NdviBandRow({
  label, bands, value, onChange,
}: {
  label: string;
  bands: BandInfo[];
  value: number;
  onChange: (index: number) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
      <span style={{ width: 28, fontSize: 10, fontWeight: 700, color: MC.textSecondary, flexShrink: 0 }}>
        {label}
      </span>
      <div style={{ position: 'relative', flex: 1 }}>
        <select
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{
            width: '100%', height: 26, fontSize: 11, padding: '0 20px 0 8px',
            borderRadius: 4, border: `1px solid ${MC.border}`,
            background: MC.inputBg, color: MC.text, cursor: 'pointer',
            appearance: 'none', outline: 'none',
          }}
        >
          {bands.map((b) => (
            <option key={b.index} value={b.index}>{bandLabel(b)}</option>
          ))}
        </select>
        <ChevronDown
          size={10}
          style={{
            position: 'absolute', right: 6, top: '50%',
            transform: 'translateY(-50%)', color: MC.textMuted, pointerEvents: 'none',
          }}
        />
      </div>
    </div>
  );
}

const ROLE_LABELS: Record<IndexRole, string> = {
  nir: 'NIR',
  red: 'Red',
  green: 'Green',
  blue: 'Blue',
  red_edge: 'RedEdge',
  swir1: 'SWIR1',
  swir2: 'SWIR2',
};

/** Colour ramp legend with low/high meaning + a marker at the threshold. */
function IndexLegend({
  def, threshold,
}: {
  def: (typeof SPECTRAL_INDICES)[number];
  threshold: number | null;
}) {
  const [dmin, dmax] = def.domain;
  const markerPct =
    threshold == null ? null : ((threshold - dmin) / (dmax - dmin || 1)) * 100;
  return (
    <div style={{ margin: '8px 0 4px' }}>
      <div style={{ position: 'relative', height: 10, borderRadius: 2, background: rampGradient(def.ramp) }}>
        {markerPct != null && (
          <>
            {/* Transparent (hidden) portion overlay below threshold */}
            <div style={{
              position: 'absolute', top: 0, left: 0, bottom: 0,
              width: `${Math.max(0, Math.min(100, markerPct))}%`,
              background: MC.panelBg, opacity: 0.6, borderRadius: '2px 0 0 2px',
            }} />
            <div style={{
              position: 'absolute', top: -2, bottom: -2,
              left: `${Math.max(0, Math.min(100, markerPct))}%`,
              width: 2, background: MC.text, transform: 'translateX(-1px)',
            }} />
          </>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
        <span style={{ fontSize: 8, color: MC.textMuted }}>{def.legendLow}</span>
        <span style={{ fontSize: 8, color: MC.textMuted }}>{def.legendHigh}</span>
      </div>
    </div>
  );
}

/** Single lower-bound threshold slider; pixels below render transparent. */
function ThresholdSlider({
  def, threshold, onChange,
}: {
  def: (typeof SPECTRAL_INDICES)[number];
  threshold: number | null;
  onChange: (t: number | null) => void;
}) {
  const [dmin, dmax] = def.domain;
  const enabled = threshold != null;
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: MC.textSecondary, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onChange(e.target.checked ? roundTo((dmin + dmax) / 2) : null)}
            style={{ accentColor: MC.accent, cursor: 'pointer' }}
          />
          Threshold
        </label>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: enabled ? MC.accent : MC.textMuted, fontVariantNumeric: 'tabular-nums' }}>
          {enabled ? `≥ ${threshold!.toFixed(2)}` : 'off'}
        </span>
      </div>
      <input
        type="range"
        min={dmin}
        max={dmax}
        step={0.01}
        value={threshold ?? dmin}
        disabled={!enabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: MC.accent, opacity: enabled ? 1 : 0.4, cursor: enabled ? 'pointer' : 'not-allowed' }}
      />
      {enabled && (
        <p style={{ fontSize: 9, color: MC.textMuted, margin: '2px 0 0' }}>
          Showing only pixels with {def.label} ≥ {threshold!.toFixed(2)} ({def.legendHigh.toLowerCase()}); below is transparent.
        </p>
      )}
    </div>
  );
}

function roundTo(v: number): number {
  return Math.round(v * 100) / 100;
}

// ── NDVI ────────────────────────────────────────────────────────────────────

export function AoiNdviPanel({ geometry, selectedDatasets, onBack }: CommonProps) {
  const mut = useMutation({
    mutationFn: () => {
      const dsId = selectedDatasets[0]?.id;
      if (!dsId || !geometry) throw new Error('No dataset or geometry');
      return analysisApi.runNdvi({ dataset_id: dsId, aoi_geometry: geometry });
    },
    onSuccess: () => toast.success('NDVI analysis started'),
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to start NDVI'),
  });

  return (
    <section>
      <AnalysisDetailHeader title="NDVI" icon={<Activity size={11} />} onBack={onBack} />
      <p style={{ fontSize: 11, color: MC.textMuted, padding: '6px 0 8px', margin: 0 }}>
        Normalized Difference Vegetation Index over the AOI on the first selected dataset
        {selectedDatasets[0] ? ` (${selectedDatasets[0].name})` : ''}.
      </p>
      <button
        onClick={() => mut.mutate()}
        disabled={mut.isPending || !selectedDatasets[0] || !geometry}
        style={runBtnStyle(mut.isPending)}
      >
        {mut.isPending ? (
          <><Loader2 size={11} className="animate-spin" /> Starting…</>
        ) : (
          <><Activity size={11} /> Run NDVI</>
        )}
      </button>
    </section>
  );
}

// ── Area Statistics ─────────────────────────────────────────────────────────

export function AoiAreaStatsPanel({ geometry, selectedDatasets, onBack }: CommonProps) {
  const mut = useMutation({
    mutationFn: () => {
      const dsId = selectedDatasets[0]?.id;
      if (!dsId || !geometry) throw new Error('No dataset or geometry');
      return analysisApi.runAreaStats({ dataset_id: dsId, aoi_geometry: geometry });
    },
    onSuccess: () => toast.success('Area statistics started'),
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to start area stats'),
  });

  return (
    <section>
      <AnalysisDetailHeader title="Area Statistics" icon={<BarChart3 size={11} />} onBack={onBack} />
      <p style={{ fontSize: 11, color: MC.textMuted, padding: '6px 0 8px', margin: 0 }}>
        Pixel and area distribution across the AOI for the first selected dataset
        {selectedDatasets[0] ? ` (${selectedDatasets[0].name})` : ''}.
      </p>
      <button
        onClick={() => mut.mutate()}
        disabled={mut.isPending || !selectedDatasets[0] || !geometry}
        style={runBtnStyle(mut.isPending)}
      >
        {mut.isPending ? (
          <><Loader2 size={11} className="animate-spin" /> Starting…</>
        ) : (
          <><BarChart3 size={11} /> Run Area Stats</>
        )}
      </button>
    </section>
  );
}

// ── Composite ───────────────────────────────────────────────────────────────

export function AoiCompositePanel({ geometry, selectedDatasets, onBack }: CommonProps) {
  const mut = useMutation({
    mutationFn: () => {
      if (!geometry || selectedDatasets.length === 0) throw new Error('No datasets');
      return analysisApi.runComposite({
        dataset_ids: selectedDatasets.map((d) => d.id),
        aoi_geometry: geometry,
      });
    },
    onSuccess: () => toast.success('Composite analysis started'),
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to start composite'),
  });

  return (
    <section>
      <AnalysisDetailHeader title="Composite" icon={<Layers size={11} />} onBack={onBack} />
      <p style={{ fontSize: 11, color: MC.textMuted, padding: '6px 0 8px', margin: 0 }}>
        Cloudless mosaic across {selectedDatasets.length} selected dataset
        {selectedDatasets.length === 1 ? '' : 's'}.
      </p>
      <button
        onClick={() => mut.mutate()}
        disabled={mut.isPending || selectedDatasets.length === 0 || !geometry}
        style={runBtnStyle(mut.isPending)}
      >
        {mut.isPending ? (
          <><Loader2 size={11} className="animate-spin" /> Starting…</>
        ) : (
          <><Layers size={11} /> Run Composite</>
        )}
      </button>
    </section>
  );
}

// ── Change Detection ────────────────────────────────────────────────────────

export function AoiChangeDetectionPanel({ geometry, selectedDatasets, onBack }: CommonProps) {
  const mut = useMutation({
    mutationFn: () => {
      const dsId = selectedDatasets[0]?.id;
      if (!dsId || !geometry) throw new Error('No dataset or geometry');
      return analysisApi.runChangeDetection({
        dataset_id: dsId,
        reference_date: new Date(Date.now() - 30 * 86400000).toISOString(),
        target_date: new Date().toISOString(),
        aoi_geometry: geometry,
      });
    },
    onSuccess: () => toast.success('Change detection started'),
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to start change detection'),
  });

  return (
    <section>
      <AnalysisDetailHeader title="Change Detection" icon={<GitCompare size={11} />} onBack={onBack} />
      <p style={{ fontSize: 11, color: MC.textMuted, padding: '6px 0 8px', margin: 0 }}>
        Compare the last 30 days against the prior 30 days for
        {selectedDatasets[0] ? ` ${selectedDatasets[0].name}` : ' the first selected dataset'}.
      </p>
      <button
        onClick={() => mut.mutate()}
        disabled={mut.isPending || !selectedDatasets[0] || !geometry}
        style={runBtnStyle(mut.isPending)}
      >
        {mut.isPending ? (
          <><Loader2 size={11} className="animate-spin" /> Starting…</>
        ) : (
          <><GitCompare size={11} /> Run Change Detection</>
        )}
      </button>
    </section>
  );
}

// ── Shared button style ─────────────────────────────────────────────────────

function runBtnStyle(loading: boolean): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    padding: '8px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600,
    border: `1px solid ${MC.accent}`,
    background: 'transparent',
    color: MC.text,
    cursor: loading ? 'wait' : 'pointer',
    opacity: loading ? 0.6 : 1,
    transition: 'all 0.12s',
    width: '100%',
  };
}

