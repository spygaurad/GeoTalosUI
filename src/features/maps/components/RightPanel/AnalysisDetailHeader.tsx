'use client';

import { ArrowLeft } from 'lucide-react';
import { MC } from '../../mapColors';

interface AnalysisDetailHeaderProps {
  title: string;
  icon?: React.ReactNode;
  onBack: () => void;
}

export function AnalysisDetailHeader({ title, icon, onBack }: AnalysisDetailHeaderProps) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '0 0 6px',
      borderBottom: `1px dashed ${MC.border}`,
      marginBottom: 4,
    }}>
      <button
        onClick={onBack}
        title="Back to analyses"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 22, height: 22, borderRadius: 4,
          background: 'transparent', border: `1px solid ${MC.border}`,
          color: MC.textSecondary, cursor: 'pointer', flexShrink: 0,
        }}
      >
        <ArrowLeft size={11} />
      </button>
      {icon && (
        <span style={{ display: 'flex', color: MC.accent, flexShrink: 0 }}>{icon}</span>
      )}
      <span style={{
        fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
        textTransform: 'uppercase', color: MC.sectionLabel,
      }}>
        {title}
      </span>
    </div>
  );
}
