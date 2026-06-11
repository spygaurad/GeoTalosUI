'use client';

import { useState, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
import {
  Search,
  UploadCloud,
  ChevronRight,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Clock,
  Database,
  X,
} from 'lucide-react';
import { datasetsApi } from '@/lib/api/datasets';
import { qk } from '@/lib/query-keys';
import { TablePagination } from '@/components/TablePagination';
import type { Dataset, DatasetStatus } from '@/types/api';

const PAGE_SIZE = 20;

// ── Color palette (warm cream — matches workspace pages) ──────────────────────
const C = {
  bg: '#faf8f4',
  border: '#e8d8c4',
  borderAccent: '#dcc9b2',
  text: '#2e3428',
  textSec: '#6a5c4e',
  textMuted: '#9a8878',
  accent: '#7f5539',
  accentHover: '#6b4628',
  accentLight: '#e8d5b8',
  accentDim: 'rgba(127,85,57,0.08)',
  success: '#4a7a4a',
  warning: '#a68a64',
  danger: '#b35e4c',
  rowHover: '#fdf5ec',
};

// ── Status helpers ────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<DatasetStatus, { label: string; color: string; dot: string; icon: React.ReactNode }> = {
  ready:     { label: 'Ready',      color: C.success,  dot: C.success,  icon: <CheckCircle2 size={12} /> },
  ingesting: { label: 'Ingesting',  color: C.warning,  dot: C.warning,  icon: <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> },
  pending:   { label: 'Pending',    color: C.textMuted, dot: C.textMuted, icon: <Clock size={12} /> },
  failed:    { label: 'Failed',     color: C.danger,   dot: C.danger,   icon: <AlertCircle size={12} /> },
};

type FilterStatus = 'all' | DatasetStatus;

// ── Dataset row ───────────────────────────────────────────────────────────────
function DatasetRow({ dataset, workspaceId }: { dataset: Dataset; workspaceId: string }) {
  const [hovered, setHovered] = useState(false);
  const s = STATUS_CONFIG[dataset.status] ?? STATUS_CONFIG.pending;

  const temporal = dataset.temporal_extent?.lower
    ? new Date(dataset.temporal_extent.lower).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) +
      (dataset.temporal_extent.upper && dataset.temporal_extent.upper !== dataset.temporal_extent.lower
        ? ` – ${new Date(dataset.temporal_extent.upper).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`
        : '')
    : '—';

  return (
    <Link
      href={`/workspace/${workspaceId}/datasets/${dataset.id}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 80px 120px 100px 90px',
        alignItems: 'center',
        gap: 0,
        padding: '0 20px',
        height: 52,
        borderBottom: `1px solid ${C.border}`,
        background: hovered ? C.rowHover : 'transparent',
        textDecoration: 'none',
        transition: 'background 0.1s',
        cursor: 'pointer',
      }}
    >
      {/* Name + tags */}
      <div style={{ minWidth: 0, paddingRight: 16 }}>
        <div style={{
          fontSize: '0.875rem',
          fontWeight: 500,
          color: C.text,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          marginBottom: '2px',
        }}>
          {dataset.name}
        </div>
      </div>

      {/* Items */}
      <div style={{ fontSize: '0.8125rem', color: C.textSec, textAlign: 'right', paddingRight: 16 }}>
        {dataset.metadata?.file_count != null ? dataset.metadata.file_count.toLocaleString() : '—'}
      </div>

      {/* Status */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        fontSize: '0.75rem',
        color: s.color,
      }}>
        {s.icon}
        {s.label}
      </div>

      {/* Temporal */}
      <div style={{ fontSize: '0.75rem', color: C.textMuted }}>{temporal}</div>

      {/* Arrow */}
      <div style={{
        display: 'flex',
        justifyContent: 'flex-end',
        opacity: hovered ? 1 : 0,
        transition: 'opacity 0.1s',
      }}>
        <ChevronRight size={14} style={{ color: C.textMuted }} />
      </div>
    </Link>
  );
}

// ── Table header ──────────────────────────────────────────────────────────────
function TableHeader() {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 80px 120px 100px 90px',
      padding: '0 20px',
      height: 34,
      borderBottom: `1px solid ${C.borderAccent}`,
      alignItems: 'center',
    }}>
      {['Name', 'Items', 'Status', 'Date', ''].map((col) => (
        <div key={col} style={{
          fontSize: '0.6875rem',
          fontWeight: 600,
          letterSpacing: '0.07em',
          textTransform: 'uppercase',
          color: C.textMuted,
          textAlign: col === 'Items' ? 'right' : 'left',
          paddingRight: col === 'Items' ? 16 : 0,
        }}>
          {col}
        </div>
      ))}
    </div>
  );
}

// ── Upload CTA row ─────────────────────────────────────────────────────────────
function UploadRow({ onClick }: { onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: '14px 20px',
        border: 'none',
        borderBottom: `1px solid ${C.border}`,
        background: hovered ? C.accentDim : 'transparent',
        cursor: 'pointer',
        transition: 'background 0.1s',
        textAlign: 'left',
      }}
    >
      <UploadCloud size={14} style={{ color: C.accent, flexShrink: 0 }} />
      <span style={{ fontSize: '0.8125rem', color: C.accent, fontWeight: 500 }}>
        Upload new dataset…
      </span>
    </button>
  );
}

// ── Skeleton rows ─────────────────────────────────────────────────────────────
function SkeletonRows() {
  return (
    <>
      {[1, 2, 3, 4].map((i) => (
        <div key={i} style={{
          display: 'grid',
          gridTemplateColumns: '1fr 80px 120px 100px 90px',
          padding: '0 20px',
          height: 52,
          alignItems: 'center',
          borderBottom: `1px solid ${C.border}`,
        }}>
          <div style={{ height: 12, width: `${45 + i * 8}%`, background: C.accentLight, borderRadius: 4 }} />
          <div style={{ height: 10, width: '60%', background: '#f0e4d4', borderRadius: 4, marginLeft: 'auto', marginRight: 16 }} />
          <div style={{ height: 10, width: '55%', background: '#f0e4d4', borderRadius: 4 }} />
          <div style={{ height: 10, width: '70%', background: '#f0e4d4', borderRadius: 4 }} />
          <div />
        </div>
      ))}
    </>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyState({ onUpload, hasFilter }: { onUpload: () => void; hasFilter: boolean }) {
  if (hasFilter) {
    return (
      <div style={{ padding: '52px 20px', textAlign: 'center' }}>
        <Database size={28} style={{ color: C.textMuted, margin: '0 auto 12px', display: 'block', opacity: 0.5 }} />
        <p style={{ fontSize: '0.9375rem', fontWeight: 600, color: C.text, marginBottom: 6 }}>No datasets match your filter</p>
        <p style={{ fontSize: '0.875rem', color: C.textMuted }}>Try clearing the search or status filter.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '64px 20px', textAlign: 'center' }}>
      <Database size={32} style={{ color: C.textMuted, margin: '0 auto 16px', display: 'block', opacity: 0.4 }} />
      <p style={{ fontSize: '1rem', fontWeight: 600, color: C.text, marginBottom: 6 }}>No datasets yet</p>
      <p style={{ fontSize: '0.875rem', color: C.textMuted, marginBottom: 24, maxWidth: 360, marginLeft: 'auto', marginRight: 'auto' }}>
        Upload GeoTIFF, COG, or GeoJSON files to start building your dataset library.
      </p>
      <button
        onClick={onUpload}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 7,
          height: 38,
          padding: '0 18px',
          borderRadius: 8,
          border: 'none',
          background: C.accent,
          color: '#faf8f4',
          fontSize: '0.875rem',
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        <UploadCloud size={15} />
        Upload first dataset
      </button>
    </div>
  );
}

// ── Filter pills ──────────────────────────────────────────────────────────────
const FILTER_OPTIONS: { value: FilterStatus; label: string }[] = [
  { value: 'all',       label: 'All' },
  { value: 'ready',     label: 'Ready' },
  { value: 'ingesting', label: 'Ingesting' },
  { value: 'pending',   label: 'Pending' },
  { value: 'failed',    label: 'Failed' },
];

// ── Main component ────────────────────────────────────────────────────────────
interface DatasetsContentProps {
  workspaceId: string;
}

export function DatasetsContent({ workspaceId }: DatasetsContentProps) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [showUpload, setShowUpload] = useState(false);
  const [page, setPage] = useState(1);
  const { orgId } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: qk.datasets.list({ organization_id: orgId }),
    queryFn: () => datasetsApi.list({ page_size: 1000 }),
    enabled: !!orgId,
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      const hasActive = items.some((d) => d.status === 'ingesting' || d.status === 'pending');
      return hasActive ? 5000 : false;
    },
  });

  const datasets = data?.items ?? [];

  const filtered = datasets.filter((d) => {
    if (statusFilter !== 'all' && d.status !== statusFilter) return false;
    if (query) {
      const q = query.toLowerCase();
      return d.name.toLowerCase().includes(q);
    }
    return true;
  });

  const hasFilter = !!query || statusFilter !== 'all';

  // Reset to first page whenever the filter result set changes.
  useEffect(() => {
    setPage(1);
  }, [query, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const clearFilters = useCallback(() => {
    setQuery('');
    setStatusFilter('all');
  }, []);

  return (
    <div style={{
      maxWidth: 900,
      margin: '0 auto',
      padding: '32px 24px',
      fontFamily: 'var(--font-sans, system-ui)',
      color: C.text,
    }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28, gap: 16 }}>
        <div>
          <h1 style={{
            fontFamily: 'var(--font-display, Georgia, serif)',
            fontSize: 'clamp(1.625rem, 3vw, 2.25rem)',
            fontWeight: 700,
            color: C.text,
            lineHeight: 1.1,
            marginBottom: 6,
          }}>
            Datasets
          </h1>
          <p style={{ fontSize: '0.9375rem', color: C.textSec }}>
            {data ? `${data.total.toLocaleString()} total` : 'Org-wide raster and vector data'}
          </p>
        </div>

        <button
          onClick={() => setShowUpload(true)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            height: 36,
            padding: '0 16px',
            borderRadius: 8,
            border: 'none',
            background: C.accent,
            color: '#faf8f4',
            fontSize: '0.8125rem',
            fontWeight: 600,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <UploadCloud size={13} />
          New dataset
        </button>
      </div>

      {/* ── Filters ── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 0, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Search */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          flex: 1,
          minWidth: 220,
          height: 36,
          padding: '0 12px',
          borderRadius: 7,
          border: `1px solid ${C.border}`,
          background: '#fff',
        }}>
          <Search size={13} style={{ color: C.textMuted, flexShrink: 0 }} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or tag…"
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              fontSize: '0.875rem',
              color: C.text,
              background: 'transparent',
            }}
          />
          {query && (
            <button onClick={() => setQuery('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, padding: 0 }}>
              <X size={13} />
            </button>
          )}
        </div>

        {/* Status pills */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setStatusFilter(opt.value)}
              style={{
                height: 30,
                padding: '0 10px',
                borderRadius: 15,
                border: `1px solid ${statusFilter === opt.value ? C.accent : C.border}`,
                background: statusFilter === opt.value ? C.accentLight : 'transparent',
                color: statusFilter === opt.value ? C.accent : C.textMuted,
                fontSize: '0.75rem',
                fontWeight: statusFilter === opt.value ? 600 : 400,
                cursor: 'pointer',
                transition: 'all 0.1s',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Table ── */}
      <div style={{
        marginTop: 16,
        border: `1px solid ${C.borderAccent}`,
        borderRadius: 10,
        overflow: 'hidden',
        background: '#fff',
      }}>
        <TableHeader />

        {isLoading ? (
          <SkeletonRows />
        ) : filtered.length === 0 ? (
          <EmptyState onUpload={() => setShowUpload(true)} hasFilter={hasFilter} />
        ) : (
          <>
            {paged.map((dataset) => (
              <DatasetRow key={dataset.id} dataset={dataset} workspaceId={workspaceId} />
            ))}
            <UploadRow onClick={() => setShowUpload(true)} />
            <TablePagination
              page={safePage}
              total={filtered.length}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
            />
          </>
        )}
      </div>

      {hasFilter && filtered.length > 0 && (
        <button
          onClick={clearFilters}
          style={{
            marginTop: 10,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: C.textMuted,
            fontSize: '0.8125rem',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <X size={12} />
          Clear filters
        </button>
      )}

      {/* ── Upload drawer (placeholder — wires to UploadWizard) ── */}
      {showUpload && (
        <>
          <div
            onClick={() => setShowUpload(false)}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(28,33,25,0.4)',
              zIndex: 100,
            }}
          />
          <div style={{
            position: 'fixed',
            top: 0,
            right: 0,
            bottom: 0,
            width: 'min(440px, 100vw)',
            background: '#faf8f4',
            borderLeft: `1px solid ${C.border}`,
            zIndex: 101,
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '-8px 0 32px rgba(28,33,25,0.14)',
          }}>
            {/* Drawer header */}
            <div style={{
              height: 52,
              display: 'flex',
              alignItems: 'center',
              padding: '0 20px',
              borderBottom: `1px solid ${C.border}`,
              flexShrink: 0,
            }}>
              <span style={{ flex: 1, fontSize: '0.9375rem', fontWeight: 600, color: C.text }}>
                Upload Dataset
              </span>
              <button
                onClick={() => setShowUpload(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Wizard */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {/* Dynamically loaded to keep map-color imports isolated */}
              <UploadDrawerContent onClose={() => setShowUpload(false)} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Dynamically loaded so UploadWizard and its deps are code-split out of the
// datasets page chunk and only fetched when the user opens the upload drawer.
const UploadWizardDynamic = dynamic(
  () => import('@/features/datasets/components/UploadWizard').then((m) => ({ default: m.UploadWizard })),
  { loading: () => <div style={{ padding: 24, color: '#9a8878', fontSize: '0.875rem' }}>Loading…</div> }
);

function UploadDrawerContent({ onClose }: { onClose: () => void }) {
  return (
    <UploadWizardDynamic
      onViewDataset={(id: string) => {
        onClose();
        window.location.href = window.location.href.replace(/\/datasets.*/, `/datasets/${id}`);
      }}
    />
  );
}
