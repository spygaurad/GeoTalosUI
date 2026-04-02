'use client';

import { useState, useCallback } from 'react';
import { Layers, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { LayerCard } from './LayerCard';
import type { Dataset, Annotation, TrackedObject, Alert, AnnotationSet } from '@/types/api';
import { useMapLayersStore } from '@/stores/mapLayersStore';
import { MC, MAP_Z } from '../../mapColors';
import { useIsCompact } from '@/hooks/use-mobile';

type PanelTab = 'layers' | 'legend';

export interface LeftPanelProps {
  open: boolean;
  onToggle: () => void;
  topOffset: number;
  bottomOffset: number;
  projectId: string;
  mapId?: string;
  datasets: Dataset[];
  annotations: Annotation[];
  trackedObjects: TrackedObject[];
  alerts: Alert[];
  annotationSets?: AnnotationSet[];
  onRemoveDataset?: (datasetId: string) => void;
  onRemoveAnnotationSet?: (setId: string) => void;
  onRenameAnnotationSet?: (setId: string, newName: string) => void;
}

export function LeftPanel({
  open,
  onToggle,
  topOffset,
  bottomOffset,
  mapId,
  datasets,
  annotations,
  trackedObjects,
  alerts,
  annotationSets = [],
  onRemoveDataset,
  onRemoveAnnotationSet,
  onRenameAnnotationSet,
}: LeftPanelProps) {
  const [tab, setTab] = useState<PanelTab>('layers');
  const isCompact = useIsCompact();
  const layers = useMapLayersStore((s) => s.layers);
  const applyReorder = useMapLayersStore((s) => s.applyReorder);

  const annotationsByLabel = annotations.reduce<Record<string, Annotation[]>>((acc, a) => {
    if (!acc[a.label]) acc[a.label] = [];
    acc[a.label].push(a);
    return acc;
  }, {});

  const totalItems =
    datasets.length +
    Object.keys(annotationsByLabel).length +
    trackedObjects.length +
    alerts.length;

  // ── Build a flat, z_index-sorted layer list for the "all layers" view ──
  // Item layers (item-*) are nested inside their parent dataset card, not shown top-level
  const sortedLayerEntries = Object.entries(layers)
    .filter(([id]) => !id.startsWith('item-'))
    .sort(([, a], [, b]) => b.zIndex - a.zIndex); // top of stack first

  const sortedIds = sortedLayerEntries.map(([id]) => id);

  // ── DnD sensors (require 5px move to start drag — avoids accidental drags) ──
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = sortedIds.indexOf(active.id as string);
      const newIndex = sortedIds.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return;

      // Reorder the IDs array
      const reordered = [...sortedIds];
      reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, active.id as string);

      // Map positions to z-index values (highest z for first item)
      const newOrder: Record<string, number> = {};
      const maxZ = reordered.length;
      reordered.forEach((id, i) => {
        newOrder[id] = maxZ - i;
      });

      applyReorder(newOrder);
    },
    [sortedIds, applyReorder],
  );

  // ── Desktop geometry ────────────────────────────────────────────────────────
  const panelTop = topOffset + 8;
  const maxPanelH = topOffset > 0
    ? `calc(100vh - ${topOffset + bottomOffset + 16}px)`
    : 'calc(100% - 16px)';

  // ── Shared panel content ────────────────────────────────────────────────────
  const panelContent = (
    <>
      {/* Drag handle — compact only */}
      {isCompact && (
        <div style={{
          width: 36, height: 4, borderRadius: 2,
          background: MC.border,
          margin: '10px auto 0',
          flexShrink: 0,
        }} />
      )}

      {/* ── Panel header ─────────────────────────────────────── */}
      <div
        style={{
          height: 40,
          display: 'flex',
          alignItems: 'center',
          padding: '0 8px 0 14px',
          background: MC.navBg,
          borderBottom: `1px solid ${MC.navBorder}`,
          flexShrink: 0,
          gap: 7,
          marginTop: isCompact ? 8 : 0,
        }}
      >
        <Layers size={13} style={{ color: MC.navAccent, flexShrink: 0 }} />
        <span
          style={{
            flex: 1,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.07em',
            textTransform: 'uppercase',
            color: MC.navText,
          }}
        >
          Layers
          {totalItems > 0 && (
            <span style={{
              marginLeft: 6,
              fontSize: 10,
              color: MC.navAccent,
              fontWeight: 600,
            }}>
              {totalItems}
            </span>
          )}
        </span>
        <button
          onClick={onToggle}
          title={isCompact ? 'Dismiss' : 'Collapse panel'}
          aria-label={isCompact ? 'Dismiss layers panel' : 'Collapse layers panel'}
          style={{
            width: 26,
            height: 26,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            border: 'none',
            color: MC.navTextMuted,
            cursor: 'pointer',
            borderRadius: 4,
            flexShrink: 0,
          }}
        >
          {isCompact ? <ChevronDown size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      {/* ── Tab bar ─────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          borderBottom: `1px solid ${MC.border}`,
          flexShrink: 0,
          background: MC.panelBg,
        }}
      >
        {(['layers', 'legend'] as PanelTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1,
              height: 32,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              background: 'transparent',
              color: tab === t ? MC.accent : MC.textMuted,
              border: 'none',
              borderBottomWidth: 2,
              borderBottomStyle: 'solid',
              borderBottomColor: tab === t ? MC.accent : 'transparent',
              cursor: 'pointer',
              marginBottom: -1,
              transition: 'color 0.12s, border-color 0.12s',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── Scrollable content ──────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '4px 0' }}>

        {/* ── LAYERS tab ──────────────────────────────────────── */}
        {tab === 'layers' && (
          <>
            {sortedLayerEntries.length > 0 && (
              <div role="list" aria-label="Map layers" style={{ padding: '4px 0' }}>
                <div style={{
                  padding: '4px 10px 6px',
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: MC.sectionLabel,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}>
                  <span>Draw order</span>
                  <span style={{ fontSize: 8, color: MC.textMuted, fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>
                    drag to reorder
                  </span>
                </div>

                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  modifiers={[restrictToVerticalAxis]}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext items={sortedIds} strategy={verticalListSortingStrategy}>
                    {sortedLayerEntries.map(([id, layer]) => {
                      const dataset = datasets.find((d) => d.id === id);
                      const annSetId = id.startsWith('annset-') ? id.replace('annset-', '') : null;
                      const annSet = annSetId ? annotationSets.find((s) => s.id === annSetId) : null;

                      // Resolve display name
                      let displayName: string;
                      if (dataset) {
                        displayName = dataset.name;
                      } else if (annSet) {
                        displayName = annSet.name;
                      } else if (id === 'tracking-all') {
                        displayName = `${trackedObjects.length} tracked object${trackedObjects.length !== 1 ? 's' : ''}`;
                      } else if (id === 'alerts-all') {
                        displayName = `${alerts.length} alert${alerts.length !== 1 ? 's' : ''}`;
                      } else {
                        displayName = layer.tileServiceUrl ? 'Tile Service' : id;
                      }

                      // Remove handler
                      const handleRemove = dataset && onRemoveDataset
                        ? () => onRemoveDataset(dataset.id)
                        : annSet && onRemoveAnnotationSet
                          ? () => onRemoveAnnotationSet(annSet.id)
                          : undefined;

                      // Rename handler (annotation sets only)
                      const handleRename = annSet && onRenameAnnotationSet
                        ? (newName: string) => onRenameAnnotationSet(annSet.id, newName)
                        : undefined;

                      return (
                        <LayerCard
                          key={id}
                          id={id}
                          name={displayName}
                          type={layer.type}
                          dataset={dataset}
                          annotationSet={annSet ?? undefined}
                          mapId={mapId}
                          onRemove={handleRemove}
                          onRename={handleRename}
                        />
                      );
                    })}
                  </SortableContext>
                </DndContext>
              </div>
            )}

            {/* Empty state */}
            {sortedLayerEntries.length === 0 && (
              <div style={{
                padding: '32px 20px',
                textAlign: 'center',
              }}>
                <Layers size={28} style={{ color: MC.borderLight, margin: '0 auto 12px' }} />
                <div style={{ fontSize: 13, fontWeight: 600, color: MC.textSecondary, marginBottom: 6 }}>
                  No layers yet
                </div>
                <div style={{ fontSize: 12, color: MC.textMuted, lineHeight: 1.5 }}>
                  Open the Library to add datasets, or use the Annotate tools to draw on the map.
                </div>
              </div>
            )}
          </>
        )}

        {/* ── LEGEND tab ─────────────────────────────────────── */}
        {tab === 'legend' && (
          <div style={{ padding: '8px 12px' }}>
            {/* Annotation sets with class legends */}
            {annotationSets.filter((s) => s.schema?.classes?.length).map((annSet) => (
              <LegendSection key={annSet.id} title={annSet.name}>
                {annSet.schema!.classes!.map((cls) => (
                  <LegendRow
                    key={cls.id}
                    color={cls.style?.definition?.fillColor ?? MC.accent}
                    label={cls.name}
                    count={0}
                    shape="square"
                  />
                ))}
              </LegendSection>
            ))}

            {Object.entries(annotationsByLabel).length > 0 && (
              <LegendSection title="Annotations">
                {Object.entries(annotationsByLabel).map(([label, items]) => (
                  <LegendRow key={label} color={MC.accent} label={label} count={items.length} shape="circle" />
                ))}
              </LegendSection>
            )}

            {datasets.length > 0 && (
              <LegendSection title="Datasets">
                {datasets.map((d) => (
                  <LegendRow key={d.id} color={MC.info} label={d.name} count={d.metadata?.file_count ?? 0} shape="square" />
                ))}
              </LegendSection>
            )}

            {trackedObjects.length > 0 && (
              <LegendSection title="Tracking">
                <LegendRow color={MC.success} label="Tracked objects" count={trackedObjects.length} shape="circle" />
              </LegendSection>
            )}

            {alerts.length > 0 && (
              <LegendSection title="Alerts">
                <LegendRow color={MC.danger} label="Active alerts" count={alerts.length} shape="circle" />
              </LegendSection>
            )}

            {totalItems === 0 && (
              <div style={{ padding: '20px 0', fontSize: 12, color: MC.textMuted, textAlign: 'center', fontStyle: 'italic' }}>
                Add layers to build a legend.
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );

  // ── Compact: bottom sheet ───────────────────────────────────────────────────
  if (isCompact) {
    return (
      <>
        {/* Backdrop */}
        {open && (
          <div
            onClick={onToggle}
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0,0,0,0.35)',
              zIndex: MAP_Z.panel - 1,
              transition: 'opacity 0.2s',
            }}
          />
        )}

        {/* Bottom sheet panel */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            maxHeight: '65vh',
            zIndex: MAP_Z.panel,
            display: 'flex',
            flexDirection: 'column',
            background: MC.panelBg,
            borderTop: `1px solid ${MC.panelBorder}`,
            borderRadius: '12px 12px 0 0',
            boxShadow: '0 -4px 24px rgba(0,0,0,0.18)',
            transform: open ? 'translateY(0)' : 'translateY(110%)',
            transition: 'transform 0.25s cubic-bezier(0.2,0,0,1)',
            overflow: 'hidden',
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          }}
        >
          {panelContent}
        </div>

        {/* FAB trigger */}
        {!open && (
          <button
            onClick={onToggle}
            aria-label="Show layers panel"
            title="Layers"
            style={{
              position: 'absolute',
              top: panelTop + 8,
              left: 12,
              zIndex: MAP_Z.panel,
              height: 36,
              padding: '0 12px',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: MC.navBg,
              border: `1px solid ${MC.navBorder}`,
              borderRadius: 18,
              color: MC.navAccent,
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
              boxShadow: MC.shadowMd,
              whiteSpace: 'nowrap',
            }}
          >
            <Layers size={13} />
            Layers
            {totalItems > 0 && (
              <span style={{
                background: MC.accent,
                color: MC.panelBg,
                borderRadius: 8,
                fontSize: 10,
                fontWeight: 700,
                padding: '0 5px',
                lineHeight: '16px',
                minWidth: 16,
                textAlign: 'center',
              }}>
                {totalItems}
              </span>
            )}
          </button>
        )}
      </>
    );
  }

  // ── Desktop: slide-in from left ─────────────────────────────────────────────
  return (
    <>
      {/* Floating panel */}
      <div
        style={{
          position: 'absolute',
          top: panelTop,
          left: 8,
          width: 280,
          maxHeight: maxPanelH,
          zIndex: MAP_Z.panel,
          display: 'flex',
          flexDirection: 'column',
          background: MC.panelBg,
          border: `1px solid ${MC.panelBorder}`,
          borderRadius: 8,
          boxShadow: open ? MC.shadowMd : 'none',
          transform: open ? 'translateX(0)' : 'translateX(-296px)',
          transition: 'transform 0.22s cubic-bezier(0.2,0,0,1)',
          overflow: 'hidden',
        }}
      >
        {panelContent}
      </div>

      {/* Pull-tab when panel is collapsed */}
      {!open && (
        <button
          onClick={onToggle}
          title="Show layers"
          aria-label="Show layers panel"
          style={{
            position: 'absolute',
            left: 0,
            top: panelTop + 52,
            zIndex: MAP_Z.panel,
            width: 22,
            height: 52,
            background: MC.navBg,
            border: `1px solid ${MC.navBorder}`,
            borderLeft: 'none',
            borderRadius: '0 8px 8px 0',
            color: MC.navAccent,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: MC.shadowMd,
          }}
        >
          <ChevronRight size={12} />
        </button>
      )}
    </>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────
function LegendSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: MC.sectionLabel,
        marginBottom: 6,
      }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{children}</div>
    </div>
  );
}

function LegendRow({
  color, label, count, shape,
}: {
  color: string; label: string; count: number; shape: 'circle' | 'square';
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        width: 12, height: 12,
        borderRadius: shape === 'circle' ? '50%' : 2,
        background: color,
        flexShrink: 0,
        opacity: 0.85,
      }} />
      <span style={{
        flex: 1, fontSize: 12, color: MC.textSecondary,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }} title={label}>
        {label}
      </span>
      <span style={{ fontSize: 11, color: MC.textMuted, flexShrink: 0 }}>
        {count.toLocaleString()}
      </span>
    </div>
  );
}
