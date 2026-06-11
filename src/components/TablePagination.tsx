'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

// Shared warm-cream palette (matches DatasetsContent / AnnotationSetsContent)
const C = {
  border: '#e8d8c4',
  borderAccent: '#dcc9b2',
  text: '#2e3428',
  textMuted: '#9a8878',
  accent: '#7f5539',
  accentLight: '#e8d5b8',
  rowHover: '#fdf5ec',
};

interface TablePaginationProps {
  /** 1-based current page. */
  page: number;
  /** Total number of items across all pages (after filtering). */
  total: number;
  /** Items per page. */
  pageSize: number;
  onPageChange: (page: number) => void;
}

/**
 * Client-side pagination footer for the cream-styled list tables.
 * Renders a "x–y of N" range, prev/next arrows, and numbered page buttons
 * (with ellipses for long ranges). Returns null when there's a single page.
 */
export function TablePagination({ page, total, pageSize, onPageChange }: TablePaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const go = (p: number) => onPageChange(Math.min(pageCount, Math.max(1, p)));

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '12px 20px',
        borderTop: `1px solid ${C.border}`,
        flexWrap: 'wrap',
      }}
    >
      <span style={{ fontSize: '0.75rem', color: C.textMuted }}>
        {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
      </span>

      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <ArrowBtn label="Previous page" disabled={page <= 1} onClick={() => go(page - 1)}>
          <ChevronLeft size={14} />
        </ArrowBtn>

        {pageNumbers(page, pageCount).map((p, i) =>
          p === '…' ? (
            <span key={`gap-${i}`} style={{ padding: '0 4px', fontSize: '0.75rem', color: C.textMuted }}>
              …
            </span>
          ) : (
            <PageBtn key={p} active={p === page} onClick={() => go(p)}>
              {p}
            </PageBtn>
          ),
        )}

        <ArrowBtn label="Next page" disabled={page >= pageCount} onClick={() => go(page + 1)}>
          <ChevronRight size={14} />
        </ArrowBtn>
      </div>
    </div>
  );
}

function ArrowBtn({
  children,
  disabled,
  onClick,
  label,
}: {
  children: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        borderRadius: 6,
        border: `1px solid ${C.border}`,
        background: '#fff',
        color: disabled ? C.borderAccent : C.text,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {children}
    </button>
  );
}

function PageBtn({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        minWidth: 28,
        height: 28,
        padding: '0 6px',
        borderRadius: 6,
        border: `1px solid ${active ? C.accent : C.border}`,
        background: active ? C.accentLight : '#fff',
        color: active ? C.accent : C.text,
        fontSize: '0.75rem',
        fontWeight: active ? 600 : 400,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

/** Build a compact page list like [1, '…', 4, 5, 6, '…', 12] around the current page. */
function pageNumbers(page: number, pageCount: number): (number | '…')[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);

  const out: (number | '…')[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pageCount - 1, page + 1);

  if (start > 2) out.push('…');
  for (let p = start; p <= end; p++) out.push(p);
  if (end < pageCount - 1) out.push('…');
  out.push(pageCount);

  return out;
}
