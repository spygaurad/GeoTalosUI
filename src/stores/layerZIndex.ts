/**
 * Shared z-index counter for map layers.
 * Used by store slices that create layers (core, annotations, aoi).
 * Module-level so it persists across slice calls within a session.
 */
let _nextZIndex = 0;

export function getNextZIndex(): number {
  return _nextZIndex++;
}

export function resetZIndex(): void {
  _nextZIndex = 0;
}
