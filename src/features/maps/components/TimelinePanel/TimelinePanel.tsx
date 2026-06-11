'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  X,
  Calendar,
  Settings2,
} from 'lucide-react';
import { useMapLayersStore } from '@/stores/mapLayersStore';
import { MC, MAP_Z } from '../../mapColors';
import { getIndexDef } from '../../modules/timeline/indices';

const SPEED_OPTIONS = [
  { label: '0.5x', value: 4000 },
  { label: '1x', value: 2000 },
  { label: '2x', value: 1000 },
  { label: '4x', value: 500 },
] as const;

// ── Dataset colors for multi-dataset AOI timeline dots ──────────────────────
const DATASET_COLORS = [
  '#5c8ce0', '#6bcc6b', '#e05c5c', '#c4985c', '#8a7eb8',
  '#e6a23c', '#4ecdc4', '#ff6b9d', '#95e1d3', '#f38181',
];

function fmtDate(iso: string | undefined, includeTime = false): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', includeTime
    ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }
    : { day: 'numeric', month: 'short', year: 'numeric' });
}

export function TimelinePanel() {
  // ── Single-dataset timeline state ─────────────────────────────────────────
  const singleEnabled = useMapLayersStore((s) => s.timelineEnabled);
  const singleDatasetId = useMapLayersStore((s) => s.timelineDatasetId);
  const singleItems = useMapLayersStore((s) => s.timelineItems);
  const singleIndex = useMapLayersStore((s) => s.timelineIndex);
  const singlePlaying = useMapLayersStore((s) => s.timelinePlaying);
  const singleSpeed = useMapLayersStore((s) => s.timelineSpeed);
  const singleRange = useMapLayersStore((s) => s.timelineRange);
  const layers = useMapLayersStore((s) => s.layers);

  // ── AOI timeline state ────────────────────────────────────────────────────
  const aoiEnabled = useMapLayersStore((s) => s.aoiTimelineEnabled);
  const aoiAoiId = useMapLayersStore((s) => s.aoiTimelineAoiId);
  const aoiDatasetIds = useMapLayersStore((s) => s.aoiTimelineDatasetIds);
  const aoiFrames = useMapLayersStore((s) => s.aoiTimelineFrames);
  const aoiIndex = useMapLayersStore((s) => s.aoiTimelineIndex);
  const aoiPlaying = useMapLayersStore((s) => s.aoiTimelinePlaying);
  const aoiSpeed = useMapLayersStore((s) => s.aoiTimelineSpeed);
  const aoiRange = useMapLayersStore((s) => s.aoiTimelineRange);
  const aoiShowAnnotations = useMapLayersStore((s) => s.aoiTimelineShowAnnotations);
  const aoiIndexId = useMapLayersStore((s) => s.aoiTimelineIndexId);
  const aoiThreshold = useMapLayersStore((s) => s.aoiTimelineThreshold);

  // ── Determine active mode ─────────────────────────────────────────────────
  const isAoiMode = aoiEnabled;
  const aoiLoading = aoiEnabled && aoiFrames.length === 0;
  const isSingleMode = singleEnabled && !isAoiMode;
  const enabled = isAoiMode || isSingleMode;

  // ── Unified accessors ─────────────────────────────────────────────────────
  const playing = isAoiMode ? aoiPlaying : singlePlaying;
  const speed = isAoiMode ? aoiSpeed : singleSpeed;
  const range = isAoiMode ? aoiRange : singleRange;
  const index = isAoiMode ? aoiIndex : singleIndex;

  // Build unified item list with datetime for dot positions
  const items = useMemo(() => {
    if (isAoiMode) {
      return aoiFrames.map((f) => ({ id: f.datetime, datetime: f.datetime }));
    }
    return singleItems.map((it) => ({ id: it.id, datetime: it.datetime }));
  }, [isAoiMode, aoiFrames, singleItems]);

  const totalCount = items.length;

  // Panel title
  const panelName = useMemo(() => {
    if (isAoiMode) {
      const aoiLayer = aoiAoiId ? layers[aoiAoiId] : null;
      return aoiLayer?.name ?? 'AOI Timeline';
    }
    if (singleDatasetId && layers[singleDatasetId]) {
      return layers[singleDatasetId].name || 'Timeline';
    }
    return 'Timeline';
  }, [isAoiMode, aoiAoiId, singleDatasetId, layers]);

  // ── Actions (dispatch to correct store slice) ─────────────────────────────
  const step = useCallback((dir: 'next' | 'prev') => {
    if (isAoiMode) useMapLayersStore.getState().stepAoiTimeline(dir);
    else useMapLayersStore.getState().stepTimeline(dir);
  }, [isAoiMode]);

  const setIndex = useCallback((i: number) => {
    if (isAoiMode) useMapLayersStore.getState().setAoiTimelineIndex(i);
    else useMapLayersStore.getState().setTimelineIndex(i);
  }, [isAoiMode]);

  const togglePlay = useCallback(() => {
    if (isAoiMode) useMapLayersStore.getState().toggleAoiTimelinePlay();
    else useMapLayersStore.getState().toggleTimelinePlay();
  }, [isAoiMode]);

  const setSpeed = useCallback((ms: number) => {
    if (isAoiMode) useMapLayersStore.getState().setAoiTimelineSpeed(ms);
    else useMapLayersStore.getState().setTimelineSpeed(ms);
  }, [isAoiMode]);

  const setRange = useCallback((r: [string, string] | null) => {
    if (isAoiMode) useMapLayersStore.getState().setAoiTimelineRange(r);
    else useMapLayersStore.getState().setTimelineRange(r);
  }, [isAoiMode]);

  const close = useCallback(() => {
    if (isAoiMode) useMapLayersStore.getState().closeAoiTimeline();
    else useMapLayersStore.getState().closeTimeline();
  }, [isAoiMode]);

  const trackRef = useRef<HTMLDivElement>(null);
  const [showFilters, setShowFilters] = useState(false);

  // ── Filter items by date range ──────────────────────────────────────────────
  const filteredItems = useMemo(() => {
    if (!range) return items;
    return items.filter((item) => {
      if (!item.datetime) return true;
      const d = new Date(item.datetime).getTime();
      const [from, to] = range;
      if (from && d < new Date(from).getTime()) return false;
      if (to && d > new Date(to + 'T23:59:59').getTime()) return false;
      return true;
    });
  }, [items, range]);

  // ── Auto-play timer ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!playing || filteredItems.length < 2) return;
    const timer = setInterval(() => step('next'), speed);
    return () => clearInterval(timer);
  }, [playing, speed, filteredItems.length, step]);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); togglePlay(); }
      if (e.key === 'ArrowRight' || e.key === 'l') { e.preventDefault(); step('next'); }
      if (e.key === 'ArrowLeft' || e.key === 'j') { e.preventDefault(); step('prev'); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled, togglePlay, step]);

  // ── Timeline axis geometry ──────────────────────────────────────────────────
  const timeExtent = useMemo(() => {
    const dates = filteredItems
      .map((it) => (it.datetime ? new Date(it.datetime).getTime() : null))
      .filter((d): d is number => d !== null);
    if (dates.length === 0) return null;
    const min = Math.min(...dates);
    const max = Math.max(...dates);
    const range = max - min;
    const minPad = isAoiMode ? 1000 : 86400000;
    const pad = Math.max(range * 0.05, minPad);
    return { min: min - pad, max: max + pad, span: max - min + 2 * pad };
  }, [filteredItems, isAoiMode]);

  const dotPositions = useMemo(() => {
    if (!timeExtent || timeExtent.span === 0) return [];
    return items.map((item) => {
      if (!item.datetime) return 0;
      const t = new Date(item.datetime).getTime();
      const pct = ((t - timeExtent.min) / timeExtent.span) * 100;
      return Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0;
    });
  }, [items, timeExtent]);

  const visibleDotPositions = useMemo(() => {
    if (dotPositions.length <= 1) return dotPositions;
    const adjusted: number[] = [];
    const minGap = 1.5; // ensure dots are visually separable for sub-second/second differences
    for (let i = 0; i < dotPositions.length; i++) {
      const raw = dotPositions[i] ?? 0;
      if (i === 0) {
        adjusted.push(raw);
        continue;
      }
      const prev = adjusted[i - 1] ?? raw;
      adjusted.push(raw <= prev ? Math.min(prev + minGap, 100) : raw);
    }
    return adjusted;
  }, [dotPositions]);

  const currentItem = items[index] ?? null;
  const currentPct = visibleDotPositions[index] ?? 0;

  // ── AOI mode: map dataset IDs to colors ─────────────────────────────────────
  const datasetColorMap = useMemo(() => {
    if (!isAoiMode) return new Map<string, string>();
    const map = new Map<string, string>();
    aoiDatasetIds.forEach((dsId, i) => {
      map.set(dsId, DATASET_COLORS[i % DATASET_COLORS.length]);
    });
    return map;
  }, [isAoiMode, aoiDatasetIds]);

  // ── Click on track to jump ──────────────────────────────────────────────────
  const handleTrackClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!trackRef.current || !timeExtent || items.length === 0) return;
      const rect = trackRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      let closest = 0;
      let closestDist = Infinity;
      visibleDotPositions.forEach((pos, i) => {
        const dist = Math.abs(pos - pct);
        if (dist < closestDist) { closestDist = dist; closest = i; }
      });
      setIndex(closest);
    },
    [timeExtent, items, visibleDotPositions, setIndex],
  );

  // ── Tick marks ──────────────────────────────────────────────────────────────
  const ticks = useMemo(() => {
    if (!timeExtent) return [];
    const count = Math.min(5, filteredItems.length);
    if (count <= 1) return [];
    const tickStep = timeExtent.span / count;
    const result: { pct: number; label: string }[] = [];
    for (let i = 1; i < count; i++) {
      const t = timeExtent.min + tickStep * i;
      const pct = (tickStep * i) / timeExtent.span * 100;
      const d = new Date(t);
      result.push({
        pct,
        label: timeExtent.span < 2 * 86400000
          ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
          : d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
      });
    }
    return result;
  }, [timeExtent, filteredItems.length]);

  if (!enabled) return null;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{
      position: 'absolute',
      bottom: 24,
      left: '50%',
      transform: 'translateX(-50%)',
      width: isAoiMode ? 'min(560px, calc(100% - 360px))' : 'min(480px, calc(100% - 360px))',
      zIndex: MAP_Z.overlay,
      pointerEvents: 'auto',
    }}>
      <div style={{
        background: MC.navBg,
        borderRadius: 12,
        boxShadow: MC.shadowLg,
        border: `1px solid ${MC.navBorder}`,
        overflow: 'hidden',
      }}>
        {/* ── Header ── */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          padding: '8px 12px',
          gap: 8,
          borderBottom: `1px solid ${MC.navBorder}`,
        }}>
          <span style={{
            fontSize: 11, fontWeight: 600, color: MC.navText,
            flex: 1, overflow: 'hidden', textOverflow: 'ellipsis',
            whiteSpace: 'nowrap', maxWidth: 160,
          }}>
            {panelName}
          </span>

          <span style={{ fontSize: 11, color: MC.navAccent, fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>
            {fmtDate(currentItem?.datetime, isAoiMode)}
          </span>

          <span style={{ fontSize: 10, color: MC.navTextMuted, fontVariantNumeric: 'tabular-nums' }}>
            {index + 1}/{totalCount}
          </span>

          <button
            onClick={() => setShowFilters(!showFilters)}
            style={{ ...iconBtnStyle, background: showFilters ? MC.navActiveBtn : 'transparent', color: showFilters ? MC.navAccent : MC.navText }}
            title="Date filters & settings"
          >
            <Settings2 size={12} />
          </button>

          <button onClick={close} style={iconBtnStyle} title="Close timeline">
            <X size={14} />
          </button>
        </div>

        {/* ── Filter row ── */}
        {showFilters && (
          <div style={{
            display: 'flex', alignItems: 'center', padding: '6px 12px', gap: 8,
            borderBottom: `1px solid ${MC.navBorder}`, background: 'rgba(0,0,0,0.15)',
          }}>
            <Calendar size={10} color={MC.navTextMuted} />
            <input
              type="date"
              value={range?.[0] ?? ''}
              onChange={(e) => setRange([e.target.value, range?.[1] ?? ''])}
              style={dateInputStyle}
              title="From date"
            />
            <span style={{ fontSize: 10, color: MC.navTextMuted }}>→</span>
            <input
              type="date"
              value={range?.[1] ?? ''}
              onChange={(e) => setRange([range?.[0] ?? '', e.target.value])}
              style={dateInputStyle}
              title="To date"
            />
            {range && (
              <button onClick={() => setRange(null)} style={{ ...iconBtnStyle, width: 16, height: 16 }} title="Clear filter">
                <X size={10} />
              </button>
            )}
            <div style={{ flex: 1 }} />
            {isAoiMode && (
              <label
                style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: MC.navTextMuted, cursor: 'pointer' }}
                title="Show annotation sets during playback (off = raster only)"
              >
                <input
                  type="checkbox"
                  checked={aoiShowAnnotations}
                  onChange={(e) => useMapLayersStore.getState().setAoiTimelineShowAnnotations(e.target.checked)}
                  style={{ accentColor: MC.navAccent, cursor: 'pointer' }}
                />
                Annotations
              </label>
            )}
            <span style={{ fontSize: 9, color: MC.navTextMuted }}>Speed:</span>
            <select
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              style={{
                fontSize: 10, padding: '2px 4px', background: MC.navBg,
                color: MC.navText, border: `1px solid ${MC.navBorder}`,
                borderRadius: 3, cursor: 'pointer',
              }}
            >
              {SPEED_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* ── Live index threshold (AOI index mode) ── */}
        {showFilters && isAoiMode && aoiIndexId && (() => {
          const def = getIndexDef(aoiIndexId);
          if (!def) return null;
          const [dmin, dmax] = def.domain;
          const enabled = aoiThreshold != null;
          const setThreshold = useMapLayersStore.getState().setAoiTimelineThreshold;
          return (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
              borderBottom: `1px solid ${MC.navBorder}`, background: 'rgba(0,0,0,0.15)',
            }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: MC.navTextMuted, cursor: 'pointer', flexShrink: 0 }}>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setThreshold(e.target.checked ? Math.round(((dmin + dmax) / 2) * 100) / 100 : null)}
                  style={{ accentColor: MC.navAccent, cursor: 'pointer' }}
                />
                {def.label} ≥
              </label>
              <input
                type="range"
                min={dmin}
                max={dmax}
                step={0.01}
                value={aoiThreshold ?? dmin}
                disabled={!enabled}
                onChange={(e) => setThreshold(Number(e.target.value))}
                style={{ flex: 1, accentColor: MC.navAccent, opacity: enabled ? 1 : 0.4, cursor: enabled ? 'pointer' : 'not-allowed' }}
              />
              <span style={{ fontSize: 10, color: enabled ? MC.navAccent : MC.navTextMuted, fontVariantNumeric: 'tabular-nums', width: 32, textAlign: 'right' }}>
                {enabled ? aoiThreshold!.toFixed(2) : 'off'}
              </span>
            </div>
          );
        })()}

        {/* ── AOI loading state ── */}
        {aoiLoading && (
          <div style={{ padding: '16px 12px', textAlign: 'center' }}>
            <span style={{ fontSize: 11, color: MC.navTextMuted }}>Loading dataset items…</span>
          </div>
        )}

        {/* ── AOI dataset legend ── */}
        {isAoiMode && !aoiLoading && aoiDatasetIds.length > 1 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '4px 12px',
            borderBottom: `1px solid ${MC.navBorder}`, flexWrap: 'wrap',
          }}>
            {aoiDatasetIds.map((dsId) => {
              const dsLayer = layers[dsId];
              const color = datasetColorMap.get(dsId) ?? MC.navText;
              return (
                <div key={dsId} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
                  <span style={{ fontSize: 9, color: MC.navTextMuted, maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {dsLayer?.name ?? dsId.slice(0, 8)}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Transport + scrubber ── */}
        {!aoiLoading && <div style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', gap: 10 }}>
          <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
            <button onClick={() => step('prev')} style={transportBtnStyle} title="Previous (←)">
              <SkipBack size={12} />
            </button>
            <button
              onClick={togglePlay}
              style={{
                ...transportBtnStyle,
                width: 32, height: 32, borderRadius: '50%',
                background: playing ? MC.navAccent : 'transparent',
                color: playing ? MC.navBg : MC.navText,
                border: `1px solid ${playing ? MC.navAccent : MC.navBorder}`,
              }}
              title={playing ? 'Pause (Space)' : 'Play (Space)'}
            >
              {playing ? <Pause size={12} /> : <Play size={12} style={{ marginLeft: 1 }} />}
            </button>
            <button onClick={() => step('next')} style={transportBtnStyle} title="Next (→)">
              <SkipForward size={12} />
            </button>
          </div>

          {/* Track */}
          <div
            ref={trackRef}
            onClick={handleTrackClick}
            style={{ flex: 1, height: 32, position: 'relative', cursor: 'pointer', userSelect: 'none' }}
          >
            {/* Track line */}
            <div style={{ position: 'absolute', top: 11, left: 0, right: 0, height: 2, background: MC.navBorder, borderRadius: 1 }} />

            {/* Progress fill */}
            <div style={{
              position: 'absolute', top: 11, left: 0, width: `${currentPct}%`, height: 2,
              background: MC.navAccent, borderRadius: 1,
              transition: playing ? 'none' : 'width 0.15s ease',
            }} />

            {/* Item dots */}
            {items.map((item, i) => {
              const pct = visibleDotPositions[i] ?? 0;
              const isActive = i === index;
              const isFiltered = filteredItems.includes(item);

              // In AOI mode, color dots by their primary dataset
              let dotColor: string = isActive ? MC.navAccent : isFiltered ? MC.navText : MC.navBorder;
              if (isAoiMode && !isActive && isFiltered) {
                const frame = aoiFrames[i];
                if (frame?.items[0]) {
                  dotColor = datasetColorMap.get(frame.items[0].datasetId) ?? MC.navText;
                }
              }

              return (
                <div
                  key={`${item.id}-${i}`}
                  onClick={(e) => { e.stopPropagation(); setIndex(i); }}
                    title={fmtDate(item.datetime, isAoiMode)}
                  style={{
                    position: 'absolute',
                    left: `${pct}%`,
                    top: isActive ? 7 : 9,
                    width: isActive ? 10 : 6,
                    height: isActive ? 10 : 6,
                    borderRadius: '50%',
                    background: dotColor,
                    opacity: isFiltered ? 1 : 0.3,
                    border: isActive ? `2px solid ${MC.navBg}` : 'none',
                    boxShadow: isActive ? `0 0 0 2px ${MC.navAccent}` : 'none',
                    transform: 'translateX(-50%)',
                    cursor: 'pointer',
                    transition: playing ? 'none' : 'all 0.12s ease',
                    zIndex: isActive ? 2 : 1,
                  }}
                />
              );
            })}

            {/* Tick labels */}
            {ticks.map((tick) => (
              <span
                key={tick.pct}
                style={{
                  position: 'absolute', left: `${tick.pct}%`, top: 18,
                  transform: 'translateX(-50%)', fontSize: 8,
                  color: MC.navTextMuted, whiteSpace: 'nowrap', pointerEvents: 'none',
                }}
              >
                {tick.label}
              </span>
            ))}
          </div>
        </div>}
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const iconBtnStyle: React.CSSProperties = {
  width: 22, height: 22,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent', border: 'none', color: MC.navText,
  cursor: 'pointer', borderRadius: 4, flexShrink: 0,
};

const transportBtnStyle: React.CSSProperties = {
  width: 26, height: 26,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent', border: `1px solid ${MC.navBorder}`,
  color: MC.navText, cursor: 'pointer', borderRadius: 6,
};

const dateInputStyle: React.CSSProperties = {
  fontSize: 10, padding: '2px 4px', background: MC.navBg,
  color: MC.navText, border: `1px solid ${MC.navBorder}`,
  borderRadius: 3, width: 95, colorScheme: 'dark',
};
