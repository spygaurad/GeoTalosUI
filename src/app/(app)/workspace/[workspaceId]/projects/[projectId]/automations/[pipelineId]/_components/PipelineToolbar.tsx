'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Save,
  Play,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Loader2,
  Pencil,
  Check,
  X,
  History,
} from 'lucide-react';
import type { PipelineStatus } from '@/types/api';

const STATUS_DOT: Record<PipelineStatus, string> = {
  active: '#656d4a',
  draft: '#9a8878',
  paused: '#a68a64',
  archived: '#b0a090',
};

interface PipelineToolbarProps {
  pipelineName: string;
  pipelineStatus: PipelineStatus;
  workspaceId: string;
  projectId: string;
  onSave: () => void;
  onRun: () => void;
  onNameChange: (name: string) => void;
  onToggleRuns?: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
  isSaving?: boolean;
  isRunning?: boolean;
  showRuns?: boolean;
}

export function PipelineToolbar({
  pipelineName,
  pipelineStatus,
  workspaceId,
  projectId,
  onSave,
  onRun,
  onNameChange,
  onToggleRuns,
  onZoomIn,
  onZoomOut,
  onFitView,
  isSaving,
  isRunning,
  showRuns,
}: PipelineToolbarProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(pipelineName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(pipelineName);
      // Focus after render
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [editing, pipelineName]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== pipelineName) {
      onNameChange(trimmed);
    }
    setEditing(false);
  };

  const cancel = () => {
    setDraft(pipelineName);
    setEditing(false);
  };

  return (
    <header
      className="flex items-center justify-between px-4 shrink-0"
      style={{
        height: '48px',
        backgroundColor: '#fefcf9',
        borderBottom: '1px solid #e0d4c4',
      }}
    >
      {/* Left */}
      <div className="flex items-center gap-3 min-w-0" style={{ flex: '1 1 0' }}>
        <Link
          href={`/workspace/${workspaceId}/projects/${projectId}/automations`}
          className="flex items-center justify-center shrink-0 rounded-md p-1.5 transition-colors hover:bg-[#ede0d4]"
          style={{ color: '#7f5539' }}
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>

        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: STATUS_DOT[pipelineStatus] }}
          />

          {editing ? (
            <div className="flex items-center gap-1">
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commit();
                  if (e.key === 'Escape') cancel();
                }}
                onBlur={commit}
                className="outline-none rounded px-1.5 py-0.5"
                style={{
                  fontSize: '0.9375rem',
                  fontWeight: 600,
                  color: '#2e3428',
                  backgroundColor: '#f5ede0',
                  border: '1px solid #c4985c',
                  width: `${Math.max(120, draft.length * 9)}px`,
                  maxWidth: '300px',
                }}
              />
              <button
                onMouseDown={(e) => { e.preventDefault(); commit(); }}
                className="p-0.5 rounded hover:bg-[#ede0d4]"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#656d4a' }}
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                onMouseDown={(e) => { e.preventDefault(); cancel(); }}
                className="p-0.5 rounded hover:bg-[#ede0d4]"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9a8878' }}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="group flex items-center gap-1.5 min-w-0 rounded px-1 py-0.5 transition-colors hover:bg-[#f5ede0]"
              style={{ background: 'none', border: 'none', cursor: 'pointer' }}
              title="Click to rename"
            >
              <h1
                className="truncate"
                style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#2e3428' }}
              >
                {pipelineName}
              </h1>
              <Pencil
                className="w-3 h-3 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ color: '#9a8878' }}
              />
            </button>
          )}
        </div>
      </div>

      {/* Center — zoom controls */}
      <div className="flex items-center gap-1">
        <button
          onClick={onZoomOut}
          className="p-1.5 rounded-md transition-colors hover:bg-[#ede0d4]"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7f5539' }}
          title="Zoom out"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onZoomIn}
          className="p-1.5 rounded-md transition-colors hover:bg-[#ede0d4]"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7f5539' }}
          title="Zoom in"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onFitView}
          className="p-1.5 rounded-md transition-colors hover:bg-[#ede0d4]"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7f5539' }}
          title="Fit to view"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Right */}
      <div className="flex items-center gap-2" style={{ flex: '1 1 0', justifyContent: 'flex-end' }}>
        {onToggleRuns && (
          <button
            onClick={onToggleRuns}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md transition-all hover:bg-[#ede0d4]"
            style={{
              fontSize: '0.8125rem',
              fontWeight: 500,
              color: showRuns ? '#7f5539' : '#9a8878',
              backgroundColor: showRuns ? '#ede0d4' : 'transparent',
              border: 'none',
              cursor: 'pointer',
            }}
            title="Toggle run history"
          >
            <History className="w-3.5 h-3.5" />
            Runs
          </button>
        )}
        <button
          onClick={onSave}
          disabled={isSaving}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all hover:opacity-90 disabled:opacity-50"
          style={{
            fontSize: '0.8125rem',
            fontWeight: 500,
            color: '#7f5539',
            backgroundColor: '#ede0d4',
            border: 'none',
            cursor: isSaving ? 'default' : 'pointer',
          }}
        >
          {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {isSaving ? 'Saving...' : 'Save'}
        </button>
        <button
          onClick={onRun}
          disabled={isRunning}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all hover:opacity-90 disabled:opacity-50"
          style={{
            fontSize: '0.8125rem',
            fontWeight: 600,
            color: '#f5ede0',
            backgroundColor: '#7f5539',
            border: 'none',
            cursor: isRunning ? 'default' : 'pointer',
          }}
        >
          {isRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
          {isRunning ? 'Running...' : 'Run'}
        </button>
      </div>
    </header>
  );
}
