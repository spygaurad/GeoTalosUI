/**
 * Measurement Slice
 *
 * Manages the measurement tool state: activation toggle,
 * collected measurement points, and cleanup actions.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createMeasurementSlice(set: any, _get: any) {
  return {
    // ── State ──────────────────────────────────────────────────────────────
    measurementActive: false,
    measurementPoints: [] as [number, number][],

    // ── Actions ────────────────────────────────────────────────────────────
    toggleMeasurement: () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      set((s: any) => {
        const newActive = !s.measurementActive;
        return {
          measurementActive: newActive,
          measurementPoints: [],
          rightPanelMode: newActive
            ? 'measurement'
            : s.rightPanelMode === 'measurement'
              ? 'none'
              : s.rightPanelMode,
        };
      }),

    addMeasurementPoint: (pt: [number, number]) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      set((s: any) => ({ measurementPoints: [...s.measurementPoints, pt] })),

    clearMeasurement: () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      set((s: any) => ({
        measurementPoints: [],
        measurementActive: false,
        rightPanelMode: s.rightPanelMode === 'measurement' ? 'none' : s.rightPanelMode,
      })),

    clearMeasurementPoints: () =>
      set({ measurementPoints: [] }),
  };
}
