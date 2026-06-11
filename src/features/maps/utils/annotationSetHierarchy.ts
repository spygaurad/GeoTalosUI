/**
 * Pure helpers for organizing annotation sets in the left panel.
 *
 * The backend stores no AOI↔annotation-set link, so AOI nesting is *derived*
 * client-side from each set's bounding envelope (`extent_4326`) versus the
 * AOI's bbox. Review/source facets ("ML annotated", "human corrected", …) are
 * likewise derived projections over `source_type` + `review_status`, never
 * stored containers — a set can match several lenses at once.
 */
import type {
  AnnotationReviewStatus,
  AnnotationSetSourceType,
} from '@/types/api';

export type Bbox = [number, number, number, number]; // [west, south, east, north]

/**
 * True when `inner` lies entirely within `outer`. `tolerance` (in degrees)
 * absorbs floating-point noise and sub-pixel overhang so a set drawn right up
 * to an AOI edge still nests cleanly.
 */
export function bboxContains(outer: Bbox, inner: Bbox, tolerance = 1e-7): boolean {
  const [ow, os, oe, on] = outer;
  const [iw, is, ie, ino] = inner;
  return (
    iw >= ow - tolerance &&
    is >= os - tolerance &&
    ie <= oe + tolerance &&
    ino <= on + tolerance
  );
}

function bboxArea([w, s, e, n]: Bbox): number {
  return Math.max(0, e - w) * Math.max(0, n - s);
}

export interface AoiCandidate {
  id: string;
  bbox: Bbox;
}

/**
 * Pick the AOI that should "own" a set with the given extent: the smallest
 * AOI whose bbox fully contains the extent. Returns null when the set has no
 * extent (empty set) or no AOI contains it — those stay in their dataset /
 * unanchored bucket.
 */
export function findContainingAoiId(
  extent: Bbox | null | undefined,
  aois: AoiCandidate[],
): string | null {
  if (!extent) return null;
  let best: AoiCandidate | null = null;
  for (const aoi of aois) {
    if (!bboxContains(aoi.bbox, extent)) continue;
    if (best === null || bboxArea(aoi.bbox) < bboxArea(best.bbox)) best = aoi;
  }
  return best?.id ?? null;
}

/** The status-lens buckets, in display order. */
export type ReviewFacet = 'human' | 'ml' | 'corrected' | 'verified';

export const REVIEW_FACET_LABEL: Record<ReviewFacet, string> = {
  human: 'Human annotated',
  ml: 'ML annotated',
  corrected: 'ML annotated · human corrected',
  verified: 'Human verified',
};

/**
 * Classify a set into its single canonical status facet. `verified` wins over
 * everything (it's an explicit sign-off); then corrected; then source_type.
 * Manual/import sets are treated as human-authored, analysis/model as ML.
 */
export function classifyReviewFacet(set: {
  source_type?: AnnotationSetSourceType;
  review_status?: AnnotationReviewStatus;
}): ReviewFacet {
  if (set.review_status === 'verified') return 'verified';
  if (set.review_status === 'corrected') return 'corrected';
  if (set.source_type === 'model' || set.source_type === 'analysis') return 'ml';
  return 'human';
}

export const REVIEW_STATUS_LABEL: Record<AnnotationReviewStatus, string> = {
  raw: 'Raw',
  corrected: 'Corrected',
  verified: 'Verified',
};

export const SOURCE_TYPE_LABEL: Record<AnnotationSetSourceType, string> = {
  manual: 'Manual',
  model: 'Model',
  import: 'Import',
  analysis: 'Analysis',
};
