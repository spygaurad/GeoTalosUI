'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
import {
  Search,
  Plus,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Clock,
  Tags,
  X,
  Trash2,
  Layers,
} from 'lucide-react';

import { annotationSetsApi } from '@/lib/api/annotation-sets';
import { datasetsApi } from '@/lib/api/datasets';
import { jobsApi } from '@/lib/api/jobs';
import { qk } from '@/lib/query-keys';
import { TablePagination } from '@/components/TablePagination';
import type { AnnotationSet } from '@/types/api';

const PAGE_SIZE = 20;

import { ImportSetDrawer } from './ImportSetDrawer';
import { ImportRasterMaskDrawer } from './ImportRasterMaskDrawer';

// ── Color palette (matches DatasetsContent) ─────────────────────────────────
const C = {
  bg: '#faf8f4',
  border: '#e8d8c4',
  borderAccent: '#dcc9b2',
  text: '#2e3428',
  textSec: '#6a5c4e',
  textMuted: '#9a8878',
  accent: '#7f5539',
  accentLight: '#e8d5b8',
  accentDim: 'rgba(127,85,57,0.08)',
  success: '#4a7a4a',
  warning: '#a68a64',
  danger: '#b35e4c',
  rowHover: '#fdf5ec',
};

type FilterStatus = 'all' | 'ready' | 'running' | 'failed';

const FILTER_OPTIONS: { value: FilterStatus; label: string }[] = [
  { value: 'all',     label: 'All' },
  { value: 'ready',   label: 'Ready' },
  { value: 'running', label: 'Importing' },
  { value: 'failed',  label: 'Failed' },
];

const COLS = '1fr 180px 80px 120px 110px 40px';

// ── Status cell — polls job by id while running ───────────────────────────────
function StatusCell({ jobId }: { jobId: string | null }) {
  const { data, isLoading } = useQuery({
    queryKey: ['jobs', jobId],
    queryFn: () => jobsApi.get(jobId!),
    enabled: !!jobId,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === 'running' || s === 'queued' || s === 'pending' ? 3000 : false;
    },
  });

  if (!jobId) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.75rem', color: C.success }}>
        <CheckCircle2 size={12} /> Ready
      </span>
    );
  }
  if (isLoading || !data) return <span style={{ fontSize: '0.75rem', color: C.textMuted }}>…</span>;
  const s = data.status;
  if (s === 'completed') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.75rem', color: C.success }}>
        <CheckCircle2 size={12} /> Ready
      </span>
    );
  }
  if (s === 'failed' || s === 'cancelled') {
    return (
      <span
        title={data.error ?? undefined}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.75rem', color: C.danger }}
      >
        <AlertCircle size={12} /> {s === 'failed' ? 'Failed' : 'Cancelled'}
      </span>
    );
  }
  if (s === 'pending' || s === 'queued') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.75rem', color: C.textMuted }}>
        <Clock size={12} /> {s === 'pending' ? 'Pending' : 'Queued'}
      </span>
    );
  }
  const pct = Math.round((data.progress ?? 0) * 100);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.75rem', color: C.warning }}>
      <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
      Importing {pct}%
    </span>
  );
}

// ── Row ───────────────────────────────────────────────────────────────────────
function SetRow({ set, datasetName, onDelete }: { set: AnnotationSet; datasetName?: string; onDelete: () => void }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'grid',
        gridTemplateColumns: COLS,
        alignItems: 'center',
        padding: '0 20px',
        height: 52,
        borderBottom: `1px solid ${C.border}`,
        background: hovered ? C.rowHover : 'transparent',
        transition: 'background 0.1s',
      }}
    >
      {/* Name + subtitle */}
      <div style={{ minWidth: 0, paddingRight: 16 }}>
        <div
          style={{
            fontSize: '0.875rem', fontWeight: 500, color: C.text,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            marginBottom: 2,
          }}
          title={set.name}
        >
          {set.name}
        </div>
        {(set.dataset_id || set.stac_item_id) && (
          <div
            style={{
              fontSize: '0.6875rem', color: C.textMuted,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              fontFamily: 'monospace',
            }}
            title={set.stac_item_id ?? set.dataset_id ?? ''}
          >
            {datasetName ?? (set.stac_item_id ? 'Imagery item' : 'Dataset')}
          </div>
        )}
      </div>

      {/* Schema */}
      <div
        style={{
          fontSize: '0.8125rem', color: C.textSec,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 16,
        }}
        title={set.schema?.name ?? ''}
      >
        {set.schema?.name ?? <span style={{ color: C.textMuted }}>—</span>}
      </div>

      {/* Items count */}
      <div style={{ fontSize: '0.8125rem', color: C.textSec, textAlign: 'right', paddingRight: 16 }}>
        {set.annotation_count != null ? set.annotation_count.toLocaleString() : '—'}
      </div>

      {/* Status */}
      <div>
        <StatusCell jobId={set.job_id} />
      </div>

      {/* Date */}
      <div style={{ fontSize: '0.75rem', color: C.textMuted }}>
        {new Date(set.created_at).toLocaleDateString('en-GB', { month: 'short', day: 'numeric', year: 'numeric' })}
      </div>

      {/* Delete */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', opacity: hovered ? 1 : 0, transition: 'opacity 0.1s' }}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`Delete "${set.name}"?`)) onDelete();
          }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, padding: 4 }}
          title="Delete"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

// ── Table header ──────────────────────────────────────────────────────────────
function TableHeader() {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: COLS,
        padding: '0 20px',
        height: 34,
        borderBottom: `1px solid ${C.borderAccent}`,
        alignItems: 'center',
      }}
    >
      {[
        { label: 'Name', align: 'left' as const },
        { label: 'Schema', align: 'left' as const },
        { label: 'Items', align: 'right' as const },
        { label: 'Status', align: 'left' as const },
        { label: 'Date', align: 'left' as const },
        { label: '', align: 'left' as const },
      ].map((col, i) => (
        <div
          key={i}
          style={{
            fontSize: '0.6875rem',
            fontWeight: 600,
            letterSpacing: '0.07em',
            textTransform: 'uppercase',
            color: C.textMuted,
            textAlign: col.align,
            paddingRight: col.align === 'right' ? 16 : 0,
          }}
        >
          {col.label}
        </div>
      ))}
    </div>
  );
}

function SkeletonRows() {
  return (
    <>
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            display: 'grid', gridTemplateColumns: COLS,
            padding: '0 20px', height: 52, alignItems: 'center',
            borderBottom: `1px solid ${C.border}`,
          }}
        >
          <div style={{ height: 12, width: `${45 + i * 8}%`, background: C.accentLight, borderRadius: 4 }} />
          <div style={{ height: 10, width: '60%', background: '#f0e4d4', borderRadius: 4 }} />
          <div style={{ height: 10, width: '40%', background: '#f0e4d4', borderRadius: 4, marginLeft: 'auto', marginRight: 16 }} />
          <div style={{ height: 10, width: '70%', background: '#f0e4d4', borderRadius: 4 }} />
          <div style={{ height: 10, width: '60%', background: '#f0e4d4', borderRadius: 4 }} />
          <div />
        </div>
      ))}
    </>
  );
}

function EmptyState({ onNew, hasFilter }: { onNew: () => void; hasFilter: boolean }) {
  if (hasFilter) {
    return (
      <div style={{ padding: '52px 20px', textAlign: 'center' }}>
        <Tags size={28} style={{ color: C.textMuted, margin: '0 auto 12px', display: 'block', opacity: 0.5 }} />
        <p style={{ fontSize: '0.9375rem', fontWeight: 600, color: C.text, marginBottom: 6 }}>No sets match your filter</p>
        <p style={{ fontSize: '0.875rem', color: C.textMuted }}>Try clearing the search or status filter.</p>
      </div>
    );
  }
  return (
    <div style={{ padding: '64px 20px', textAlign: 'center' }}>
      <Tags size={32} style={{ color: C.textMuted, margin: '0 auto 16px', display: 'block', opacity: 0.4 }} />
      <p style={{ fontSize: '1rem', fontWeight: 600, color: C.text, marginBottom: 6 }}>No annotation sets yet</p>
      <p style={{ fontSize: '0.875rem', color: C.textMuted, marginBottom: 24, maxWidth: 360, margin: '0 auto 24px' }}>
        Import a GeoJSON FeatureCollection to create your first set.
      </p>
      <button
        onClick={onNew}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 7,
          height: 38, padding: '0 18px', borderRadius: 8, border: 'none',
          background: C.accent, color: '#faf8f4',
          fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer',
        }}
      >
        <Plus size={15} />
        New annotation set
      </button>
    </div>
  );
}

interface Props {
  workspaceId: string;
}

export function AnnotationSetsContent({ workspaceId: _ }: Props) {
  const { orgId } = useAuth();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [rasterDrawerOpen, setRasterDrawerOpen] = useState(false);
  const [page, setPage] = useState(1);

  const setsQ = useQuery({
    queryKey: ['annotation-sets', 'org', orgId],
    queryFn: () => annotationSetsApi.listByOrg(),
    enabled: !!orgId,
    refetchInterval: 8000,
  });

  // Resolve dataset_id → name so set rows show a readable scope, not a UUID.
  const datasetsQ = useQuery({
    queryKey: qk.datasets.list({ organization_id: orgId ?? '' }),
    queryFn: () => datasetsApi.list({ page_size: 200 }),
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
  });
  const datasetNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of datasetsQ.data?.items ?? []) map.set(d.id, d.name);
    return map;
  }, [datasetsQ.data]);

  const items = setsQ.data?.items ?? [];

  const filtered = items.filter((s) => {
    if (query && !s.name.toLowerCase().includes(query.toLowerCase())) return false;
    // Status filter is best-effort: rows without job → "ready"; rows with job → unknown
    // until polled, so we only filter "all" + "ready" reliably here.
    if (statusFilter === 'ready' && s.job_id) return false;
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

  const handleDelete = async (id: string) => {
    try {
      await annotationSetsApi.delete(id);
      setsQ.refetch();
    } catch {
      // toast handled upstream
    }
  };

  return (
    <div
      style={{
        maxWidth: 1000,
        margin: '0 auto',
        padding: '32px 24px',
        fontFamily: 'var(--font-sans, system-ui)',
        color: C.text,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28, gap: 16 }}>
        <div>
          <h1
            style={{
              fontFamily: 'var(--font-display, Georgia, serif)',
              fontSize: 'clamp(1.625rem, 3vw, 2.25rem)',
              fontWeight: 700,
              color: C.text,
              lineHeight: 1.1,
              marginBottom: 6,
            }}
          >
            Annotation Sets
          </h1>
          <p style={{ fontSize: '0.9375rem', color: C.textSec }}>
            {setsQ.data ? `${setsQ.data.items.length.toLocaleString()} total` : 'Vector annotations grouped by schema'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button
            onClick={() => setRasterDrawerOpen(true)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              height: 36, padding: '0 14px', borderRadius: 8,
              border: `1px solid ${C.borderAccent}`, background: '#fff',
              color: C.accent, fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer',
            }}
          >
            <Layers size={13} />
            Import raster mask
          </button>
          <button
            onClick={() => setDrawerOpen(true)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              height: 36, padding: '0 16px', borderRadius: 8, border: 'none',
              background: C.accent, color: '#faf8f4',
              fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer',
            }}
          >
            <Plus size={13} />
            New annotation set
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 0, flexWrap: 'wrap', alignItems: 'center' }}>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 7,
            flex: 1, minWidth: 220, height: 36, padding: '0 12px',
            borderRadius: 7, border: `1px solid ${C.border}`, background: '#fff',
          }}
        >
          <Search size={13} style={{ color: C.textMuted, flexShrink: 0 }} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name…"
            style={{
              flex: 1, border: 'none', outline: 'none',
              fontSize: '0.875rem', color: C.text, background: 'transparent',
            }}
          />
          {query && (
            <button onClick={() => setQuery('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, padding: 0 }}>
              <X size={13} />
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setStatusFilter(opt.value)}
              style={{
                height: 30, padding: '0 10px', borderRadius: 15,
                border: `1px solid ${statusFilter === opt.value ? C.accent : C.border}`,
                background: statusFilter === opt.value ? C.accentLight : 'transparent',
                color: statusFilter === opt.value ? C.accent : C.textMuted,
                fontSize: '0.75rem',
                fontWeight: statusFilter === opt.value ? 600 : 400,
                cursor: 'pointer',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div
        style={{
          marginTop: 16,
          border: `1px solid ${C.borderAccent}`,
          borderRadius: 10,
          overflow: 'hidden',
          background: '#fff',
        }}
      >
        <TableHeader />
        {setsQ.isLoading ? (
          <SkeletonRows />
        ) : filtered.length === 0 ? (
          <EmptyState onNew={() => setDrawerOpen(true)} hasFilter={hasFilter} />
        ) : (
          <>
            {paged.map((s) => (
              <SetRow key={s.id} set={s} datasetName={s.dataset_id ? datasetNameById.get(s.dataset_id) : undefined} onDelete={() => handleDelete(s.id)} />
            ))}
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
            marginTop: 10, background: 'none', border: 'none', cursor: 'pointer',
            color: C.textMuted, fontSize: '0.8125rem',
            display: 'flex', alignItems: 'center', gap: 5,
          }}
        >
          <X size={12} />
          Clear filters
        </button>
      )}

      <ImportSetDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onCreated={() => setsQ.refetch()}
      />

      <ImportRasterMaskDrawer
        open={rasterDrawerOpen}
        onClose={() => setRasterDrawerOpen(false)}
        onCreated={() => setsQ.refetch()}
      />
    </div>
  );
}
