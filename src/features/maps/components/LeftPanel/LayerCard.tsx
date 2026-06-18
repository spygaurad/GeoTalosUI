'use client';

import { useState, useRef, useEffect, useCallback, forwardRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Eye, EyeOff, ChevronDown, ChevronRight,
  GripVertical, X, Loader, AlertTriangle, Pencil,
  ZoomIn, Trash2, FileImage, Download,
  BoxSelect, CheckCircle2,
} from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { downloadJSON } from '@/lib/download-utils';
import { useMapLayersStore } from '@/stores/mapLayersStore';
import { datasetsApi } from '@/lib/api/datasets';
import { annotationSetsApi } from '@/lib/api/annotation-sets';
import { qk } from '@/lib/query-keys';
import { MC } from '../../mapColors';
import type { LayerType, LayerConfig, BandSelection } from '@/features/maps/types';
import type { Dataset, AnnotationSetMount, AnnotationClass, DatasetItem, AnnotationReviewStatus } from '@/types/api';
import { REVIEW_STATUS_LABEL } from '@/features/maps/utils/annotationSetHierarchy';
import {
  addDatasetItemLayerToMap,
  getDatasetItemLayerId,
  removeDatasetItemLayerFromMap,
} from '@/features/maps/utils/datasetItemLayer';
import { getClassDescription } from '@/features/maps/utils/mapTextUtils';
import { BandSelector } from '@/features/maps/components/RightPanel/BandSelector';
import {
  switchAoiChildLayerToFirstItem,
  switchAoiChildLayerToItem,
} from '@/features/maps/utils/aoiChildItem';

// ── Props ────────────────────────────────────────────────────────────────────

export interface LayerCardProps {
  id: string;
  name: string;
  type: LayerType;
  /** Dataset data for dataset layers */
  dataset?: Dataset;
  /** Annotation set data for annotation-set layers */
  annotationSet?: AnnotationSetMount;
  /** Map ID (required for adding dataset items as layers) */
  mapId?: string;
  /** Called when user confirms deletion */
  onRemove?: () => void;
  /** Called to rename an annotation set */
  onRename?: (newName: string) => void;
  /**
   * For AOI layers with nested child layers: controls whether the children are
   * shown in the list. When provided, the expand arrow toggles this instead of
   * showing the (redundant) bbox details. `childCount` drives the count badge.
   */
  aoiExpanded?: boolean;
  onToggleAoiExpand?: () => void;
  childCount?: number;
}

// ── Component ────────────────────────────────────────────────────────────────

export function LayerCard({
  id, name, type, dataset, annotationSet, mapId, onRemove, onRename,
  aoiExpanded, onToggleAoiExpand, childCount,
}: LayerCardProps) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(!!dataset);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [itemActionIds, setItemActionIds] = useState<Record<string, true>>({});
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(name);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const editRef = useRef<HTMLInputElement>(null);
  const ctxRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const layer = useMapLayersStore((s) => s.layers[id]);
  const setLayerVisible = useMapLayersStore((s) => s.setLayerVisible);
  const focusLayer = useMapLayersStore((s) => s.focusLayer);
  const isSelected = useMapLayersStore((s) => s.selectedLayerId === id);
  const selectedLayerId = useMapLayersStore((s) => s.selectedLayerId);
  const allLayers = useMapLayersStore((s) => s.layers);

  // Review workflow status (annotation sets only). Drives the status badge and
  // the "Mark as …" context-menu actions used by the status-lens grouping.
  const reviewMutation = useMutation({
    mutationFn: (status: AnnotationReviewStatus) =>
      annotationSetsApi.setReviewStatus(annotationSet!.annotation_set_id, status),
    onSuccess: (updated) => {
      toast.success(`Marked as ${REVIEW_STATUS_LABEL[updated.review_status ?? 'raw'].toLowerCase()}`);
      if (mapId) void queryClient.invalidateQueries({ queryKey: qk.maps.detail(mapId) });
    },
    onError: () => toast.error('Failed to update review status'),
  });

  // Export annotation set as GeoJSON
  const exportMutation = useMutation({
    mutationFn: async () => {
      const features = await annotationSetsApi.getAllFeatures(annotationSet!.annotation_set_id);
      const filename = `${annotationSet?.set_name || 'annotation-set'}.geojson`;
      downloadJSON(features, filename);
    },
    onSuccess: () => toast.success('Downloaded'),
    onError: () => toast.error('Failed to export annotation set'),
  });

  // Drag-and-drop via @dnd-kit
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const dragStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : 'auto',
    position: isDragging ? 'relative' : undefined,
  };

  // Focus edit input
  useEffect(() => {
    if (editing && editRef.current) editRef.current.focus();
  }, [editing]);

  // Close context menu on outside click, scroll, resize or Escape. Scroll/resize
  // matter because the menu is a fixed-position window over the map — if the
  // panel scrolls underneath, a stale menu would point at the wrong card.
  useEffect(() => {
    if (!ctxMenu) return;
    const onPointer = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtxMenu(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCtxMenu(null); };
    const close = () => setCtxMenu(null);
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    // capture:true so we catch scrolls on the panel's inner scroll container too
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [ctxMenu]);

  // For AOI child layers, filter items by AOI bbox so users only see items that
  // actually intersect the AOI (the parent dataset may have many items elsewhere).
  const isAoiChild = !!layer?.parentAoiId;
  const aoiBboxParam = layer?.clipBounds ? layer.clipBounds.join(',') : undefined;

  // Fetch dataset items when expanded. AOI children pass bbox so the list is
  // pre-filtered to AOI-intersecting items only.
  const {
    data: itemsData,
    isLoading: itemsLoading,
  } = useQuery({
    queryKey: isAoiChild
      ? [...qk.datasets.items(dataset?.id ?? ''), 'aoi', aoiBboxParam ?? '']
      : qk.datasets.items(dataset?.id ?? ''),
    queryFn: () =>
      datasetsApi.listItems(dataset!.id, {
        page_size: 100,
        ...(isAoiChild && aoiBboxParam ? { bbox: aoiBboxParam } : {}),
      }),
    enabled: !!dataset && expanded,
  });

  const items = itemsData?.items ?? [];

  // Track which items are shown on map.
  // - Regular dataset cards: an item is "shown" if its top-level item-* layer exists.
  // - AOI child cards: an item is "shown" if it's the active item driving the AOI
  //   child layer's tile URL (we track this via layer.stacItemId on the child).
  const shownItemIds = isAoiChild
    ? new Set(layer?.stacItemId ? [layer.stacItemId] : [])
    : new Set(
        items
          .filter((it) => !!allLayers[getDatasetItemLayerId(it.stac_item_id)])
          .map((it) => it.stac_item_id),
      );

  const handleCardClick = () => focusLayer(id);

  const handleNameSubmit = () => {
    setEditing(false);
    const trimmed = editName.trim();
    if (trimmed && trimmed !== name && onRename) {
      onRename(trimmed);
    } else {
      setEditName(name);
    }
  };

  const handleDelete = async () => {
    if (confirmDelete) {
      setIsDeleting(true);
      try {
        await Promise.resolve(onRemove?.());
        setConfirmDelete(false);
      } finally {
        setIsDeleting(false);
      }
    } else {
      setConfirmDelete(true);
    }
  };

  const handleItemToggle = async (item: DatasetItem, isCurrentlyShown: boolean) => {
    if (!dataset) return;
    if (itemActionIds[item.id]) return;
    setItemActionIds((prev) => ({ ...prev, [item.id]: true }));
    try {
      // ── AOI child path: switch the AOI child layer's tile URL to this item
      // (bbox-clipped, bands inherited) instead of creating a separate
      // top-level item layer. ─────────────────────────────────────────────
      if (isAoiChild && layer) {
        if (isCurrentlyShown) {
          // Toggling off the active item — revert to the dataset's first
          // STAC item (mirrors the addAoiBoundedDataset default behaviour).
          await switchAoiChildLayerToFirstItem({
            childLayerId: id,
            datasetId: dataset.id,
            layerSnapshot: layer,
          });
        } else {
          await switchAoiChildLayerToItem({
            childLayerId: id,
            datasetId: dataset.id,
            stacItemId: item.stac_item_id,
            layerSnapshot: layer,
          });
        }
        return;
      }

      // ── Regular path: top-level item layers ────────────────────────────
      if (!mapId) return;
      const itemLayerId = getDatasetItemLayerId(item.stac_item_id);
      if (isCurrentlyShown) {
        await removeDatasetItemLayerFromMap({ mapId, layerId: itemLayerId });
      } else {
        await addDatasetItemLayerToMap({
          mapId,
          datasetId: dataset.id,
          item,
        });
      }
      await queryClient.invalidateQueries({ queryKey: qk.maps.detail(mapId) });
    } catch (err) {
      console.error('Failed to toggle item layer:', err);
      toast.error(isCurrentlyShown ? 'Failed to remove item from map' : 'Failed to add item to map');
    } finally {
      setItemActionIds((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    }
  };

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Viewport coordinates: the menu is portaled to <body> and floats over the
    // map as a fixed window, so it isn't clipped by the left panel's scroll.
    // Clamp so it never spills off the right/bottom edge.
    const MENU_W = 180;
    const MENU_H = 220;
    const x = Math.min(e.clientX, window.innerWidth - MENU_W);
    const y = Math.min(e.clientY, window.innerHeight - MENU_H);
    setCtxMenu({ x: Math.max(8, x), y: Math.max(8, y) });
  }, []);

  // Auto-dismiss confirm after 3s
  useEffect(() => {
    if (!confirmDelete) return;
    const t = setTimeout(() => setConfirmDelete(false), 3000);
    return () => clearTimeout(t);
  }, [confirmDelete]);

  if (!layer) return null;

  const color = layer.style?.color ?? MC.accent;
  const hasError = !!layer.error;
  const isLoading = layer.loading;

  const isAoi = type === 'aoi';

  // For AOIs, the expand arrow is "controlled" by the parent and toggles the
  // nested child layers in the list rather than showing local bbox details.
  const isAoiToggle = isAoi && !!onToggleAoiExpand;
  const effectiveExpanded = isAoiToggle ? !!aoiExpanded : expanded;

  // Expandable: annotation sets always (show classes + count), datasets show
  // type/files + items, AOIs only when they have nested child layers to reveal.
  const hasExpandable = !!annotationSet || !!dataset || isAoiToggle;
  // Mount rows carry no embedded schema; the expanded class list falls back to
  // layer.classStyles below when there are no schema classes.
  const classes: AnnotationClass[] = [];
  const currentStatus: AnnotationReviewStatus = annotationSet?.review_status ?? 'raw';

  return (
    <div
      ref={(node) => { setNodeRef(node); (cardRef as React.MutableRefObject<HTMLDivElement | null>).current = node; }}
      onContextMenu={handleContextMenu}
      style={{
        ...dragStyle,
        position: 'relative',
        background: isSelected ? MC.accentDim : MC.panelBg,
        border: `1px solid ${isSelected ? MC.accent : MC.border}`,
        borderRadius: 6,
        margin: '3px 6px',
        transition: `${transition ?? ''}, border-color 0.15s, background 0.15s`.replace(/^, /, ''),
        overflow: 'visible',
      }}
    >
      {/* ── Main row ────────────────────────────────────────────── */}
      <div
        onClick={handleCardClick}
        style={{
          display: 'flex',
          alignItems: 'center',
          height: 36,
          gap: 4,
          padding: '0 4px 0 0',
          cursor: isDeleting ? 'default' : 'pointer',
          opacity: isDeleting ? 0.6 : 1,
          pointerEvents: isDeleting ? 'none' : 'auto',
        }}
      >
        {/* Drag handle */}
        <div
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          style={{
            width: 22,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: isDragging ? 'grabbing' : 'grab',
            color: MC.textMuted,
            flexShrink: 0,
            touchAction: 'none',
          }}
          title="Drag to reorder"
        >
          <GripVertical size={12} />
        </div>

        {/* Color swatch / AOI icon */}
        {isAoi ? (
          <BoxSelect size={12} style={{
            color,
            flexShrink: 0,
            opacity: layer.visible ? 0.9 : 0.35,
          }} />
        ) : (
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: type === 'tracking' || type === 'alert' ? '50%' : 3,
              background: color,
              flexShrink: 0,
              opacity: layer.visible ? 0.9 : 0.35,
              border: `1px solid ${MC.borderLight}`,
            }}
          />
        )}

        {/* Name — click to focus/open panel */}
        {editing ? (
          <input
            ref={editRef}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleNameSubmit}
            onKeyDown={(e) => { if (e.key === 'Enter') handleNameSubmit(); if (e.key === 'Escape') { setEditing(false); setEditName(name); } }}
            style={{
              flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600,
              color: MC.text, background: MC.inputBg,
              border: `1px solid ${MC.accent}`,
              borderRadius: 3, padding: '2px 4px',
              outline: 'none',
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            onClick={handleCardClick}
            onDoubleClick={(e) => {
              e.stopPropagation();
              // For annotation sets with rename: double-click renames
              if (onRename) {
                setEditing(true);
              }
              // For layers without rename but with remove: double-click removes (e.g., top-level annotation sets)
              else if (onRemove) {
                handleDelete();
              }
            }}
            style={{
              flex: 1, minWidth: 0, fontSize: 12, fontWeight: 500,
              color: layer.visible ? MC.text : MC.textMuted,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              cursor: 'pointer',
              padding: '0 4px',
            }}
            title={
              onRename
                ? `${name} (double-click to rename)`
                : onRemove
                  ? `${name} (double-click to remove)`
                  : name
            }
          >
            {name}
          </span>
        )}

        {/* AOI child-layer count badge */}
        {isAoiToggle && typeof childCount === 'number' && childCount > 0 && (
          <span
            title={`${childCount} layer${childCount !== 1 ? 's' : ''} in this AOI`}
            style={{
              flexShrink: 0,
              fontSize: 9,
              fontWeight: 700,
              color: MC.accent,
              background: MC.accentDim,
              borderRadius: 8,
              padding: '0 5px',
              lineHeight: '15px',
              minWidth: 15,
              textAlign: 'center',
            }}
          >
            {childCount}
          </span>
        )}

        {/* Loading */}
        {isLoading && (
          <span style={{ flexShrink: 0, display: 'flex' }}>
            <Loader size={11} style={{ color: MC.textMuted, animation: 'spin 1s linear infinite' }} />
          </span>
        )}

        {/* Error */}
        {hasError && (
          <span title="Load error" style={{ flexShrink: 0, display: 'flex' }}>
            <AlertTriangle size={11} style={{ color: MC.danger, opacity: 0.8 }} />
          </span>
        )}

        {/* Raster mask badge */}
        {layer.isRasterMask && (
          <span
            title="Raster segmentation mask"
            style={{
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <FileImage size={11} style={{ color: MC.accent, opacity: 0.75 }} />
          </span>
        )}

        {/* Eye toggle — cascades to child item layers for datasets */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            const newVis = !layer.visible;
            setLayerVisible(id, newVis);
            // Cascade to child item layers
            if (dataset) {
              Object.entries(allLayers).forEach(([lid, l]) => {
                if (l.parentDatasetId === dataset.id) setLayerVisible(lid, newVis);
              });
            }
          }}
          title={layer.visible ? 'Hide layer' : 'Show layer'}
          aria-label={`${layer.visible ? 'Hide' : 'Show'} ${name}`}
          style={{
            width: 22, height: 22,
            padding: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'transparent', border: 'none',
            cursor: 'pointer', flexShrink: 0, borderRadius: 3,
            outline: 'none',
            appearance: 'none',
            WebkitAppearance: 'none',
            color: MC.accent,
            opacity: layer.visible ? 0.95 : 0.58,
            transition: 'color 0.12s, opacity 0.12s',
          }}
        >
          {layer.visible ? <Eye size={13} strokeWidth={2.5} /> : <EyeOff size={13} strokeWidth={2.5} />}
        </button>

        {/* Expand toggle */}
        {hasExpandable && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (isAoiToggle) onToggleAoiExpand!();
              else setExpanded(!expanded);
            }}
            title={effectiveExpanded ? 'Collapse' : 'Expand'}
            style={{
              width: 20, height: 20,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none',
              color: MC.accent, cursor: 'pointer', flexShrink: 0, borderRadius: 3,
              opacity: 0.78,
              transition: 'transform 0.15s, opacity 0.15s',
            }}
          >
            {effectiveExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        )}

        {/* Delete */}
        {onRemove && (
          <button
            onClick={(e) => { e.stopPropagation(); void handleDelete(); }}
            disabled={isDeleting}
            title={isDeleting ? 'Removing...' : confirmDelete ? 'Click again to confirm' : 'Remove layer'}
            style={{
              width: 20, height: 20,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: confirmDelete ? MC.accentDim : 'transparent',
              border: confirmDelete ? `1px solid ${MC.accent}` : 'none',
              color: MC.accent,
              cursor: isDeleting ? 'default' : 'pointer', flexShrink: 0, borderRadius: 3,
              opacity: confirmDelete || isDeleting ? 1 : 0.72,
              transition: 'all 0.15s',
            }}
          >
            {isDeleting ? <Loader size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <X size={11} />}
          </button>
        )}
      </div>

      {/* ── Delete confirmation bar ──────────────────────────── */}
      {confirmDelete && (
        <div style={{
          padding: '4px 8px', fontSize: 10, color: MC.accent,
          background: MC.accentDim,
          borderTop: `1px solid ${MC.accent}35`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
        }}>
          Click <X size={9} /> again to remove from map
        </div>
      )}

      {/* ── Expanded: annotation set classes + count ───────────── */}
      {expanded && annotationSet && (
        <div style={{
          padding: '4px 10px 8px 30px',
          display: 'flex', flexDirection: 'column', gap: 3,
        }}>
          {/* Raster mask badge OR annotation count */}
          {layer?.isRasterMask ? (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              marginBottom: 4, padding: '1px 6px', borderRadius: 8,
              background: MC.accentDim, border: `1px solid ${MC.border}`,
              fontSize: 9, fontWeight: 700, color: MC.accent,
              letterSpacing: '0.05em', alignSelf: 'flex-start',
            }}>
              RASTER MASK
            </div>
          ) : null}

          {/* Classes with color swatches */}
          {classes.length > 0 ? (
            classes.map((cls) => {
              const fillColor = cls.style?.definition?.fillColor ?? MC.accent;
              const description = getClassDescription(cls);
              return (
                <div key={cls.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: 2,
                    background: fillColor, flexShrink: 0, opacity: 0.85,
                    marginTop: description ? 2 : 3,
                  }} />
                  <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                    <span style={{
                      fontSize: 11, color: MC.textSecondary,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {cls.name}
                    </span>
                    {description && (
                      <span style={{
                        fontSize: 10,
                        color: MC.textMuted,
                        lineHeight: 1.3,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}>
                        {description}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <div style={{ fontSize: 10, color: MC.textMuted, fontStyle: 'italic' }}>
              No schema classes
            </div>
          )}
        </div>
      )}

      {/* ── Expanded: dataset items ────────────────────────────── */}
      {expanded && dataset && (
        <div style={{
          padding: '2px 6px 6px 26px',
          display: 'flex', flexDirection: 'column', gap: 2,
        }}>
          {/* Dataset items */}
          {dataset.status === 'ready' && (
            <>
              {itemsLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 0' }}>
                  <Loader size={10} style={{ color: MC.textMuted, animation: 'spin 1s linear infinite' }} />
                  <span style={{ fontSize: 10, color: MC.textMuted }}>Loading…</span>
                </div>
              ) : items.length === 0 ? (
                <div style={{ fontSize: 10, color: MC.textMuted, fontStyle: 'italic', padding: '3px 0' }}>
                  No items
                </div>
              ) : (
                items.map((item) => {
                  const isShown = shownItemIds.has(item.stac_item_id);
                  const itemLayerId = getDatasetItemLayerId(item.stac_item_id);
                  const itemLayer = isShown ? allLayers[itemLayerId] : null;
                  const isBusy = !!itemActionIds[item.id];
                  return (
                    <ItemSubRow
                      key={item.id}
                      item={item}
                      isShown={isShown}
                      isBusy={isBusy}
                      itemLayer={itemLayer}
                      isSelected={selectedLayerId === itemLayerId}
                      onSelect={async () => {
                        if (isBusy) return;
                        if (!isShown) {
                          await handleItemToggle(item, false);
                        }
                        focusLayer(itemLayerId);
                      }}
                      onToggle={() => {
                        if (isBusy) return;
                        void handleItemToggle(item, isShown);
                      }}
                      onVisibilityToggle={() => {
                        if (isBusy) return;
                        if (itemLayer) setLayerVisible(itemLayerId, !itemLayer.visible);
                      }}
                      onRemove={() => {
                        if (isBusy) return;
                        void handleItemToggle(item, true);
                      }}
                    />
                  );
                })
              )}
            </>
          )}
        </div>
      )}

      {/* ── Right-click context menu ───────────────────────────── */}
      {/* Portaled to <body> as a fixed window so it floats over the map and is
          never clipped by the left panel's overflow/scroll. */}
      {ctxMenu && typeof document !== 'undefined' && createPortal(
        <div
          ref={ctxRef}
          onContextMenu={(e) => e.preventDefault()}
          style={{
            position: 'fixed',
            top: ctxMenu.y,
            left: ctxMenu.x,
            zIndex: 1000,
            minWidth: 180,
            background: MC.panelBg,
            border: `1px solid ${MC.panelBorder}`,
            borderRadius: 6,
            boxShadow: MC.shadowMd,
            padding: '4px 0',
            overflow: 'hidden',
          }}
        >
          <CtxMenuItem
            icon={<ZoomIn size={12} />}
            label="Zoom to layer"
            onClick={() => { focusLayer(id); setCtxMenu(null); }}
          />
          {onRename && (
            <CtxMenuItem
              icon={<Pencil size={12} />}
              label="Rename"
              onClick={() => { setEditing(true); setCtxMenu(null); }}
            />
          )}
          {annotationSet && (
            <>
              <div style={{ height: 1, background: MC.border, margin: '4px 0' }} />
              <CtxMenuItem
                icon={<Download size={12} />}
                label="Export as GeoJSON"
                onClick={() => { exportMutation.mutate(); setCtxMenu(null); }}
              />
              <div style={{ height: 1, background: MC.border, margin: '4px 0' }} />
              {(['verified', 'corrected', 'raw'] as AnnotationReviewStatus[])
                .filter((s) => s !== currentStatus)
                .map((s) => (
                  <CtxMenuItem
                    key={s}
                    icon={<CheckCircle2 size={12} />}
                    label={`Mark as ${REVIEW_STATUS_LABEL[s].toLowerCase()}`}
                    onClick={() => { reviewMutation.mutate(s); setCtxMenu(null); }}
                  />
                ))}
            </>
          )}
          {onRemove && (
            <>
              <div style={{ height: 1, background: MC.border, margin: '4px 0' }} />
              <CtxMenuItem
                icon={<Trash2 size={12} />}
                label="Remove from map"
                onClick={() => { handleDelete(); setCtxMenu(null); }}
              />
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

// ── Item sub-row (individual STAC item with controls) ───────────────────────

function ItemSubRow({
  item, isShown, isBusy, itemLayer, isSelected, onSelect, onToggle, onVisibilityToggle, onRemove,
}: {
  item: DatasetItem;
  isShown: boolean;
  isBusy: boolean;
  itemLayer: LayerConfig | null;
  isSelected: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onVisibilityToggle: () => void;
  onRemove: () => void;
}) {
  const [hover, setHover] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ctxMenu) return;
    const handler = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtxMenu(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ctxMenu]);
  const dateStr = item.datetime
    ? new Date(item.datetime).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : null;
  const label = dateStr ?? item.filename?.trim() ?? 'Untitled item';
  const isVisible = isShown ? (itemLayer?.visible ?? true) : false;

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={item.stac_item_id}
      onContextMenu={(e) => {
        if (!itemLayer?.renderingConfig || itemLayer.renderingConfig.bands.length < 2) return;
        e.preventDefault();
        e.stopPropagation();
        // Viewport coords, clamped — menu is portaled fixed over the map.
        const x = Math.max(8, Math.min(e.clientX, window.innerWidth - 300));
        const y = Math.max(8, Math.min(e.clientY, window.innerHeight - 320));
        setCtxMenu({ x, y });
      }}
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        height: 30,
        padding: '0 4px 0 6px',
        borderRadius: 4,
        background: isSelected ? MC.accentDim : hover ? MC.hoverBg : 'transparent',
        border: `1px solid ${isSelected ? MC.accent : 'transparent'}`,
        transition: 'all 0.12s',
        cursor: isBusy ? 'default' : 'pointer',
        opacity: isBusy ? 0.75 : 1,
      }}
      onClick={() => {
        if (isBusy) return;
        onSelect();
      }}
    >
      {/* Raster icon */}
      <FileImage size={11} style={{
        color: isShown ? MC.accent : MC.textMuted,
        flexShrink: 0,
        opacity: isVisible ? 1 : 0.4,
      }} />

      {/* Label */}
      <span style={{
        fontSize: 11,
        color: isShown ? (isVisible ? MC.text : MC.textMuted) : MC.textMuted,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
        fontWeight: isSelected ? 600 : 500,
      }}>
        {label}
      </span>

      {/* Eye toggle — add to map or toggle visibility */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (isBusy) return;
          if (isShown) {
            onVisibilityToggle();
          } else {
            onToggle(); // Add to map
          }
        }}
        title={isBusy ? 'Working…' : isShown ? (isVisible ? 'Hide layer' : 'Show layer') : 'Add to map'}
        style={{
          width: 22, height: 22,
          padding: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'transparent', border: 'none',
          cursor: isBusy ? 'default' : 'pointer', flexShrink: 0, borderRadius: 3,
          outline: 'none',
          appearance: 'none',
          WebkitAppearance: 'none',
          color: isShown && isVisible ? MC.accent : MC.borderLight,
          filter: isShown && isVisible ? `drop-shadow(0 0 3px ${MC.accent}60)` : 'none',
          transition: 'color 0.15s, filter 0.15s',
        }}
      >
        {isBusy ? (
          <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} />
        ) : isShown && isVisible ? (
          <Eye size={12} strokeWidth={2.5} />
        ) : (
          <EyeOff size={12} strokeWidth={2.5} />
        )}
      </button>

      {/* Remove — only when on map */}
      {isShown && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          title="Remove from map"
          style={{
            width: 20, height: 20,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'transparent', border: 'none',
            cursor: isBusy ? 'default' : 'pointer', flexShrink: 0, borderRadius: 3,
            color: MC.textMuted, opacity: hover ? 0.7 : 0, transition: 'opacity 0.12s',
          }}
          disabled={isBusy}
        >
          <X size={10} />
        </button>
      )}

      {/* Band selector context menu — right-click for items with renderingConfig */}
      {ctxMenu && itemLayer?.renderingConfig && itemLayer.renderingConfig.bands.length >= 2 && itemLayer.id && (
        <BandContextMenu
          layerId={itemLayer.id}
          layer={itemLayer}
          position={ctxMenu}
          onClose={() => setCtxMenu(null)}
          ref={ctxRef}
        />
      )}
    </div>
  );
}

// ── Band context menu ──────────────────────────────────────────────────────────

interface BandContextMenuProps {
  layerId: string;
  layer: LayerConfig;
  position: { x: number; y: number };
  onClose: () => void;
}

const BandContextMenu = forwardRef<HTMLDivElement, BandContextMenuProps>(
  ({ layerId, layer, position, onClose }, ref) => {
    const setLayerBandSelection = useMapLayersStore((s) => s.setLayerBandSelection);
    const setLayerTileConfig = useMapLayersStore((s) => s.setLayerTileConfig);

    const handleBandChange = useCallback(
      async (bands: BandSelection, preset?: string | null) => {
        if (!layer.tileUrl || !layer.renderingConfig) return;

        setLayerBandSelection(layerId, bands, preset ?? null);

        // For AOI child layers, rebuild from base URL + bands + bbox
        if (layer.parentAoiId) {
          const baseUrl = layer.tileUrl.split('?')[0];
          const params = new URLSearchParams();
          params.set('asset_bidx', `data|${bands.r},${bands.g},${bands.b}`);

          const rc = layer.renderingConfig;
          if (rc.bands) {
            const rBand = rc.bands.find((b) => b.index === bands.r);
            const gBand = rc.bands.find((b) => b.index === bands.g);
            const bBand = rc.bands.find((b) => b.index === bands.b);
            if (rBand && gBand && bBand) {
              params.set('rescale', `${rBand.stats.p2},${rBand.stats.p98}`);
            }
          }

          if (layer.clipBounds) {
            params.set('bbox', layer.clipBounds.join(','));
          }

          const newTileUrl = `${baseUrl}?${params.toString()}`;
          setLayerTileConfig(layerId, { tileUrl: newTileUrl });
        }
        // For stac_item layers, fetch tile config and rebuild
        else if (layer.sourceType === 'stac_item' && layer.parentDatasetId && layer.stacItemId) {
          try {
            const tc = await datasetsApi.getItemTileConfigByStacId(
              layer.parentDatasetId,
              layer.stacItemId,
            );
            const baseUrl = tc.tile_url_template.split('?')[0];
            const params = new URLSearchParams();
            params.set('asset_bidx', `data|${bands.r},${bands.g},${bands.b}`);

            const rc = layer.renderingConfig;
            if (rc?.bands) {
              const rBand = rc.bands.find((b) => b.index === bands.r);
              const gBand = rc.bands.find((b) => b.index === bands.g);
              const bBand = rc.bands.find((b) => b.index === bands.b);
              if (rBand && gBand && bBand) {
                params.set('rescale', `${rBand.stats.p2},${rBand.stats.p98}`);
              }
            }

            const newTileUrl = `${baseUrl}?${params.toString()}`;
            setLayerTileConfig(layerId, { tileUrl: newTileUrl });
          } catch (err) {
            console.error('Failed to update band selection:', err);
          }
        }

        onClose();
      },
      [layerId, layer, setLayerBandSelection, setLayerTileConfig, onClose],
    );

    const handlePresetChange = useCallback(
      async (presetId: string) => {
        if (!layer.tileUrl || !layer.renderingConfig?.presets[presetId]) return;

        const preset = layer.renderingConfig.presets[presetId];
        const match = preset.params.asset_bidx?.match(/\|(\d+),(\d+),(\d+)/);
        const bands: BandSelection | null = match
          ? { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) }
          : null;

        setLayerBandSelection(layerId, bands, presetId);

        // For AOI child layers
        if (layer.parentAoiId) {
          const baseUrl = layer.tileUrl.split('?')[0];
          const params = new URLSearchParams();
          Object.entries(preset.params).forEach(([key, value]) => {
            if (value) params.set(key, String(value));
          });
          if (layer.clipBounds) params.set('bbox', layer.clipBounds.join(','));
          const qs = params.toString();
          const newTileUrl = qs ? `${baseUrl}?${qs}` : baseUrl;
          setLayerTileConfig(layerId, { tileUrl: newTileUrl });
        }
        // For stac_item layers
        else if (layer.sourceType === 'stac_item' && layer.parentDatasetId && layer.stacItemId) {
          try {
            const tc = await datasetsApi.getItemTileConfigByStacId(
              layer.parentDatasetId,
              layer.stacItemId,
            );
            const baseUrl = tc.tile_url_template.split('?')[0];
            const params = new URLSearchParams();
            Object.entries(preset.params).forEach(([key, value]) => {
              if (value) params.set(key, String(value));
            });
            const qs = params.toString();
            const newTileUrl = qs ? `${baseUrl}?${qs}` : baseUrl;
            setLayerTileConfig(layerId, { tileUrl: newTileUrl });
          } catch (err) {
            console.error('Failed to apply preset:', err);
          }
        }

        onClose();
      },
      [layerId, layer, setLayerBandSelection, setLayerTileConfig, onClose],
    );

    if (typeof document === 'undefined') return null;
    return createPortal(
      <div
        ref={ref}
        style={{
          // Fixed + portaled to <body> so the menu floats over the map instead
          // of being clipped by the left panel's scroll container.
          position: 'fixed',
          left: `${position.x}px`,
          top: `${position.y}px`,
          background: MC.panelBg,
          border: `1px solid ${MC.border}`,
          borderRadius: 6,
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
          zIndex: 1000,
          minWidth: 240,
          maxWidth: 300,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '8px 12px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: MC.textMuted, marginBottom: 8, textTransform: 'uppercase' }}>
            Band Selection
          </div>
          <BandSelector
            renderingConfig={layer.renderingConfig!}
            bandSelection={layer.bandSelection ?? null}
            activePreset={layer.activePreset ?? null}
            onBandChange={handleBandChange}
            onPresetChange={handlePresetChange}
          />
        </div>
      </div>,
      document.body,
    );
  },
);

BandContextMenu.displayName = 'BandContextMenu';

// ── Context menu item ────────────────────────────────────────────────────────

function CtxMenuItem({
  icon, label, onClick, danger,
}: {
  icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: '100%',
        height: 30,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 12px',
        background: hover ? MC.hoverBg : 'transparent',
        border: 'none',
        color: danger ? MC.danger : MC.text,
        fontSize: 11,
        fontWeight: 500,
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background 0.1s',
      }}
    >
      <span style={{ flexShrink: 0, display: 'flex', opacity: 0.7 }}>{icon}</span>
      {label}
    </button>
  );
}
