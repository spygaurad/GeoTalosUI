import { create } from 'zustand';

interface JobStoreState {
  activeJobIds: string[];
  addJob: (jobId: string) => void;
  removeJob: (jobId: string) => void;
  hasActiveJobs: () => boolean;
}

export const useJobStore = create<JobStoreState>((set, get) => ({
  activeJobIds: [],

  addJob: (jobId) =>
    set((s) => ({
      activeJobIds: s.activeJobIds.includes(jobId)
        ? s.activeJobIds
        : [...s.activeJobIds, jobId],
    })),

  removeJob: (jobId) =>
    set((s) => ({
      activeJobIds: s.activeJobIds.filter((id) => id !== jobId),
    })),

  hasActiveJobs: () => get().activeJobIds.length > 0,
}));
