import type { DatasetItem } from '@/types/api';

/**
 * Shared formatters for turning machine identifiers into readable UI labels.
 *
 * Rule of thumb: raw STAC item ids, dataset UUIDs and feature UUIDs are NEVER
 * the visible label. They belong in `title=` tooltips only. Use these helpers
 * so every panel labels items the same way.
 */

/** Short human date for an ISO datetime, e.g. "12 Mar 2024". Null if absent/invalid. */
export function formatItemDate(
  datetime: string | null | undefined,
  opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' },
): string | null {
  if (!datetime) return null;
  const d = new Date(datetime);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', opts);
}

type LabelableItem = Pick<DatasetItem, 'filename' | 'datetime' | 'stac_item_id'>;

/**
 * Human-readable label for a dataset item. Prefers the original filename,
 * then the acquisition date, then a generic placeholder — never the raw
 * STAC item id. Keep the id for the surrounding `title=` tooltip instead.
 */
export function datasetItemLabel(
  item: LabelableItem,
  opts: { prefer?: 'filename' | 'date' } = {},
): string {
  const fname = item.filename?.trim();
  const date = formatItemDate(item.datetime);
  if (opts.prefer === 'date') return date ?? fname ?? 'Untitled item';
  return fname ?? date ?? 'Untitled item';
}
