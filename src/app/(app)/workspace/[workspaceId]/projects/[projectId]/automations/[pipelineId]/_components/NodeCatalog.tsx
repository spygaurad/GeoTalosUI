'use client';

import { useState, useRef, useCallback, type DragEvent } from 'react';
import {
  Search,
  ChevronDown,
  ChevronRight,
  GripVertical,
  ArrowRight,
  ArrowLeft,
} from 'lucide-react';
import type { NodeCatalogEntry, NodeCatalogCategory } from '@/types/api';
import { CATEGORY_META } from '../../_constants';
import { DISPLAY_CATEGORY } from './frontend-display-nodes';

// ── Fixed-position tooltip (escapes overflow:hidden) ─────────────────────────

function useFixedTooltip(delay = 250) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const elRef = useRef<HTMLDivElement>(null);

  const onEnter = useCallback(() => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      if (elRef.current) {
        const rect = elRef.current.getBoundingClientRect();
        setPos({ x: rect.right + 8, y: rect.top });
      }
      setShow(true);
    }, delay);
  }, [delay]);

  const onLeave = useCallback(() => {
    clearTimeout(timeoutRef.current);
    setShow(false);
  }, []);

  return { show, pos, elRef, onEnter, onLeave };
}

// ── Catalog item tooltip ─────────────────────────────────────────────────────

function CatalogTooltip({ entry, x, y }: { entry: NodeCatalogEntry; x: number; y: number }) {
  const cat = CATEGORY_META[entry.category];
  const entryColor = entry.color ?? cat?.color ?? '#f5ede0';
  return (
    <div
      style={{
        position: 'fixed',
        left: `${x}px`,
        top: `${y}px`,
        width: '220px',
        backgroundColor: '#1e2218',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: '6px',
        padding: '10px 12px',
        zIndex: 9999,
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        pointerEvents: 'none',
      }}
    >
      {/* Arrow */}
      <div
        style={{
          position: 'absolute',
          left: '-5px',
          top: '12px',
          width: '8px',
          height: '8px',
          backgroundColor: '#1e2218',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRight: 'none',
          borderTop: 'none',
          transform: 'rotate(45deg)',
        }}
      />
      <div className="flex items-center gap-2 mb-1">
        <p style={{ fontSize: '11px', fontWeight: 600, color: entryColor }}>
          {entry.label}
        </p>
        {entry.status === 'placeholder' && (
          <span style={{ fontSize: '8px', fontWeight: 600, color: '#b0a090', backgroundColor: 'rgba(255,255,255,0.1)', padding: '1px 4px', borderRadius: '3px' }}>
            SOON
          </span>
        )}
      </div>
      <p style={{ fontSize: '10px', color: 'rgba(245,237,224,0.65)', lineHeight: 1.4, marginBottom: '8px' }}>
        {entry.description}
      </p>

      {entry.inputs.length > 0 && (
        <div style={{ marginBottom: '4px' }}>
          <p style={{ fontSize: '9px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(196,152,92,0.5)', marginBottom: '2px' }}>
            Inputs
          </p>
          {entry.inputs.map((inp) => (
            <div key={inp.handle} className="flex items-center gap-1" style={{ fontSize: '10px', color: 'rgba(245,237,224,0.5)' }}>
              <ArrowRight style={{ width: '8px', height: '8px', color: 'rgba(245,237,224,0.3)' }} />
              <span style={{ fontFamily: 'monospace', fontSize: '9px' }}>{inp.label ?? inp.handle}</span>
              <span style={{ color: 'rgba(245,237,224,0.3)' }}>({inp.type})</span>
              {inp.required && <span style={{ color: '#b35e4c', fontSize: '9px' }}>*</span>}
            </div>
          ))}
        </div>
      )}

      {entry.outputs.length > 0 && (
        <div>
          <p style={{ fontSize: '9px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(196,152,92,0.5)', marginBottom: '2px' }}>
            Outputs
          </p>
          {entry.outputs.map((out) => (
            <div key={out.handle} className="flex items-center gap-1" style={{ fontSize: '10px', color: 'rgba(245,237,224,0.5)' }}>
              <ArrowLeft style={{ width: '8px', height: '8px', color: 'rgba(245,237,224,0.3)' }} />
              <span style={{ fontFamily: 'monospace', fontSize: '9px' }}>{out.label ?? out.handle}</span>
              <span style={{ color: 'rgba(245,237,224,0.3)' }}>({out.type})</span>
            </div>
          ))}
        </div>
      )}

      {Object.keys(entry.config_schema).length > 0 && (
        <div style={{ marginTop: '4px', paddingTop: '4px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <p style={{ fontSize: '9px', color: 'rgba(245,237,224,0.35)' }}>
            {Object.keys(entry.config_schema).length} config field{Object.keys(entry.config_schema).length !== 1 ? 's' : ''}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Category tooltip (fixed position) ────────────────────────────────────────

function CategoryTooltipFixed({ text, x, y }: { text: string; x: number; y: number }) {
  return (
    <div
      style={{
        position: 'fixed',
        left: `${x}px`,
        top: `${y}px`,
        width: '180px',
        backgroundColor: '#1e2218',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: '5px',
        padding: '6px 8px',
        zIndex: 9999,
        boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: '-4px',
          top: '8px',
          width: '7px',
          height: '7px',
          backgroundColor: '#1e2218',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRight: 'none',
          borderTop: 'none',
          transform: 'rotate(45deg)',
        }}
      />
      <p style={{ fontSize: '10px', color: 'rgba(245,237,224,0.6)', lineHeight: 1.35, margin: 0 }}>
        {text}
      </p>
    </div>
  );
}

// ── Catalog item ────────────────────────────────────────────────────────────

function CatalogItem({ entry }: { entry: NodeCatalogEntry }) {
  const cat = CATEGORY_META[entry.category];
  const color = entry.color ?? cat?.color ?? '#f5ede0';
  const { show, pos, elRef, onEnter, onLeave } = useFixedTooltip(250);

  function onDragStart(e: DragEvent) {
    e.dataTransfer.setData('application/reactflow-node', JSON.stringify(entry));
    e.dataTransfer.effectAllowed = 'move';
    onLeave();
  }

  return (
    <div ref={elRef} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <div
        draggable
        onDragStart={onDragStart}
        className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-grab active:cursor-grabbing transition-colors"
        style={{ backgroundColor: 'transparent' }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.06)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
        }}
      >
        <GripVertical className="w-3 h-3 shrink-0" style={{ color: 'rgba(245,237,224,0.25)' }} />
        <span
          className="truncate"
          style={{
            fontSize: '12px',
            fontWeight: 500,
            color,
            opacity: entry.status === 'placeholder' ? 0.5 : 1,
          }}
        >
          {entry.label}
        </span>
        {entry.status === 'placeholder' && (
          <span
            className="ml-auto shrink-0"
            style={{ fontSize: '8px', color: 'rgba(245,237,224,0.3)' }}
          >
            soon
          </span>
        )}
      </div>

      {show && <CatalogTooltip entry={entry} x={pos.x} y={pos.y} />}
    </div>
  );
}

// ── Category section ────────────────────────────────────────────────────────

function CategorySection({
  category,
  entries,
  defaultOpen,
  categoryLabel,
}: {
  category: string;
  entries: NodeCatalogEntry[];
  defaultOpen: boolean;
  categoryLabel?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const cat = CATEGORY_META[category] ?? { label: categoryLabel ?? category, color: '#9a8878' };
  const { show: showTip, pos: tipPos, elRef: tipRef, onEnter: tipEnter, onLeave: tipLeave } = useFixedTooltip(200);

  const categoryDescriptions: Record<string, string> = {
    trigger: 'Pipeline entry points — events that start a workflow run',
    triggers: 'Pipeline entry points — events that start a workflow run',
    data_source: 'Nodes that select or filter datasets, annotation sets, and STAC items',
    ml_annotation: 'Machine learning inference, post-processing, and annotation creation',
    analysis: 'Spectral indices, change detection, zonal statistics, and spatial analysis',
    quality: 'IoU comparison, confusion matrices, annotator agreement, and quality gates',
    iou_quality: 'IoU comparison, confusion matrices, annotator agreement, and quality gates',
    output: 'Map overlays, exports, reports, email alerts, and webhooks',
    map_overlay: 'Map overlays, exports, and visualization',
    data_ops: 'Filter, merge, route, and transition annotation data',
    data_operations: 'Filter, merge, route, and transition annotation data',
    advanced: 'Multi-sensor fusion, cloud masking, and specialized workflows',
    display: 'Frontend-only viewer nodes — live data cards, JSON inspector, stats display',
  };

  return (
    <div className="mb-1">
      <div ref={tipRef} onMouseEnter={tipEnter} onMouseLeave={tipLeave}>
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center justify-between w-full px-2 py-1.5 rounded-md transition-colors"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: cat.color,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.04)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
          }}
        >
          <span
            style={{
              fontSize: '10px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            {categoryLabel ?? cat.label}
          </span>
          <span
            className="flex items-center gap-1"
            style={{ fontSize: '10px', color: 'rgba(245,237,224,0.3)' }}
          >
            {entries.length}
            {open ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </span>
        </button>

        {showTip && categoryDescriptions[category] && (
          <CategoryTooltipFixed text={categoryDescriptions[category]} x={tipPos.x} y={tipPos.y} />
        )}
      </div>

      {open && (
        <div className="mt-0.5 space-y-0.5">
          {entries.map((entry) => (
            <CatalogItem key={entry.type} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────

interface NodeCatalogProps {
  categories: NodeCatalogCategory[];
  isLoading?: boolean;
  isError?: boolean;
}

export function NodeCatalog({ categories, isLoading, isError }: NodeCatalogProps) {
  const [search, setSearch] = useState('');

  // Filter out placeholder nodes — only show implemented/available nodes
  // Append the frontend-only display category at the end
  const availableCategories = [
    ...categories
      .map((c) => ({ ...c, nodes: c.nodes.filter((n) => n.status !== 'placeholder') }))
      .filter((c) => c.nodes.length > 0),
    DISPLAY_CATEGORY,
  ];

  // Flatten for search, then re-group
  const allNodes = availableCategories.flatMap((c) => c.nodes);

  const filtered = search
    ? allNodes.filter(
        (e) =>
          e.label.toLowerCase().includes(search.toLowerCase()) ||
          e.description.toLowerCase().includes(search.toLowerCase()),
      )
    : null;

  return (
    <aside
      className="flex flex-col h-full shrink-0"
      style={{
        width: '210px',
        backgroundColor: '#2e3428',
        borderRight: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      {/* Header */}
      <div
        className="px-3 py-3 shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}
      >
        <p
          style={{
            fontSize: '10px',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'rgba(196,152,92,0.5)',
            marginBottom: '6px',
          }}
        >
          Nodes
        </p>
        <div
          className="flex items-center gap-1.5 px-2 rounded-md"
          style={{
            border: '1px solid rgba(255,255,255,0.1)',
            backgroundColor: 'rgba(255,255,255,0.04)',
          }}
        >
          <Search
            className="w-3 h-3 shrink-0"
            style={{ color: 'rgba(245,237,224,0.4)' }}
          />
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent py-1.5 outline-none"
            style={{ fontSize: '11px', color: '#f5ede0' }}
          />
        </div>
      </div>

      {/* Categories */}
      <div className="flex-1 overflow-y-auto px-1.5 py-2 space-y-0.5">
        {isError ? (
          <div className="px-3 py-8 text-center">
            <p style={{ fontSize: '11px', color: '#b35e4c', marginBottom: '4px' }}>
              Failed to load nodes
            </p>
            <p style={{ fontSize: '10px', color: 'rgba(245,237,224,0.4)' }}>
              Check your connection and reload
            </p>
          </div>
        ) : isLoading ? (
          <div className="px-2 py-4 space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="animate-pulse">
                <div className="h-3 rounded" style={{ width: '60%', backgroundColor: 'rgba(255,255,255,0.08)' }} />
                <div className="mt-2 space-y-1.5">
                  <div className="h-2.5 rounded" style={{ width: '80%', backgroundColor: 'rgba(255,255,255,0.05)' }} />
                  <div className="h-2.5 rounded" style={{ width: '65%', backgroundColor: 'rgba(255,255,255,0.05)' }} />
                </div>
              </div>
            ))}
          </div>
        ) : filtered ? (
          // Search results — group by category
          (() => {
            const grouped = filtered.reduce(
              (acc, entry) => {
                (acc[entry.category] ??= []).push(entry);
                return acc;
              },
              {} as Record<string, NodeCatalogEntry[]>,
            );
            const cats = Object.keys(grouped);
            return cats.length > 0 ? (
              cats.map((catName) => (
                <CategorySection
                  key={catName}
                  category={catName}
                  entries={grouped[catName]}
                  defaultOpen
                />
              ))
            ) : (
              <p style={{ fontSize: '11px', color: 'rgba(245,237,224,0.4)', padding: '12px 8px' }}>
                No nodes found.
              </p>
            );
          })()
        ) : (
          // Normal: render in API category order (placeholder nodes hidden)
          availableCategories.map((cat, i) => (
            <CategorySection
              key={cat.name}
              category={cat.name}
              entries={cat.nodes}
              defaultOpen={i < 3}
              categoryLabel={cat.label}
            />
          ))
        )}

        {!isLoading && availableCategories.length === 0 && !filtered && (
          <p
            style={{
              fontSize: '11px',
              color: 'rgba(245,237,224,0.4)',
              padding: '12px 8px',
            }}
          >
            No nodes available.
          </p>
        )}
      </div>

      {/* ── Recipe guide ── */}
      {!isLoading && <RecipeGuide />}
    </aside>
  );
}

// ── Pipeline recipe guide ─────────────────────────────────────────────────────

const RECIPES: {
  title: string;
  description: string;
  nodes: string[];
}[] = [
  {
    title: 'Overlay dataset on map',
    description: 'Add raster data as a map layer',
    nodes: ['manual_trigger', 'select_dataset', 'overlay_dataset_on_map'],
  },
  {
    title: 'Export dataset items',
    description: 'Export items as downloadable GeoJSON',
    nodes: ['manual_trigger', 'select_dataset_items', 'export_dataset_items'],
  },
  {
    title: 'ML inference to map',
    description: 'Run a model, display predictions on map',
    nodes: ['select_dataset_items', 'select_model', 'run_inference', 'post_processing', 'create_annotation_set', 'overlay_on_map'],
  },
  {
    title: 'STAC search + AOI filter',
    description: 'Search catalog imagery, filter by area',
    nodes: ['manual_trigger', 'stac_search', 'aoi_filter', 'export_dataset_items'],
  },
  {
    title: 'Ground truth QA',
    description: 'Compare predictions vs ground truth',
    nodes: ['select_annotation_set', 'select_annotation_set', 'ground_truth_comparison', 'iou_threshold_gate', 'export_annotations'],
  },
  {
    title: 'Filter + export annotations',
    description: 'Filter by label/confidence, export matched',
    nodes: ['select_annotation_set', 'filter_annotations', 'export_annotations'],
  },
  {
    title: 'Duplicate cleanup',
    description: 'Find and export duplicate annotations',
    nodes: ['select_annotation_set', 'duplicate_detection', 'export_annotations'],
  },
  {
    title: 'Scheduled monitoring',
    description: 'Weekly inference + area report via webhook',
    nodes: ['schedule_trigger', 'select_dataset_items', 'select_model', 'run_inference', 'post_processing', 'create_annotation_set', 'area_calculation', 'send_webhook'],
  },
  {
    title: 'Auto-overlay on ingest',
    description: 'Add datasets to map when ingestion completes',
    nodes: ['dataset_ingested_trigger', 'overlay_dataset_on_map', 'send_webhook'],
  },
  {
    title: 'Change detection alert',
    description: 'Detect changes between two dates, alert if threshold exceeded',
    nodes: ['manual_trigger', 'select_dataset', 'select_dataset', 'change_detection', 'generate_report', 'send_email'],
  },
  {
    title: 'Merge + style annotations',
    description: 'Combine annotation sets, style on map',
    nodes: ['select_annotation_set', 'select_annotation_set', 'merge_annotation_sets', 'overlay_on_map', 'style_assignment'],
  },
];

function RecipeGuide() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="shrink-0"
      style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full px-3 py-2.5 transition-colors"
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'rgba(196,152,92,0.5)',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.03)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
        }}
      >
        <span style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Pipeline recipes
        </span>
        <span style={{ fontSize: '10px', color: 'rgba(245,237,224,0.3)' }}>
          {expanded ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
        </span>
      </button>

      {expanded && (
        <div
          className="overflow-y-auto px-2 pb-2 space-y-1"
          style={{ maxHeight: '320px' }}
        >
          {RECIPES.map((recipe, i) => (
            <RecipeCard key={i} recipe={recipe} />
          ))}
        </div>
      )}
    </div>
  );
}

function RecipeCard({ recipe }: { recipe: typeof RECIPES[number] }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="rounded-md px-2.5 py-2 transition-colors"
      style={{
        backgroundColor: hovered ? 'rgba(255,255,255,0.05)' : 'transparent',
        cursor: 'default',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <p style={{ fontSize: '11px', fontWeight: 600, color: '#f5ede0', marginBottom: '2px' }}>
        {recipe.title}
      </p>
      <p style={{ fontSize: '9px', color: 'rgba(245,237,224,0.45)', marginBottom: '5px', lineHeight: 1.3 }}>
        {recipe.description}
      </p>
      <div className="flex items-center flex-wrap gap-x-0.5 gap-y-1">
        {recipe.nodes.map((node, j) => (
          <span key={j} className="flex items-center">
            <span
              style={{
                fontSize: '8px',
                fontFamily: 'monospace',
                padding: '1px 4px',
                borderRadius: '2px',
                backgroundColor: 'rgba(196,152,92,0.12)',
                color: 'rgba(196,152,92,0.7)',
                whiteSpace: 'nowrap',
              }}
            >
              {node.replace(/_/g, ' ')}
            </span>
            {j < recipe.nodes.length - 1 && (
              <span style={{ fontSize: '8px', color: 'rgba(245,237,224,0.2)', margin: '0 1px' }}>→</span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
