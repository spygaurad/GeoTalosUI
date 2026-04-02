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

const SPEED_OPTIONS = [
  { label: '0.5x', value: 4000 },
  { label: '1x', value: 2000 },
  { label: '2x', value: 1000 },
  { label: '4x', value: 500 },
] as const;

/** Format an ISO datetime string for display. */
function fmtDate(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtTime(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function TimelinePanel() {
  const enabled = useMapLayersStore((s) => s.timelineEnabled);
  const datasetId = useMapLayersStore((s) => s.timelineDatasetId);
  const items = useMapLayersStore((s) => s.timelineItems);
  const index = useMapLayersStore((s) => s.timelineIndex);
  const playing = useMapLayersStore((s) => s.timelinePlaying);
  const speed = useMapLayersStore((s) => s.timelineSpeed);
  const range = useMapLayersStore((s) => s.timelineRange);
  const layers = useMapLayersStore((s) => s.layers);
  const stepTimeline = useMapLayersStore((s) => s.stepTimeline);
  const setTimelineIndex = useMapLayersStore((s) => s.setTimelineIndex);
  const toggleTimelinePlay = useMapLayersStore((s) => s.toggleTimelinePlay);
  const setTimelineSpeed = useMapLayersStore((s) => s.setTimelineSpeed);
  const setTimelineRange = useMapLayersStore((s) => s.setTimelineRange);
  const closeTimeline = useMapLayersStore((s) => s.closeTimeline);

  const trackRef = useRef<HTMLDivElement>(null);
  const [showFilters, setShowFilters] = useState(false);

  // Get dataset name for display
  const datasetName = useMemo(() => {
    if (!datasetId || !layers[datasetId]) return 'Timeline';
    return layers[datasetId].name || 'Timeline';
  }, [datasetId, layers]);

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
    const timer = setInterval(() => stepTimeline('next'), speed);
    return () => clearInterval(timer);
  }, [playing, speed, filteredItems.length, stepTimeline]);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); toggleTimelinePlay(); }
      if (e.key === 'ArrowRight' || e.key === 'l') { e.preventDefault(); stepTimeline('next'); }
      if (e.key === 'ArrowLeft' || e.key === 'j') { e.preventDefault(); stepTimeline('prev'); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled, toggleTimelinePlay, stepTimeline]);

  // ── Timeline axis geometry ──────────────────────────────────────────────────
  const timeExtent = useMemo(() => {
    const dates = filteredItems
      .map((it) => (it.datetime ? new Date(it.datetime).getTime() : null))
      .filter((d): d is number => d !== null);
    if (dates.length === 0) return null;
    const min = Math.min(...dates);
    const max = Math.max(...dates);
    // Pad 5% on each side for visual spacing
    const pad = Math.max((max - min) * 0.05, 86400000); // at least 1 day
    return { min: min - pad, max: max + pad, span: max - min + 2 * pad };
  }, [filteredItems]);

  const dotPositions = useMemo(() => {
    if (!timeExtent || timeExtent.span === 0) return [];
    return items.map((item) => {
      if (!item.datetime) return 0;
      const t = new Date(item.datetime).getTime();
      return ((t - timeExtent.min) / timeExtent.span) * 100;
    });
  }, [items, timeExtent]);

  // ── Current item info ───────────────────────────────────────────────────────
  const currentItem = items[index] ?? null;
  const currentPct = dotPositions[index] ?? 0;

  // ── Click on track to jump ──────────────────────────────────────────────────
  const handleTrackClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!trackRef.current || !timeExtent || items.length === 0) return;
      const rect = trackRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      // Find the closest item to this position
      let closest = 0;
      let closestDist = Infinity;
      dotPositions.forEach((pos, i) => {
        const dist = Math.abs(pos - pct);
        if (dist < closestDist) { closestDist = dist; closest = i; }
      });
      setTimelineIndex(closest);
    },
    [timeExtent, items, dotPositions, setTimelineIndex],
  );

  // ── Tick marks for the axis ─────────────────────────────────────────────────
  const ticks = useMemo(() => {
    if (!timeExtent) return [];
    const count = Math.min(5, filteredItems.length); // Reduced for compact view
    if (count <= 1) return [];
    const step = timeExtent.span / count;
    const result: { pct: number; label: string }[] = [];
    for (let i = 1; i < count; i++) {
      const t = timeExtent.min + step * i;
      const pct = (step * i) / timeExtent.span * 100;
      const d = new Date(t);
      result.push({
        pct,
        label: d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
      });
    }
    return result;
  }, [timeExtent, filteredItems.length]);

  if (!enabled) return null;

  // ── Floating compact timeline panel ─────────────────────────────────────────
  return (
    <div style={{
      position: 'absolute',
      bottom: 24,
      left: '50%',
      transform: 'translateX(-50%)',
      width: 'min(480px, calc(100% - 360px))', // Compact width, avoid overlapping side panels
      zIndex: MAP_Z.overlay,
      pointerEvents: 'auto',
    }}>
      {/* Main panel container */}
      <div style={{
        background: MC.navBg,
        borderRadius: 12,
        boxShadow: MC.shadowLg,
        border: `1px solid ${MC.navBorder}`,
        overflow: 'hidden',
      }}>
        {/* ── Compact header with dataset name + current frame ── */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          padding: '8px 12px',
          gap: 8,
          borderBottom: `1px solid ${MC.navBorder}`,
        }}>
          {/* Dataset name (truncated) */}
          <span style={{
            fontSize: 11,
            fontWeight: 600,
            color: MC.navText,
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 140,
          }}>
            {datasetName}
          </span>

          {/* Current frame date/time */}
          <span style={{
            fontSize: 11,
            color: MC.navAccent,
            fontVariantNumeric: 'tabular-nums',
            fontWeight: 500,
          }}>
            {fmtDate(currentItem?.datetime)}
          </span>

          {/* Frame counter */}
          <span style={{
            fontSize: 10,
            color: MC.navTextMuted,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {index + 1}/{filteredItems.length}
          </span>

          {/* Filter toggle */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            style={{
              ...iconBtnStyle,
              background: showFilters ? MC.navActiveBtn : 'transparent',
              color: showFilters ? MC.navAccent : MC.navText,
            }}
            title="Date filters & settings"
          >
            <Settings2 size={12} />
          </button>

          {/* Close button */}
          <button onClick={closeTimeline} style={iconBtnStyle} title="Close timeline">
            <X size={14} />
          </button>
        </div>

        {/* ── Expandable filter row ── */}
        {showFilters && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            padding: '6px 12px',
            gap: 8,
            borderBottom: `1px solid ${MC.navBorder}`,
            background: 'rgba(0,0,0,0.15)',
          }}>
            <Calendar size={10} color={MC.navTextMuted} />
            <input
              type="date"
              value={range?.[0] ?? ''}
              onChange={(e) => setTimelineRange([e.target.value, range?.[1] ?? ''])}
              style={dateInputStyle}
              title="From date"
            />
            <span style={{ fontSize: 10, color: MC.navTextMuted }}>→</span>
            <input
              type="date"
              value={range?.[1] ?? ''}
              onChange={(e) => setTimelineRange([range?.[0] ?? '', e.target.value])}
              style={dateInputStyle}
              title="To date"
            />
            {range && (
              <button
                onClick={() => setTimelineRange(null)}
                style={{ ...iconBtnStyle, width: 16, height: 16 }}
                title="Clear filter"
              >
                <X size={10} />
              </button>
            )}
            <div style={{ flex: 1 }} />
            {/* Speed picker */}
            <span style={{ fontSize: 9, color: MC.navTextMuted }}>Speed:</span>
            <select
              value={speed}
              onChange={(e) => setTimelineSpeed(Number(e.target.value))}
              style={{
                fontSize: 10,
                padding: '2px 4px',
                background: MC.navBg,
                color: MC.navText,
                border: `1px solid ${MC.navBorder}`,
                borderRadius: 3,
                cursor: 'pointer',
              }}
            >
              {SPEED_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* ── Transport + timeline scrubber ── */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          padding: '10px 12px',
          gap: 10,
        }}>
          {/* Transport buttons - compact */}
          <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
            <button onClick={() => stepTimeline('prev')} style={transportBtnStyle} title="Previous (←)">
              <SkipBack size={12} />
            </button>
            <button
              onClick={toggleTimelinePlay}
              style={{
                ...transportBtnStyle,
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: playing ? MC.navAccent : 'transparent',
                color: playing ? MC.navBg : MC.navText,
                border: `1px solid ${playing ? MC.navAccent : MC.navBorder}`,
              }}
              title={playing ? 'Pause (Space)' : 'Play (Space)'}
            >
              {playing ? <Pause size={12} /> : <Play size={12} style={{ marginLeft: 1 }} />}
            </button>
            <button onClick={() => stepTimeline('next')} style={transportBtnStyle} title="Next (→)">
              <SkipForward size={12} />
            </button>
          </div>

          {/* Timeline track */}
          <div
            ref={trackRef}
            onClick={handleTrackClick}
            style={{
              flex: 1,
              height: 32,
              position: 'relative',
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            {/* Track line */}
            <div style={{
              position: 'absolute',
              top: 11,
              left: 0,
              right: 0,
              height: 2,
              background: MC.navBorder,
              borderRadius: 1,
            }} />

            {/* Progress fill */}
            <div style={{
              position: 'absolute',
              top: 11,
              left: 0,
              width: `${currentPct}%`,
              height: 2,
              background: MC.navAccent,
              borderRadius: 1,
              transition: playing ? 'none' : 'width 0.15s ease',
            }} />

            {/* Item dots */}
            {items.map((item, i) => {
              const pct = dotPositions[i] ?? 0;
              const isActive = i === index;
              const isFiltered = filteredItems.includes(item);
              return (
                <div
                  key={item.id}
                  onClick={(e) => { e.stopPropagation(); setTimelineIndex(i); }}
                  title={`${fmtDate(item.datetime)} ${fmtTime(item.datetime)}`}
                  style={{
                    position: 'absolute',
                    left: `${pct}%`,
                    top: isActive ? 7 : 9,
                    width: isActive ? 10 : 6,
                    height: isActive ? 10 : 6,
                    borderRadius: '50%',
                    background: isActive ? MC.navAccent : isFiltered ? MC.navText : MC.navBorder,
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

            {/* Tick labels - compact */}
            {ticks.map((tick) => (
              <span
                key={tick.pct}
                style={{
                  position: 'absolute',
                  left: `${tick.pct}%`,
                  top: 18,
                  transform: 'translateX(-50%)',
                  fontSize: 8,
                  color: MC.navTextMuted,
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                }}
              >
                {tick.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const iconBtnStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  border: 'none',
  color: MC.navText,
  cursor: 'pointer',
  borderRadius: 4,
  flexShrink: 0,
};

const transportBtnStyle: React.CSSProperties = {
  width: 26,
  height: 26,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  border: `1px solid ${MC.navBorder}`,
  color: MC.navText,
  cursor: 'pointer',
  borderRadius: 6,
};

const dateInputStyle: React.CSSProperties = {
  fontSize: 10,
  padding: '2px 4px',
  background: MC.navBg,
  color: MC.navText,
  border: `1px solid ${MC.navBorder}`,
  borderRadius: 3,
  width: 95,
  colorScheme: 'dark',
};

