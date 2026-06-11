'use client';

import { createContext, useContext } from 'react';

interface PipelineContextValue {
  projectId: string;
  workspaceId: string;
  /** The persisted pipeline id, or null while the pipeline is still unsaved
   *  (display/report nodes can't fetch run data until there's an id). */
  pipelineId: string | null;
}

const PipelineContext = createContext<PipelineContextValue | null>(null);

export function PipelineProvider({
  projectId,
  workspaceId,
  pipelineId,
  children,
}: PipelineContextValue & { children: React.ReactNode }) {
  return (
    <PipelineContext.Provider value={{ projectId, workspaceId, pipelineId }}>
      {children}
    </PipelineContext.Provider>
  );
}

export function usePipelineContext() {
  const ctx = useContext(PipelineContext);
  if (!ctx) throw new Error('usePipelineContext must be used within PipelineProvider');
  return ctx;
}
