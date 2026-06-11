'use client';

import { useState, useRef, useEffect } from 'react';
import { Plus, ChevronDown } from 'lucide-react';
import type { NodeCatalogEntry } from '@/types/api';

interface QuickAddMenuProps {
  entries: NodeCatalogEntry[];
  onSelect: (entry: NodeCatalogEntry) => void;
}

export function QuickAddMenu({ entries, onSelect }: QuickAddMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen(!open);
        }}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md transition-all hover:bg-[#f5ede0]"
        style={{
          fontSize: '0.8125rem',
          fontWeight: 500,
          color: '#7f5539',
          backgroundColor: 'transparent',
          border: '1px solid #d4c0a8',
          cursor: 'pointer',
        }}
        title="Quick add node"
      >
        <Plus className="w-3.5 h-3.5" />
        Add
        <ChevronDown className="w-3 h-3" style={{ opacity: 0.6 }} />
      </button>

      {open && entries.length > 0 && (
        <div
          className="absolute top-full right-0 mt-1 rounded-md shadow-lg overflow-hidden z-50"
          style={{
            backgroundColor: '#fefcf9',
            border: '1px solid #d4c0a8',
            minWidth: '200px',
            maxHeight: '400px',
            overflowY: 'auto',
            boxShadow: '0 4px 12px rgba(46,52,40,0.15)',
          }}
        >
          {entries.map((entry) => (
            <button
              key={entry.type}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onSelect(entry);
                setOpen(false);
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
              }}
              className="w-full text-left px-3 py-2 transition-colors hover:bg-[#f5ede0] border-b border-[#ede0d4] last:border-b-0"
              style={{
                fontSize: '0.8125rem',
                color: '#2e3428',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                paddingLeft: '12px',
                paddingRight: '12px',
              }}
            >
              <div style={{ fontWeight: 500, marginBottom: '2px' }}>
                {entry.label}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#9a8878', marginTop: '1px' }}>
                {entry.category}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
