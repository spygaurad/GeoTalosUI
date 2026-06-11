import type { AnnotationClass } from '@/types/api';

export interface AnnotationClassStyle {
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  fillOpacity: number;
}

const DEFAULT_STYLE: AnnotationClassStyle = {
  fillColor: '#c4985c',
  strokeColor: '#c4985c',
  strokeWidth: 2,
  fillOpacity: 0.35,
};

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function normalizeOpacity(v: unknown, fallback: number): number {
  const n = asNumber(v);
  if (n === undefined) return fallback;
  if (n > 1 && n <= 100) return clamp(n / 100, 0, 1);
  return clamp(n, 0, 1);
}

function normalizeAlias(v: string): string {
  return v.trim().toLowerCase();
}

export function normalizeClassStyleDefinition(definition: Record<string, unknown> | null | undefined): AnnotationClassStyle {
  const d = definition ?? {};
  const fillColor = asString(d.fillColor) ?? asString(d.fill_color) ?? asString(d.fill) ?? DEFAULT_STYLE.fillColor;
  const strokeColor = asString(d.strokeColor) ?? asString(d.stroke_color) ?? asString(d.color) ?? asString(d.stroke) ?? fillColor;
  const strokeWidth = clamp(asNumber(d.strokeWidth) ?? asNumber(d.stroke_width) ?? asNumber(d.weight) ?? DEFAULT_STYLE.strokeWidth, 0, 20);
  const fillOpacity = normalizeOpacity(d.fillOpacity ?? d.fill_opacity ?? d.opacity, DEFAULT_STYLE.fillOpacity);

  return { fillColor, strokeColor, strokeWidth, fillOpacity };
}

/**
 * Builds a style map keyed by class id plus normalized aliases (name/path).
 * Alias keys make rendering resilient when feature payloads carry class labels
 * instead of UUIDs.
 */
export function buildClassStyles(
  classes: AnnotationClass[] | undefined,
): Record<string, AnnotationClassStyle> | undefined {
  if (!classes?.length) return undefined;

  const out: Record<string, AnnotationClassStyle> = {};
  for (const cls of classes) {
    const style = normalizeClassStyleDefinition(cls.style?.definition as Record<string, unknown> | undefined);
    out[cls.id] = style;

    const aliases = [cls.name, cls.path].filter((v): v is string => !!v).map(normalizeAlias);
    for (const alias of aliases) {
      if (!out[alias]) out[alias] = style;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

export function extractClassIdFromProperties(properties: Record<string, unknown> | undefined): string | undefined {
  if (!properties) return undefined;

  const directKeys = [
    'class_id',
    'classId',
    '_class_id',
    '_classId',
    'annotation_class_id',
    'annotationClassId',
    'class',
  ] as const;

  for (const key of directKeys) {
    const val = asString(properties[key]);
    if (val) return val;
  }

  const nested = properties.annotation_class ?? properties.annotationClass;
  if (nested && typeof nested === 'object') {
    const rec = nested as Record<string, unknown>;
    const nestedVal = asString(rec.id) ?? asString(rec.class_id) ?? asString(rec.name) ?? asString(rec.path);
    if (nestedVal) return nestedVal;
  }

  return undefined;
}

/**
 * Read a numeric confidence/score from a feature's properties. Accepts a few
 * common key spellings emitted by inference backends.
 */
export function extractConfidence(
  properties: Record<string, unknown> | undefined,
): number | undefined {
  if (!properties) return undefined;
  const keys = ['confidence', 'score', 'confidence_score', 'conf'] as const;
  for (const key of keys) {
    const v = asNumber(properties[key]);
    if (v !== undefined) return v;
  }
  return undefined;
}

/**
 * Map a confidence value (0–1) to a red→yellow→green heatmap color.
 * Mirrors the gradient legend shown in the AOI visualization panel.
 */
export function confidenceColor(confidence: number): string {
  const hue = clamp(confidence, 0, 1) * 120; // 0 = red, 120 = green
  return `hsl(${hue.toFixed(0)}, 75%, 50%)`;
}

export function resolveClassStyle(
  classStyles: Record<string, AnnotationClassStyle> | undefined,
  classRef: string | undefined,
): AnnotationClassStyle | undefined {
  if (!classStyles || !classRef) return undefined;
  const exact = classStyles[classRef];
  if (exact) return exact;
  return classStyles[normalizeAlias(classRef)];
}
