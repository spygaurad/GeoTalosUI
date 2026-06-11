'use client';

import { X } from 'lucide-react';
import { C } from './constants';

interface DrawerProps {
  title: string;
  onClose: () => void;
  width?: string;
  children: React.ReactNode;
}

export function Drawer({ title, onClose, width = 'min(480px, 100vw)', children }: DrawerProps) {
  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(28,33,25,0.4)', zIndex: 100 }}
      />
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width,
          background: C.bg,
          borderLeft: `1px solid ${C.border}`,
          zIndex: 101,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '-8px 0 32px rgba(28,33,25,0.14)',
        }}
      >
        <div
          style={{
            height: 52,
            display: 'flex',
            alignItems: 'center',
            padding: '0 20px',
            borderBottom: `1px solid ${C.border}`,
            flexShrink: 0,
          }}
        >
          <span style={{ flex: 1, fontSize: '0.9375rem', fontWeight: 600, color: C.text }}>
            {title}
          </span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted }}
          >
            <X size={18} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {children}
        </div>
      </div>
    </>
  );
}
