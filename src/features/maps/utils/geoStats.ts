/**
 * Re-export from shared/geo.ts for backward compatibility.
 * All geo math now lives in the shared module. Import from there for new code.
 *
 * @deprecated Import from '@/features/maps/shared/geo' instead.
 */
export {
  haversineM,
  sphericalAreaM2,
  fmtLen,
  fmtArea,
  fmtCoord,
  bearingDeg,
  compassDir,
  computeGeoStats,
} from '@/features/maps/shared/geo';

export type { GeoStatFields } from '@/features/maps/shared/geo';
