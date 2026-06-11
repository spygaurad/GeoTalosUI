'use client';

import { useState, useCallback } from 'react';
import { ChevronDown } from 'lucide-react';
import { MC } from '../../mapColors';
import type { RenderingConfig, BandInfo, RenderingPreset } from '@/types/api';
import type { BandSelection } from '../../types';

interface BandSelectorProps {
  renderingConfig: RenderingConfig;
  bandSelection: BandSelection | null;
  activePreset: string | null;
  onBandChange: (bands: BandSelection, preset?: string | null) => void;
  onPresetChange: (presetId: string) => void;
}

const CHANNEL_LABELS = ['R', 'G', 'B'] as const;
const CHANNEL_COLORS = ['#e05c5c', '#5cb85c', '#5c8ce0'] as const;

function bandLabel(band: BandInfo): string {
  if (band.spectral_name) return `${band.index}: ${band.spectral_name}`;
  if (band.description) return `${band.index}: ${band.description}`;
  return `Band ${band.index}`;
}

export function BandSelector({
  renderingConfig,
  bandSelection,
  activePreset,
  onBandChange,
  onPresetChange,
}: BandSelectorProps) {
  const bands = renderingConfig.bands;
  // Drop expression-based presets (e.g. legacy "ndvi"/"moisture" baked into
  // already-ingested datasets). `handlePresetChange` can't apply `expression`/
  // `asset_as_band`, so those buttons would render garbage. NDVI now lives in
  // Temporal Playback, which builds its own expression.
  const presets = Object.fromEntries(
    Object.entries(renderingConfig.presets).filter(
      ([, preset]) => !preset.params?.expression && !preset.params?.asset_as_band,
    ),
  );

  // Derive current selection — if no explicit selection, parse from default preset
  const current = bandSelection ?? deriveDefaultBands(renderingConfig);

  const handleChannelChange = useCallback(
    (channel: 'r' | 'g' | 'b', bandIndex: number) => {
      const updated = { ...current, [channel]: bandIndex };
      onBandChange(updated, null); // clear preset when manually selecting
    },
    [current, onBandChange],
  );

  const handlePresetClick = useCallback(
    (presetId: string) => {
      onPresetChange(presetId);
    },
    [onPresetChange],
  );

  if (bands.length < 2) return null; // No band selection needed for single-band

  return (
    <div>
      {/* Presets row */}
      {Object.keys(presets).length > 1 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{
            fontSize: 9, fontWeight: 600, color: MC.textMuted,
            textTransform: 'uppercase', letterSpacing: '0.03em',
            marginBottom: 4,
          }}>
            Presets
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {Object.entries(presets).map(([pid, preset]) => (
              <PresetButton
                key={pid}
                presetId={pid}
                preset={preset}
                isActive={activePreset === pid}
                onClick={handlePresetClick}
              />
            ))}
          </div>
        </div>
      )}

      {/* RGB channel selectors */}
      <div style={{
        fontSize: 9, fontWeight: 600, color: MC.textMuted,
        textTransform: 'uppercase', letterSpacing: '0.03em',
        marginBottom: 4,
      }}>
        RGB Channels ({bands.length} bands)
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {CHANNEL_LABELS.map((ch, i) => {
          const channel = ch.toLowerCase() as 'r' | 'g' | 'b';
          const selectedIndex = current[channel];
          return (
            <ChannelRow
              key={ch}
              label={ch}
              color={CHANNEL_COLORS[i]}
              bands={bands}
              selectedIndex={selectedIndex}
              onChange={(idx) => handleChannelChange(channel, idx)}
            />
          );
        })}
      </div>
    </div>
  );
}

function ChannelRow({
  label, color, bands, selectedIndex, onChange,
}: {
  label: string;
  color: string;
  bands: BandInfo[];
  selectedIndex: number;
  onChange: (index: number) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        width: 16, fontSize: 11, fontWeight: 700,
        color, textAlign: 'center', flexShrink: 0,
      }}>
        {label}
      </span>
      <div style={{ position: 'relative', flex: 1 }}>
        <select
          value={selectedIndex}
          onChange={(e) => onChange(Number(e.target.value))}
          onClick={(e) => e.stopPropagation()}
          style={{
            width: '100%', height: 26, fontSize: 11,
            padding: '0 20px 0 8px',
            borderRadius: 4,
            border: `1px solid ${MC.border}`,
            background: MC.inputBg,
            color: MC.text,
            cursor: 'pointer',
            appearance: 'none',
            outline: 'none',
          }}
        >
          {bands.map((b) => (
            <option key={b.index} value={b.index}>
              {bandLabel(b)}
            </option>
          ))}
        </select>
        <ChevronDown
          size={10}
          style={{
            position: 'absolute', right: 6, top: '50%',
            transform: 'translateY(-50%)',
            color: MC.textMuted, pointerEvents: 'none',
          }}
        />
      </div>
    </div>
  );
}

function PresetButton({
  presetId, preset, isActive, onClick,
}: {
  presetId: string;
  preset: RenderingPreset;
  isActive: boolean;
  onClick: (id: string) => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(presetId); }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={preset.label}
      style={{
        padding: '3px 8px', borderRadius: 4,
        fontSize: 10, fontWeight: 600,
        background: isActive ? MC.accentDim : hover ? MC.hoverBg : 'transparent',
        border: `1px solid ${isActive ? MC.accent : MC.border}`,
        color: isActive ? MC.accent : MC.textSecondary,
        cursor: 'pointer',
        transition: 'all 0.12s',
        whiteSpace: 'nowrap',
      }}
    >
      {preset.label}
    </button>
  );
}

/** Parse default band selection from the rendering config's default preset */
function deriveDefaultBands(rc: RenderingConfig): BandSelection {
  const defaultPreset = rc.presets[rc.default_preset];
  if (defaultPreset?.params?.asset_bidx) {
    const match = defaultPreset.params.asset_bidx.match(/\|(\d+),(\d+),(\d+)/);
    if (match) {
      return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) };
    }
  }
  // Fallback: first 3 bands
  return {
    r: rc.bands[0]?.index ?? 1,
    g: rc.bands[1]?.index ?? 2,
    b: rc.bands[2]?.index ?? 3,
  };
}
