'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  MousePointer2,
  Hand,
  MapPin,
  Minus,
  Pentagon,
  Square,
  Circle,
  Ruler,
  Layers,
  ChevronDown,
  Share2,
  ArrowLeft,
  BookOpen,
  PenLine,
  ChevronRight,
  Check,
  X,
  BoxSelect,
} from 'lucide-react';
import { toast } from 'sonner';
import type { BasemapId, DrawTool } from '@/stores/mapStore';
import { MC, MAP_Z } from '../mapColors';
import { useIsCompact } from '@/hooks/use-mobile';

export type ActiveTool = 'select' | 'pan' | DrawTool | 'measure';

const DRAW_TOOLS: { id: DrawTool; icon: React.ReactNode; label: string; hint: string }[] = [
  { id: 'point',     icon: <MapPin size={14} />,    label: 'Point',     hint: '1' },
  { id: 'polyline',  icon: <Minus size={14} />,     label: 'Line',      hint: '2' },
  { id: 'polygon',   icon: <Pentagon size={14} />,  label: 'Polygon',   hint: '3' },
  { id: 'rectangle', icon: <Square size={14} />,    label: 'Rectangle', hint: '4' },
  { id: 'circle',    icon: <Circle size={14} />,    label: 'Circle',    hint: '5' },
];

// ─── ToolBtn — for dark nav background ───────────────────────────────────────
function ToolBtn({
  icon,
  label,
  active,
  onClick,
  shortcut,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  shortcut?: string;
}) {
  return (
    <button
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      aria-pressed={active}
      aria-keyshortcuts={shortcut}
      onClick={onClick}
      style={{
        width: 34,
        height: 34,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 5,
        border: active ? `1.5px solid ${MC.navAccent}` : '1px solid transparent',
        background: active ? MC.navActiveBtn : 'transparent',
        color: active ? MC.navAccent : MC.navText,
        cursor: 'pointer',
        flexShrink: 0,
        transition: 'background 0.1s, color 0.1s, border-color 0.1s',
        opacity: active ? 1 : 0.7,
      }}
    >
      {icon}
    </button>
  );
}

function ToolDivider() {
  return (
    <div style={{ width: 1, height: 18, background: MC.navBorder, flexShrink: 0, margin: '0 4px' }} />
  );
}

// ─── Annotate dropdown ────────────────────────────────────────────────────────
function AnnotateDropdown({
  activeTool,
  onToolChange,
}: {
  activeTool: ActiveTool;
  onToolChange: (t: ActiveTool) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const isDrawing = DRAW_TOOLS.some((t) => t.id === activeTool);
  const activeDrawTool = DRAW_TOOLS.find((t) => t.id === activeTool);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title={activeDrawTool ? `Annotate — ${activeDrawTool.label}` : 'Annotate'}
        aria-label={activeDrawTool ? `Annotate — ${activeDrawTool.label}` : 'Annotate'}
        aria-expanded={open}
        aria-haspopup="true"
        aria-pressed={isDrawing}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          height: 34,
          padding: '0 8px',
          borderRadius: 5,
          border: isDrawing || open ? `1.5px solid ${MC.navAccent}` : '1px solid transparent',
          background: isDrawing || open ? MC.navActiveBtn : 'transparent',
          color: isDrawing || open ? MC.navAccent : MC.navText,
          cursor: 'pointer',
          opacity: isDrawing || open ? 1 : 0.75,
          flexShrink: 0,
          transition: 'all 0.1s',
        }}
      >
        <PenLine size={14} />
        {activeDrawTool && (
          <div style={{
            width: 5, height: 5, borderRadius: '50%',
            background: MC.navAccent, flexShrink: 0,
          }} />
        )}
        <ChevronDown size={11} style={{ color: MC.navTextMuted }} />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: '50%',
            transform: 'translateX(-50%)',
            background: MC.panelBg,
            border: `1px solid ${MC.panelBorder}`,
            borderRadius: 8,
            padding: 8,
            display: 'flex',
            gap: 4,
            zIndex: MAP_Z.menu,
            boxShadow: MC.shadowMd,
          }}
        >
          {DRAW_TOOLS.map((tool) => (
            <button
              key={tool.id}
              title={`${tool.label} (${tool.hint})`}
              aria-label={`${tool.label} (${tool.hint})`}
              aria-pressed={activeTool === tool.id}
              aria-keyshortcuts={tool.hint}
              onClick={() => {
                onToolChange(tool.id);
                setOpen(false);
              }}
              style={{
                width: 48,
                height: 52,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                borderRadius: 6,
                border: activeTool === tool.id ? `1.5px solid ${MC.accent}` : `1px solid transparent`,
                background: activeTool === tool.id ? MC.accentDim : 'transparent',
                color: activeTool === tool.id ? MC.accent : MC.textMuted,
                cursor: 'pointer',
                transition: 'all 0.1s',
              }}
            >
              {tool.icon}
              <span style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.02em' }}>
                {tool.label}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Layers + Basemap — merged dropdown ──────────────────────────────────────
const BASEMAP_LABELS: Record<BasemapId, string> = {
  osm: 'Voyager',
  satellite: 'Satellite',
  light: 'Light',
  dark: 'Dark',
};
const BASEMAP_SWATCHES: Record<BasemapId, string> = {
  osm: '#8fb878',
  satellite: '#2a4a2a',
  light: '#d8d0c0',
  dark: '#242830',
};

function LayersMapDropdown({
  activeId,
  open,
  onToggle,
  onSelect,
}: {
  activeId: BasemapId;
  open: boolean;
  onToggle: () => void;
  onSelect: (id: BasemapId) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onToggle();
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open, onToggle]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={onToggle}
        title={`Basemap: ${BASEMAP_LABELS[activeId]}`}
        aria-label={`Basemap: ${BASEMAP_LABELS[activeId]}`}
        aria-expanded={open}
        aria-haspopup="true"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          height: 30,
          padding: '0 9px',
          borderRadius: 5,
          border: `1px solid ${open ? MC.navAccent : 'transparent'}`,
          background: open ? MC.navActiveBtn : 'transparent',
          color: open ? MC.navAccent : MC.navText,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          transition: 'all 0.1s',
          opacity: open ? 1 : 0.75,
        }}
      >
        <Layers size={13} />
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: 2,
            background: BASEMAP_SWATCHES[activeId],
            flexShrink: 0,
            border: '1px solid rgba(255,255,255,0.12)',
          }}
        />
        <ChevronDown size={10} />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            background: MC.panelBg,
            border: `1px solid ${MC.panelBorder}`,
            borderRadius: 8,
            overflow: 'hidden',
            minWidth: 160,
            zIndex: MAP_Z.dropdown,
            boxShadow: MC.shadowMd,
          }}
        >
          {/* Section header */}
          <div style={{
            padding: '7px 12px 5px',
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: MC.sectionLabel,
            borderBottom: `1px solid ${MC.border}`,
          }}>
            Basemap
          </div>

          {(Object.entries(BASEMAP_LABELS) as [BasemapId, string][]).map(([id, label]) => (
            <button
              key={id}
              aria-label={label}
              aria-pressed={id === activeId}
              onClick={() => { onSelect(id); onToggle(); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                padding: '8px 12px',
                background: id === activeId ? MC.accentDim : 'transparent',
                color: id === activeId ? MC.accent : MC.text,
                cursor: 'pointer',
                fontSize: 13,
                borderBottom: `1px solid ${MC.border}`,
                transition: 'background 0.1s',
              }}
            >
              <div
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 3,
                  background: BASEMAP_SWATCHES[id],
                  border: `1px solid ${MC.border}`,
                  flexShrink: 0,
                }}
              />
              {label}
              {id === activeId && (
                <div style={{
                  marginLeft: 'auto',
                  width: 6, height: 6,
                  borderRadius: '50%',
                  background: MC.accent,
                }} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── MapTopNav ────────────────────────────────────────────────────────────────
export interface MapTopNavProps {
  workspaceId: string;
  projectId: string;
  mapName: string;
  editingName: boolean;
  onStartEdit: () => void;
  onSaveName: (name: string) => void;
  onCancelEdit: () => void;
  activeTool: ActiveTool;
  onToolChange: (t: ActiveTool) => void;
  libraryOpen: boolean;
  onLibraryToggle: () => void;
  basemapOpen: boolean;
  onBasemapToggle: () => void;
  activeBasemapId: BasemapId;
  onBasemapSelect: (id: BasemapId) => void;
  measurementActive: boolean;
  onMeasurementToggle: () => void;
  aoiDrawMode?: boolean;
  onAoiToolClick?: () => void;
}

export function MapTopNav({
  workspaceId,
  projectId,
  mapName,
  editingName,
  onStartEdit,
  onSaveName,
  onCancelEdit,
  activeTool,
  onToolChange,
  libraryOpen,
  onLibraryToggle,
  basemapOpen,
  onBasemapToggle,
  activeBasemapId,
  onBasemapSelect,
  measurementActive,
  onMeasurementToggle,
  aoiDrawMode,
  onAoiToolClick,
}: MapTopNavProps) {
  const router = useRouter();
  const isCompact = useIsCompact();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [draftName, setDraftName] = useState(mapName);

  useEffect(() => { setDraftName(mapName); }, [mapName]);
  useEffect(() => {
    if (editingName) nameInputRef.current?.focus();
  }, [editingName]);

  return (
    <div
      style={{
        height: 48,
        background: MC.navBg,
        borderBottom: `1px solid ${MC.navBorder}`,
        display: 'flex',
        alignItems: 'center',
        padding: '0 8px',
        gap: 4,
        boxShadow: MC.shadow,
        // overflow must stay visible — AnnotateDropdown and LayersMapDropdown
        // render absolutely-positioned popups that extend below this bar.
        // Narrow-screen wrapping is prevented by flex-shrink on children instead.
        minWidth: 0,
      }}
    >
      {/* Left — back + map name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, flex: '0 0 auto', minWidth: 0 }}>
        <button
          onClick={() => router.push(`/workspace/${workspaceId}/projects/${projectId}`)}
          title="Back to project"
          aria-label="Back to project"
          style={{
            width: 30,
            height: 30,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 5,
            border: 'none',
            background: 'transparent',
            color: MC.navTextMuted,
            cursor: 'pointer',
          }}
        >
          <ArrowLeft size={16} />
        </button>

        <ChevronRight size={12} style={{ color: MC.navBorder, flexShrink: 0 }} />

        {editingName ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <input
              ref={nameInputRef}
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); onSaveName(draftName); }
                if (e.key === 'Escape') onCancelEdit();
              }}
              aria-label="Map name — press Enter to save, Escape to cancel"
              style={{
                background: 'rgba(255,255,255,0.08)',
                border: `1.5px solid ${MC.navAccent}`,
                borderRadius: 4,
                color: MC.navText,
                fontSize: 13,
                fontWeight: 600,
                padding: '2px 7px',
                outline: 'none',
                // Narrower input on compact screens
                width: isCompact ? 110 : 160,
              }}
            />
            <button
              onClick={() => onSaveName(draftName)}
              title="Save (Enter)"
              aria-label="Save map name"
              style={{
                width: 24, height: 24,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 4, border: `1px solid ${MC.navAccent}`,
                background: MC.navActiveBtn, color: MC.navAccent,
                cursor: 'pointer', flexShrink: 0,
              }}
            >
              <Check size={11} />
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={onCancelEdit}
              title="Cancel (Escape)"
              aria-label="Cancel renaming"
              style={{
                width: 24, height: 24,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 4, border: `1px solid ${MC.navBorder}`,
                background: 'transparent', color: MC.navTextMuted,
                cursor: 'pointer', flexShrink: 0,
              }}
            >
              <X size={11} />
            </button>
          </div>
        ) : (
          <button
            onClick={onStartEdit}
            title="Click to rename"
            style={{
              background: 'transparent',
              border: '1px solid transparent',
              borderRadius: 4,
              color: MC.navText,
              fontSize: 13,
              fontWeight: 600,
              padding: '2px 7px',
              cursor: 'text',
              // Tighter name truncation on compact to preserve tool space
              maxWidth: isCompact ? 100 : 200,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {mapName || 'Untitled Map'}
          </button>
        )}
      </div>

      {/* Center — tools */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          flex: 1,
          justifyContent: 'center',
        }}
      >
        <ToolBtn
          icon={<MousePointer2 size={15} />}
          label="Select"
          shortcut="S"
          active={activeTool === 'select'}
          onClick={() => onToolChange('select')}
        />
        <ToolBtn
          icon={<Hand size={15} />}
          label="Pan"
          shortcut="P"
          active={activeTool === 'pan'}
          onClick={() => onToolChange('pan')}
        />

        <ToolDivider />

        <AnnotateDropdown activeTool={activeTool} onToolChange={onToolChange} />

        <ToolDivider />

        <ToolBtn
          icon={<Ruler size={15} />}
          label="Measure distance"
          shortcut="M"
          active={activeTool === 'measure' || measurementActive}
          onClick={onMeasurementToggle}
        />

        {onAoiToolClick && (
          <>
            <ToolDivider />
            <ToolBtn
              icon={<BoxSelect size={15} />}
              label="Area of Interest"
              shortcut="A"
              active={aoiDrawMode ?? false}
              onClick={onAoiToolClick}
            />
          </>
        )}
      </div>

      {/* Right — Library, Layers+Map, Share */}
      <div style={{ display: 'flex', alignItems: 'center', gap: isCompact ? 3 : 5, flex: '0 0 auto' }}>
        {/* Library — icon+label on desktop, icon-only on compact */}
        <button
          onClick={onLibraryToggle}
          title="Library — add datasets & data sources"
          aria-label="Library — add datasets & data sources"
          aria-pressed={libraryOpen}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            height: 30,
            padding: isCompact ? '0 8px' : '0 10px',
            borderRadius: 5,
            border: `1px solid ${libraryOpen ? MC.navAccent : 'transparent'}`,
            background: libraryOpen ? MC.navActiveBtn : 'transparent',
            color: libraryOpen ? MC.navAccent : MC.navText,
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: '0.02em',
            whiteSpace: 'nowrap',
            transition: 'all 0.1s',
            opacity: libraryOpen ? 1 : 0.75,
          }}
        >
          <BookOpen size={14} />
          {/* Hide label on compact — icon communicates intent */}
          {!isCompact && 'Library'}
        </button>

        {/* Merged Layers + Basemap */}
        <LayersMapDropdown
          activeId={activeBasemapId}
          open={basemapOpen}
          onToggle={onBasemapToggle}
          onSelect={onBasemapSelect}
        />

        {/* Share — icon+label on desktop, icon-only on compact */}
        <button
          onClick={() => toast.info('Sharing coming soon')}
          title="Share"
          aria-label="Share this map"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            height: 30,
            padding: isCompact ? '0 8px' : '0 12px',
            borderRadius: 5,
            border: `1px solid ${MC.navAccent}`,
            background: MC.navActiveBtn,
            color: MC.navAccent,
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.03em',
            whiteSpace: 'nowrap',
          }}
        >
          <Share2 size={13} />
          {!isCompact && 'Share'}
        </button>
      </div>
    </div>
  );
}
