'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  X,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Ban,
  Download,
  StopCircle,
  RefreshCw,
  Copy,
  Check,
  Hourglass,
  SkipForward,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import {
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { automationApi } from '@/lib/api/automation';
import { qk } from '@/lib/query-keys';
import type { PipelineRunStep, RunDetailRead } from '@/types/api';
import { ReportBody, ReportSummaryLine, extractReportPayload } from './DisplayNodeContent';
import { downloadReportPdf } from './reportPdf';

// ── Palette (matches RunsPanel / DisplayNodeContent) ────────────────────────────

const BG = '#faf5ec';
const CARD_BG = '#f8f4ed';
const BORDER = '#e8dcc8';
const TEXT_PRIMARY = '#2e3428';
const TEXT_SECONDARY = '#6b5d4e';
const TEXT_MUTED = '#9a8878';
const ACCENT = '#7f5539';

const STATUS_CFG: Record<
  string,
  { label: string; color: string; bg: string; icon: typeof Clock }
> = {
  pending:         { label: 'Pending',  color: '#9a8878', bg: '#f3f0eb', icon: Clock },
  running:         { label: 'Running',  color: '#a68a64', bg: '#f8f2e8', icon: Loader2 },
  completed:       { label: 'Completed', color: '#656d4a', bg: '#eef0e8', icon: CheckCircle2 },
  failed:          { label: 'Failed',    color: '#b35e4c', bg: '#f8ece8', icon: XCircle },
  cancelled:       { label: 'Cancelled', color: '#9a8878', bg: '#f0ece6', icon: Ban },
  skipped:         { label: 'Skipped',   color: '#9a8878', bg: '#f0ece6', icon: SkipForward },
  waiting_for_job: { label: 'Waiting',   color: '#a68a64', bg: '#f8f2e8', icon: Hourglass },
};

function StatusBadge({ status, size = 'sm' }: { status: string; size?: 'sm' | 'md' }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.pending;
  const Icon = cfg.icon;
  const spin = status === 'running';
  const fs = size === 'md' ? '0.6875rem' : '0.625rem';
  const ic = size === 'md' ? 'w-3 h-3' : 'w-2.5 h-2.5';
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full"
      style={{ fontSize: fs, fontWeight: 500, color: cfg.color, backgroundColor: cfg.bg }}
    >
      <Icon className={`${ic} ${spin ? 'animate-spin' : ''}`} />
      {cfg.label}
    </span>
  );
}

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function absTime(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString();
}

// ── Pretty JSON block with copy + download/image detection ──────────────────────

function isUrl(v: unknown): v is string {
  return typeof v === 'string' && /^https?:\/\//.test(v);
}

function collectDownloads(data: Record<string, unknown> | null): { label: string; url: string }[] {
  if (!data) return [];
  const out: { label: string; url: string }[] = [];
  const keys = ['download_url', 'file_url', 'url', 'output_url', 'result_url', 's3_url'];
  for (const k of keys) {
    if (isUrl(data[k])) out.push({ label: k, url: data[k] as string });
  }
  return out;
}

function imageUrls(data: Record<string, unknown> | null): string[] {
  if (!data) return [];
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (isUrl(v) && /\.(png|jpe?g|gif|webp|bmp|tif?f)(\?|$)/i.test(v)) out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v as Record<string, unknown>).forEach(walk);
  };
  walk(data);
  return Array.from(new Set(out)).slice(0, 8);
}

function JsonBlock({ value }: { value: unknown }) {
  const [copied, setCopied] = useState(false);
  const pretty = useMemo(() => {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }, [value]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pretty);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={copy}
        style={{
          position: 'absolute',
          top: '6px',
          right: '6px',
          padding: '3px 8px',
          fontSize: '10px',
          border: `1px solid rgba(245,237,224,0.2)`,
          background: 'rgba(245,237,224,0.08)',
          color: 'rgba(245,237,224,0.8)',
          borderRadius: '4px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
        }}
      >
        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
      <pre
        style={{
          backgroundColor: '#1e2218',
          color: 'rgba(245,237,224,0.88)',
          padding: '12px',
          paddingTop: '28px',
          borderRadius: '6px',
          fontSize: '11px',
          lineHeight: 1.55,
          fontFamily: 'monospace',
          overflow: 'auto',
          maxHeight: '46vh',
          margin: 0,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {pretty}
      </pre>
    </div>
  );
}

// ── Human-readable value renderer ───────────────────────────────────────────────
// Turns step input/output objects into labelled rows, tables, and links instead
// of a raw JSON dump.

function humanizeKey(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bId\b/g, 'ID')
    .replace(/\bUrl\b/g, 'URL')
    .replace(/\bS3\b/gi, 'S3');
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function isImageUrl(v: string): boolean {
  return /^https?:\/\//.test(v) && /\.(png|jpe?g|gif|webp|bmp|tif?f)(\?|$)/i.test(v);
}

function formatScalar(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') {
    // keep integers clean, trim long floats
    return Number.isInteger(v) ? v.toLocaleString() : String(Math.round(v * 1000) / 1000);
  }
  return String(v);
}

function ScalarValue({ value }: { value: unknown }) {
  if (typeof value === 'string' && isImageUrl(value)) {
    return (
      <a href={value} target="_blank" rel="noopener noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={value}
          alt="preview"
          style={{ maxWidth: '180px', maxHeight: '140px', borderRadius: '6px', border: `1px solid ${BORDER}` }}
        />
      </a>
    );
  }
  if (isUrl(value)) {
    return (
      <a
        href={value}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: ACCENT, textDecoration: 'underline', wordBreak: 'break-all' }}
      >
        {value}
      </a>
    );
  }
  return <span style={{ wordBreak: 'break-word' }}>{formatScalar(value)}</span>;
}

// ── ID hiding ────────────────────────────────────────────────────────────────
// Users care about names, not opaque identifiers. We never surface raw IDs
// (node_id, celery_task_id, dataset_id, stac_id, annotation_set_id, s3_key, …).

function isHiddenKey(key: string): boolean {
  const k = key.toLowerCase().trim();
  if (k === 'id' || k === 'uuid' || k === 'key' || k === 'pk' || k === 'arn') return true;
  if (/_(id|ids|uuid|uuids|key|pk)$/.test(k)) return true;
  if (/^(celery|task|stac|node|run|job|s3)_/.test(k)) return true;
  if (k.includes('celery')) return true;
  return false;
}

// Prefer a human label inside an object: name → title → label → slug.
function entityLabel(obj: Record<string, unknown>): string | null {
  for (const k of ['name', 'title', 'label', 'display_name', 'slug', 'filename', 'file_name']) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return null;
}

// Visible, ID-free entries of an object.
function visibleEntries(obj: Record<string, unknown>): [string, unknown][] {
  return Object.entries(obj).filter(([k]) => !isHiddenKey(k));
}

function isNumericish(v: unknown): boolean {
  return typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)));
}

// ── Elegant table primitives ─────────────────────────────────────────────────

const tableWrap: React.CSSProperties = {
  overflowX: 'auto',
  border: `1px solid ${BORDER}`,
  borderRadius: '8px',
  background: '#fff',
};
const tableBase: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'separate',
  borderSpacing: 0,
  fontSize: '12px',
};
const thBase: React.CSSProperties = {
  padding: '8px 12px',
  textAlign: 'left',
  fontWeight: 600,
  fontSize: '10px',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: TEXT_SECONDARY,
  whiteSpace: 'nowrap',
  background: '#f1e9da',
  borderBottom: `1px solid ${BORDER}`,
};
const tdBase: React.CSSProperties = {
  padding: '8px 12px',
  verticalAlign: 'top',
  color: TEXT_PRIMARY,
  borderTop: `1px solid #f0e8da`,
};
const ZEBRA = '#fcf8f1';

// Object → two-column definition table.
function DefinitionTable({ obj }: { obj: Record<string, unknown> }) {
  const entries = visibleEntries(obj);
  if (entries.length === 0) return <span style={{ color: TEXT_MUTED }}>—</span>;

  return (
    <div style={tableWrap}>
      <table style={tableBase}>
        <tbody>
          {entries.map(([k, v], i) => (
            <tr key={k} style={{ background: i % 2 ? ZEBRA : '#fff' }}>
              <td
                style={{
                  ...tdBase,
                  borderTop: i === 0 ? 'none' : tdBase.borderTop,
                  width: '34%',
                  fontWeight: 600,
                  color: TEXT_SECONDARY,
                  borderRight: `1px solid #f0e8da`,
                  whiteSpace: 'nowrap',
                }}
              >
                {humanizeKey(k)}
              </td>
              <td style={{ ...tdBase, borderTop: i === 0 ? 'none' : tdBase.borderTop, minWidth: 0 }}>
                <ReadableValue value={v} depth={1} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Array of uniform objects → a sortable, paginated TanStack table.
const PAGE_SIZE = 25;

function ObjectTable({ rows }: { rows: Record<string, unknown>[] }) {
  const [sorting, setSorting] = useState<SortingState>([]);

  // Union of visible (non-ID) keys, preserving first-seen order.
  const cols = useMemo(() => {
    const seen: string[] = [];
    for (const r of rows) {
      for (const k of Object.keys(r)) {
        if (!isHiddenKey(k) && !seen.includes(k)) seen.push(k);
      }
    }
    return seen;
  }, [rows]);

  // Columns whose every present value is numeric → right-align + numeric sort.
  const numericCols = useMemo(() => {
    const set = new Set<string>();
    for (const c of cols) {
      const vals = rows.map((r) => r[c]).filter((v) => v !== null && v !== undefined && v !== '');
      if (vals.length > 0 && vals.every(isNumericish)) set.add(c);
    }
    return set;
  }, [cols, rows]);

  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(
    () =>
      cols.map((c) => ({
        id: c,
        accessorFn: (row) => row[c],
        header: () => humanizeKey(c),
        sortingFn: numericCols.has(c) ? 'basic' : 'alphanumeric',
        cell: (info) => {
          const v = info.getValue();
          return isPlainObject(v) || Array.isArray(v) ? (
            <ReadableValue value={v} depth={2} />
          ) : (
            <ScalarValue value={v} />
          );
        },
      })),
    [cols, numericCols],
  );

  const paginated = rows.length > PAGE_SIZE;

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    ...(paginated ? { getPaginationRowModel: getPaginationRowModel() } : {}),
    initialState: paginated ? { pagination: { pageSize: PAGE_SIZE, pageIndex: 0 } } : {},
  });

  if (cols.length === 0) {
    return <span style={{ color: TEXT_MUTED }}>{rows.length} item{rows.length === 1 ? '' : 's'}</span>;
  }

  return (
    <div>
      <div style={tableWrap}>
        <table style={tableBase}>
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => {
                  const right = numericCols.has(header.column.id);
                  const sorted = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      onClick={header.column.getToggleSortingHandler()}
                      style={{
                        ...thBase,
                        textAlign: right ? 'right' : 'left',
                        cursor: 'pointer',
                        userSelect: 'none',
                      }}
                    >
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          flexDirection: right ? 'row-reverse' : 'row',
                        }}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {sorted === 'asc' ? (
                          <ChevronUp className="w-3 h-3" style={{ color: ACCENT }} />
                        ) : sorted === 'desc' ? (
                          <ChevronDown className="w-3 h-3" style={{ color: ACCENT }} />
                        ) : (
                          <ChevronsUpDown className="w-3 h-3" style={{ color: '#c9b89a' }} />
                        )}
                      </span>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row, i) => (
              <tr key={row.id} style={{ background: i % 2 ? ZEBRA : '#fff' }}>
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    style={{ ...tdBase, textAlign: numericCols.has(cell.column.id) ? 'right' : 'left' }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {paginated && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: '8px',
            fontSize: '11px',
            color: TEXT_SECONDARY,
          }}
        >
          <span>
            {table.getState().pagination.pageIndex * PAGE_SIZE + 1}–
            {Math.min((table.getState().pagination.pageIndex + 1) * PAGE_SIZE, rows.length)} of{' '}
            {rows.length}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              type="button"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              style={pagerBtnStyle(!table.getCanPreviousPage())}
            >
              <ChevronLeft className="w-3 h-3" />
            </button>
            <span>
              Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
            </span>
            <button
              type="button"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              style={pagerBtnStyle(!table.getCanNextPage())}
            >
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function pagerBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    height: '24px',
    border: `1px solid ${BORDER}`,
    background: '#fff',
    borderRadius: '6px',
    cursor: disabled ? 'default' : 'pointer',
    color: disabled ? '#c9b89a' : TEXT_SECONDARY,
  };
}

function ReadableValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  // Scalars
  if (value === null || value === undefined || typeof value !== 'object') {
    return <ScalarValue value={value} />;
  }

  // Arrays
  if (Array.isArray(value)) {
    if (value.length === 0) return <span style={{ color: TEXT_MUTED }}>—</span>;
    const objs = value.filter(isPlainObject) as Record<string, unknown>[];
    if (objs.length === value.length) {
      // Only collapse to name pills when each object is a *pure reference*:
      // it has a label and no other meaningful (non-ID) fields. Rich objects
      // (e.g. report sections) keep their full table.
      const pureRefs = objs.every((o) => {
        const label = entityLabel(o);
        if (!label) return false;
        const extras = visibleEntries(o).filter(([k]) => formatScalar(o[k]) !== label);
        return extras.length === 0;
      });
      if (pureRefs) {
        return (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {objs.map((o, i) => (
              <Pill key={i}>{entityLabel(o)}</Pill>
            ))}
          </div>
        );
      }
      // Nested tables (depth ≥ 1) collapse behind a summary so the parent
      // table stays scannable instead of nesting tables-within-tables.
      if (depth >= 1) {
        return (
          <NestedDisclosure summary={`${objs.length} item${objs.length === 1 ? '' : 's'}`}>
            <ObjectTable rows={objs} />
          </NestedDisclosure>
        );
      }
      return <ObjectTable rows={objs} />;
    }
    const allScalar = value.every((v) => v === null || typeof v !== 'object');
    if (allScalar) {
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {value.map((v, i) => (
            <Pill key={i}>
              <ScalarValue value={v} />
            </Pill>
          ))}
        </div>
      );
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {value.map((v, i) => (
          <ReadableValue key={i} value={v} depth={depth + 1} />
        ))}
      </div>
    );
  }

  // Objects → definition table. If only an id was present, fall back to its label.
  const obj = value as Record<string, unknown>;
  const entries = visibleEntries(obj);
  if (entries.length === 0) {
    const label = entityLabel(obj);
    return label ? <span>{label}</span> : <span style={{ color: TEXT_MUTED }}>—</span>;
  }
  // Deeply nested objects collapse behind a summary to avoid tables-in-tables.
  if (depth >= 2) {
    const label = entityLabel(obj);
    return (
      <NestedDisclosure summary={label ?? `${entries.length} field${entries.length === 1 ? '' : 's'}`}>
        <DefinitionTable obj={obj} />
      </NestedDisclosure>
    );
  }
  return <DefinitionTable obj={obj} />;
}

/** Collapsible wrapper for nested objects/arrays — keeps parent tables flat. */
function NestedDisclosure({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details>
      <summary
        style={{
          cursor: 'pointer',
          fontSize: '11px',
          color: ACCENT,
          fontWeight: 500,
          listStyle: 'none',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
        }}
      >
        <ChevronRight className="w-3 h-3" style={{ flexShrink: 0 }} />
        {summary}
      </summary>
      <div style={{ marginTop: '6px' }}>{children}</div>
    </details>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: '11px',
        padding: '2px 10px',
        background: CARD_BG,
        border: `1px solid ${BORDER}`,
        borderRadius: '999px',
        color: TEXT_PRIMARY,
      }}
    >
      {children}
    </span>
  );
}

function ReadablePanel({ value }: { value: Record<string, unknown> }) {
  if (visibleEntries(value).length === 0) {
    return <EmptyHint text="No displayable fields." />;
  }
  return <ReadableValue value={value} />;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: '10px',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: TEXT_SECONDARY,
        marginBottom: '6px',
      }}
    >
      {children}
    </div>
  );
}

function MetaItem({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: '9px', color: TEXT_MUTED, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div
        style={{
          fontSize: '11px',
          color: TEXT_PRIMARY,
          marginTop: '1px',
          fontFamily: mono ? 'monospace' : undefined,
          wordBreak: 'break-all',
        }}
      >
        {value}
      </div>
    </div>
  );
}

// ── Step detail pane ────────────────────────────────────────────────────────────

/** Stable deep-equality via JSON — inputs/outputs come from the same source so
 *  key order is consistent; good enough to detect echoed fields. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function StepDetail({ step }: { step: PipelineRunStep }) {
  const report = extractReportPayload(step.output_data);
  const downloads = collectDownloads(step.output_data);
  const images = imageUrls(step.output_data);
  const hasInput = step.input_data && Object.keys(step.input_data).length > 0;
  const hasOutput = step.output_data && Object.keys(step.output_data).length > 0;
  const hasConfig = step.config && Object.keys(step.config).length > 0;
  const [showEchoed, setShowEchoed] = useState(false);

  // Fields present in the input that are echoed verbatim in the output are
  // hidden by default — they're the single biggest source of duplicate tables.
  const echoedKeys = useMemo(() => {
    if (!step.input_data || !step.output_data) return new Set<string>();
    const out = step.output_data as Record<string, unknown>;
    const keys = new Set<string>();
    for (const [k, v] of Object.entries(step.input_data as Record<string, unknown>)) {
      if (k in out && deepEqual(v, out[k])) keys.add(k);
    }
    return keys;
  }, [step.input_data, step.output_data]);

  const filteredInput = useMemo(() => {
    if (!step.input_data) return null;
    if (showEchoed || echoedKeys.size === 0) return step.input_data;
    const entries = Object.entries(step.input_data as Record<string, unknown>).filter(
      ([k]) => !echoedKeys.has(k),
    );
    return Object.fromEntries(entries) as Record<string, unknown>;
  }, [step.input_data, echoedKeys, showEchoed]);

  const inputHasVisibleFields = filteredInput && Object.keys(filteredInput).length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Header */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '15px', fontWeight: 700, color: TEXT_PRIMARY }}>
            {step.node_label ?? step.node_type}
          </span>
          <StatusBadge status={step.status} size="md" />
        </div>
        <div style={{ fontSize: '11px', color: TEXT_SECONDARY, marginTop: '2px' }}>
          {humanizeKey(step.node_type)}
        </div>
      </div>

      {/* Meta grid — user-facing fields only (no IDs) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
          gap: '10px 16px',
          padding: '12px',
          background: CARD_BG,
          border: `1px solid ${BORDER}`,
          borderRadius: '6px',
        }}
      >
        <MetaItem label="Duration" value={formatDuration(step.duration_ms)} />
        <MetaItem label="Started" value={absTime(step.started_at)} />
        <MetaItem label="Completed" value={absTime(step.completed_at)} />
        {step.max_retries > 0 && (
          <MetaItem label="Attempt" value={`${step.attempt} / ${step.max_retries}`} />
        )}
      </div>

      {/* Error */}
      {step.error && (
        <div>
          <SectionLabel>Error</SectionLabel>
          <div
            style={{
              fontSize: '12px',
              color: '#b35e4c',
              background: '#f8ece8',
              border: '1px solid #e8c4ba',
              borderRadius: '6px',
              padding: '10px 12px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              lineHeight: 1.45,
            }}
          >
            {step.error}
          </div>
        </div>
      )}

      {/* Downloads */}
      {downloads.length > 0 && (
        <div>
          <SectionLabel>Outputs</SectionLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {downloads.map((d) => (
              <a
                key={d.url}
                href={d.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '11px',
                  fontWeight: 500,
                  color: ACCENT,
                  border: `1px solid ${BORDER}`,
                  background: CARD_BG,
                  borderRadius: '6px',
                  padding: '6px 10px',
                  textDecoration: 'none',
                }}
              >
                <Download className="w-3 h-3" />
                {d.label}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Image previews */}
      {images.length > 0 && (
        <div>
          <SectionLabel>Previews</SectionLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {images.map((src) => (
              <a key={src} href={src} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt="step output preview"
                  style={{
                    width: '140px',
                    height: '140px',
                    objectFit: 'cover',
                    borderRadius: '6px',
                    border: `1px solid ${BORDER}`,
                  }}
                />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Output — always full width; it's the richest payload. */}
      <div>
        <SectionLabel>Output</SectionLabel>
        {report ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginBottom: '10px' }}>
              <div style={{ fontSize: '11px', color: TEXT_SECONDARY, fontWeight: 600 }}>
                {report.title ?? 'Annotation Report'} — <ReportSummaryLine report={report} />
              </div>
              <button
                type="button"
                onClick={() => downloadReportPdf(report)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  flexShrink: 0,
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#f5ede0',
                  background: ACCENT,
                  border: 'none',
                  borderRadius: '4px',
                  padding: '6px 10px',
                  cursor: 'pointer',
                }}
              >
                <Download className="w-3 h-3" />
                Download PDF
              </button>
            </div>
            <ReportBody report={report} />
          </>
        ) : hasOutput ? (
          <>
            <ReadablePanel value={step.output_data!} />
            <RawToggle value={step.output_data} />
          </>
        ) : (
          <EmptyHint text={step.status === 'completed' ? 'No output data.' : `Step status: ${step.status}`} />
        )}
      </div>

      {/* Input + Config — dynamic layout: side-by-side on a wide pane, stacked
          when narrow (auto-fit). Input dedupes fields echoed from the output. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: hasConfig ? 'repeat(auto-fit, minmax(300px, 1fr))' : '1fr',
          gap: '16px',
          alignItems: 'start',
        }}
      >
        {/* Input */}
        <div>
          <SectionLabel>
            Input
            {echoedKeys.size > 0 && (
              <button
                type="button"
                onClick={() => setShowEchoed((s) => !s)}
                style={{
                  marginLeft: '8px',
                  fontSize: '10px',
                  fontWeight: 500,
                  color: ACCENT,
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  textTransform: 'none',
                  letterSpacing: 'normal',
                }}
              >
                {showEchoed
                  ? 'hide echoed'
                  : `${echoedKeys.size} echoed field${echoedKeys.size === 1 ? '' : 's'} hidden`}
              </button>
            )}
          </SectionLabel>
          {hasInput ? (
            inputHasVisibleFields ? (
              <>
                <ReadablePanel value={filteredInput!} />
                <RawToggle value={step.input_data} />
              </>
            ) : (
              <EmptyHint text="All input fields are echoed in the output." />
            )
          ) : (
            <EmptyHint text="No input data." />
          )}
        </div>

        {/* Config */}
        {hasConfig && (
          <div>
            <SectionLabel>Config</SectionLabel>
            <ReadablePanel value={step.config!} />
            <RawToggle value={step.config} />
          </div>
        )}
      </div>
    </div>
  );
}

function RawToggle({ value }: { value: unknown }) {
  return (
    <details style={{ marginTop: '6px' }}>
      <summary
        style={{
          cursor: 'pointer',
          fontSize: '10px',
          fontWeight: 500,
          color: TEXT_MUTED,
        }}
      >
        Raw JSON
      </summary>
      <div style={{ marginTop: '6px' }}>
        <JsonBlock value={value} />
      </div>
    </details>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div
      style={{
        fontSize: '11px',
        color: TEXT_MUTED,
        fontStyle: 'italic',
        padding: '10px 12px',
        background: CARD_BG,
        border: `1px dashed ${BORDER}`,
        borderRadius: '6px',
      }}
    >
      {text}
    </div>
  );
}

// ── Step list (left column) ─────────────────────────────────────────────────────

function StepListItem({
  step,
  index,
  active,
  onClick,
}: {
  step: PipelineRunStep;
  index: number;
  active: boolean;
  onClick: () => void;
}) {
  const cfg = STATUS_CFG[step.status] ?? STATUS_CFG.pending;
  const Icon = cfg.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: '100%',
        textAlign: 'left',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '8px',
        padding: '8px 10px',
        background: active ? '#fff' : 'transparent',
        border: 'none',
        borderLeft: `2px solid ${active ? ACCENT : 'transparent'}`,
        borderBottom: `1px solid ${BORDER}`,
        cursor: 'pointer',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '18px',
          height: '18px',
          borderRadius: '999px',
          backgroundColor: cfg.bg,
          flexShrink: 0,
          marginTop: '1px',
        }}
      >
        <Icon
          className={`w-2.5 h-2.5 ${step.status === 'running' ? 'animate-spin' : ''}`}
          style={{ color: cfg.color }}
        />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: '12px',
            fontWeight: active ? 600 : 500,
            color: TEXT_PRIMARY,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          <span style={{ color: TEXT_MUTED, fontWeight: 500 }}>{index + 1}.</span>{' '}
          {step.node_label ?? step.node_type}
        </div>
        <div style={{ fontSize: '10px', color: TEXT_MUTED, marginTop: '1px' }}>
          {cfg.label} · {formatDuration(step.duration_ms)}
        </div>
      </div>
    </button>
  );
}

// ── Modal ───────────────────────────────────────────────────────────────────────

interface RunResultsModalProps {
  runId: string;
  onClose: () => void;
}

export function RunResultsModal({ runId, onClose }: RunResultsModalProps) {
  const queryClient = useQueryClient();
  const [activeStepId, setActiveStepId] = useState<string | null>(null);

  const { data: run, isLoading, isError } = useQuery<RunDetailRead>({
    queryKey: qk.automation.runDetail(runId),
    queryFn: () => automationApi.getRunDetail(runId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'running' || status === 'pending' ? 3000 : false;
    },
  });

  const steps = useMemo(() => run?.steps ?? [], [run]);

  // Default selection: first failed step, else first step.
  const effectiveStepId = useMemo(() => {
    if (activeStepId && steps.some((s) => s.id === activeStepId)) return activeStepId;
    const failed = steps.find((s) => s.status === 'failed');
    return failed?.id ?? steps[0]?.id ?? null;
  }, [activeStepId, steps]);

  const activeStep = steps.find((s) => s.id === effectiveStepId) ?? null;

  const cancelMutation = useMutation({
    mutationFn: () => automationApi.cancelRun(runId),
    onSuccess: () => {
      toast.success('Run cancelled');
      queryClient.invalidateQueries({ queryKey: qk.automation.runDetail(runId) });
    },
    onError: (err) => toast.error(`Cancel failed: ${(err as Error).message}`),
  });

  const retryMutation = useMutation({
    mutationFn: () => automationApi.retryRun(runId),
    onSuccess: () => {
      toast.success('Run retried');
      queryClient.invalidateQueries({ queryKey: qk.automation.runDetail(runId) });
    },
    onError: (err) => toast.error(`Retry failed: ${(err as Error).message}`),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const content = (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 17, 12, 0.55)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(1100px, 100%)',
          height: 'min(720px, 90vh)',
          backgroundColor: BG,
          borderRadius: '10px',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
          color: TEXT_PRIMARY,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 18px',
            borderBottom: `1px solid ${BORDER}`,
            flexShrink: 0,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '15px', fontWeight: 700 }}>Run results</span>
              {run && <StatusBadge status={run.status} size="md" />}
              <span style={{ fontSize: '12px', color: TEXT_MUTED, fontFamily: 'monospace' }}>
                {runId.slice(0, 8)}
              </span>
            </div>
            {run && (
              <div style={{ fontSize: '11px', color: TEXT_SECONDARY, marginTop: '3px' }}>
                {run.completed_steps}/{run.total_steps} steps
                {run.failed_steps > 0 && ` · ${run.failed_steps} failed`}
                {' · '}started {relativeTime(run.started_at ?? run.created_at)}
                {run.completed_at && ` · finished ${relativeTime(run.completed_at)}`}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {run && (run.status === 'running' || run.status === 'pending') && (
              <button
                type="button"
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
                style={actionBtnStyle('#b35e4c', '#e0c4b8')}
              >
                {cancelMutation.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <StopCircle className="w-3 h-3" />
                )}
                Cancel
              </button>
            )}
            {run && run.status === 'failed' && (
              <button
                type="button"
                onClick={() => retryMutation.mutate()}
                disabled={retryMutation.isPending}
                style={actionBtnStyle(ACCENT, BORDER)}
              >
                {retryMutation.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <RefreshCw className="w-3 h-3" />
                )}
                Retry
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{
                padding: '6px',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: TEXT_SECONDARY,
                borderRadius: '4px',
              }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body: step list + detail pane */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {/* Step list */}
          <div
            style={{
              width: '260px',
              flexShrink: 0,
              borderRight: `1px solid ${BORDER}`,
              overflowY: 'auto',
              background: CARD_BG,
            }}
          >
            {isLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '32px' }}>
                <Loader2 className="w-4 h-4 animate-spin" style={{ color: TEXT_MUTED }} />
              </div>
            ) : steps.length === 0 ? (
              <p style={{ padding: '24px 12px', textAlign: 'center', fontSize: '12px', color: TEXT_MUTED }}>
                No steps recorded
              </p>
            ) : (
              steps.map((step, i) => (
                <StepListItem
                  key={step.id}
                  step={step}
                  index={i}
                  active={step.id === effectiveStepId}
                  onClick={() => setActiveStepId(step.id)}
                />
              ))
            )}
          </div>

          {/* Detail pane */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px', minWidth: 0 }}>
            {isLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '48px' }}>
                <Loader2 className="w-5 h-5 animate-spin" style={{ color: TEXT_MUTED }} />
              </div>
            ) : isError ? (
              <p style={{ fontSize: '12px', color: '#b35e4c' }}>Failed to load run.</p>
            ) : activeStep ? (
              <StepDetail step={activeStep} />
            ) : (
              <p style={{ fontSize: '12px', color: TEXT_MUTED }}>Select a step to view its results.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(content, document.body);
}

function actionBtnStyle(color: string, border: string): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    fontSize: '11px',
    fontWeight: 500,
    color,
    border: `1px solid ${border}`,
    background: 'transparent',
    borderRadius: '6px',
    padding: '5px 10px',
    cursor: 'pointer',
  };
}
