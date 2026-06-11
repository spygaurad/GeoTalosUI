/**
 * Re-export from core/useMapSync.
 *
 * The implementation has been decomposed into the modular architecture:
 * - Core layer sync: src/features/maps/core/useMapSync.ts
 * - Annotation sync: src/features/maps/modules/annotations/sync.ts
 * - Timeline sync:   src/features/maps/modules/timeline/sync.ts
 * - AOI sync:        src/features/maps/modules/aoi/sync.ts
 */
export { useMapSync } from '../core/useMapSync';
