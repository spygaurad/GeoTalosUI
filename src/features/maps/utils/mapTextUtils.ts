/**
 * Shared text utility functions for map UI components.
 */

export function asNonEmptyText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function getClassDescription(
  cls: { description?: string | null; properties?: Record<string, unknown> | null },
): string | undefined {
  return asNonEmptyText(cls.description) ?? asNonEmptyText(cls.properties?.description);
}
