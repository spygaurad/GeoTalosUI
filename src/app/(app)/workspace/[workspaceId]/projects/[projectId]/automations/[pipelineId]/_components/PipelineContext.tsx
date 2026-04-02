'use client';

import { createContext, useContext } from 'react';

interface PipelineContextValue {
  projectId: string;
  workspaceId: string;
}

const PipelineContext = createContext<PipelineContextValue | null>(null);

export function PipelineProvider({
  projectId,
  workspaceId,
  children,
}: PipelineContextValue & { children: React.ReactNode }) {
  return (
    <PipelineContext.Provider value={{ projectId, workspaceId }}>
      {children}
    </PipelineContext.Provider>
  );
}

export function usePipelineContext() {
  const ctx = useContext(PipelineContext);
  if (!ctx) throw new Error('usePipelineContext must be used within PipelineProvider');
  return ctx;
}
