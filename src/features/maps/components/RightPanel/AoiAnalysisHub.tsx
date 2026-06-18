'use client';

import {
  Bot, Play, ChevronRight, SlidersHorizontal,
} from 'lucide-react';
import { MC } from '../../mapColors';

export type AoiAnalysisKey =
  | 'inference'
  | 'visualization'
  | 'temporal'
  | 'ndvi'
  | 'area_stats'
  | 'composite'
  | 'change_detection';

interface AnalysisDef {
  key: AoiAnalysisKey;
  icon: React.ReactNode;
  label: string;
  hint: string;
  /** Requires at least one selected dataset to be runnable. */
  needsDataset: boolean;
}

const ANALYSES: AnalysisDef[] = [
  {
    key: 'inference',
    icon: <Bot size={12} />,
    label: 'Run Inference',
    hint: 'Detect or segment objects with a registered model',
    needsDataset: true,
  },
  {
    key: 'visualization',
    icon: <SlidersHorizontal size={12} />,
    label: 'Visualization',
    hint: 'Filter & inspect annotation sets attached to this AOI',
    needsDataset: false,
  },
  {
    key: 'temporal',
    icon: <Play size={12} />,
    label: 'Temporal Playback',
    hint: 'Play through dataset items chronologically',
    needsDataset: true,
  },
  // {
  //   key: 'ndvi',
  //   icon: <Activity size={12} />,
  //   label: 'NDVI',
  //   hint: 'Vegetation index over the AOI',
  //   needsDataset: true,
  // },
  // {
  //   key: 'area_stats',
  //   icon: <BarChart3 size={12} />,
  //   label: 'Area Statistics',
  //   hint: 'Pixel/area distribution within the AOI',
  //   needsDataset: true,
  // },
  // {
  //   key: 'composite',
  //   icon: <Layers size={12} />,
  //   label: 'Composite',
  //   hint: 'Cloudless mosaic from selected datasets',
  //   needsDataset: true,
  // },
  // {
  //   key: 'change_detection',
  //   icon: <GitCompare size={12} />,
  //   label: 'Change Detection',
  //   hint: 'Compare two time windows',
  //   needsDataset: true,
  // },
];

interface AoiAnalysisHubProps {
  hasSelectedDataset: boolean;
  hasAoiBbox: boolean;
  onSelect: (key: AoiAnalysisKey) => void;
}

export function AoiAnalysisHub({
  hasSelectedDataset,
  hasAoiBbox,
  onSelect,
}: AoiAnalysisHubProps) {
  return (
    <section>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
        textTransform: 'uppercase', color: MC.sectionLabel,
        marginBottom: 6,
      }}>
        Analyses
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {ANALYSES.map((a) => {
          const disabled =
            !hasAoiBbox || (a.needsDataset && !hasSelectedDataset);
          return (
            <button
              key={a.key}
              onClick={() => !disabled && onSelect(a.key)}
              disabled={disabled}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px', borderRadius: 5,
                background: 'transparent',
                border: `1px solid ${disabled ? MC.border : MC.accent}`,
                color: disabled ? MC.textMuted : MC.text,
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.55 : 1,
                textAlign: 'left',
                transition: 'all 0.12s',
              }}
            >
              <span style={{
                color: disabled ? MC.textMuted : MC.accent,
                display: 'flex', flexShrink: 0,
              }}>
                {a.icon}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{
                  display: 'block', fontSize: 11, fontWeight: 600,
                  color: disabled ? MC.textMuted : MC.text,
                }}>
                  {a.label}
                </span>
                <span style={{
                  display: 'block', fontSize: 9, color: MC.textMuted, marginTop: 1,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {a.hint}
                </span>
              </span>
              <ChevronRight size={11} color={MC.textMuted} />
            </button>
          );
        })}
      </div>
      {!hasAoiBbox && (
        <p style={{ fontSize: 10, color: MC.textMuted, fontStyle: 'italic', marginTop: 6 }}>
          Draw an AOI to enable analyses.
        </p>
      )}
      {hasAoiBbox && !hasSelectedDataset && (
        <p style={{ fontSize: 10, color: MC.textMuted, fontStyle: 'italic', marginTop: 6 }}>
          Select a dataset above to enable analyses.
        </p>
      )}
    </section>
  );
}
