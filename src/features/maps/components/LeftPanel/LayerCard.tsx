'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Eye, EyeOff, ChevronDown, ChevronRight,
  GripVertical, X, Loader, AlertTriangle, Pencil,
  ZoomIn, Palette, Trash2, FileImage,
  Clock,
} from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQuery } from '@tanstack/react-query';
import { useMapLayersStore } from '@/stores/mapLayersStore';
import { datasetsApi } from '@/lib/api/datasets';
import { qk } from '@/lib/query-keys';
import { geometryToTileBounds } from '@/lib/geo';
import { MC } from '../../mapColors';
import type { LayerType, LayerConfig } from '@/features/maps/types';
import type { Dataset, AnnotationSet, DatasetItem } from '@/types/api';

// ── Props ────────────────────────────────────────────────────────────────────

export interface LayerCardProps {
  id: string;
  name: string;
  type: LayerType;
  /** Dataset data for dataset layers */
  dataset?: Dataset;
  /** Annotation set data for annotation-set layers */
  annotationSet?: AnnotationSet;
  /** Map ID (required for adding dataset items as layers) */
  mapId?: string;
  /** Called when user confirms deletion */
  onRemove?: () => void;
  /** Called to rename an annotation set */
  onRename?: (newName: string) => void;
}

// ── Component ────────────────────────────────────────────────────────────────

export function LayerCard({
  id, name, type, dataset, annotationSet, mapId, onRemove, onRename,
}: LayerCardProps) {
  const [expanded, setExpanded] = useState(!!dataset);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(name);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const editRef = useRef<HTMLInputElement>(null);
  const ctxRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const layer = useMapLayersStore((s) => s.layers[id]);
  const setLayerVisible = useMapLayersStore((s) => s.setLayerVisible);
  const focusLayer = useMapLayersStore((s) => s.focusLayer);
  const openStylePanel = useMapLayersStore((s) => s.openStylePanel);
  const isSelected = useMapLayersStore((s) => s.selectedLayerId === id);
  const selectedLayerId = useMapLayersStore((s) => s.selectedLayerId);
  const allLayers = useMapLayersStore((s) => s.layers);
  const initLayer = useMapLayersStore((s) => s.initLayer);
  const setBackendLayerId = useMapLayersStore((s) => s.setBackendLayerId);
  const setLayerTileConfig = useMapLayersStore((s) => s.setLayerTileConfig);
  const removeLayer = useMapLayersStore((s) => s.removeLayer);
  const backendLayerIds = useMapLayersStore((s) => s.backendLayerIds);
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

  // Close context menu on outside click
  useEffect(() => {
    if (!ctxMenu) return;
    const handler = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtxMenu(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ctxMenu]);

  if (!layer) return null;

  const color = layer.style?.color ?? MC.accent;
  const hasError = !!layer.error;
  const isLoading = layer.loading;

  // Expandable: annotation sets always (show classes + count), datasets show type/files + items
  const hasExpandable = !!annotationSet || !!dataset;
  const classes = annotationSet?.schema?.classes ?? [];

  // Fetch dataset items when expanded (only for datasets)
  const {
    data: itemsData,
    isLoading: itemsLoading,
  } = useQuery({
    queryKey: qk.datasets.items(dataset?.id ?? ''),
    queryFn: () => datasetsApi.listItems(dataset!.id, { page_size: 100 }),
    enabled: !!dataset && expanded,
  });

  const items = itemsData?.items ?? [];

  // Track which items are shown on map
  // Check by layer ID convention (item-{stac_item_id}) since parentDatasetId
  // may not be set for layers restored from backend (backend doesn't store it for stac_items)
  const shownItemIds = new Set(
    items
      .filter((it) => !!allLayers[`item-${it.stac_item_id}`])
      .map((it) => it.stac_item_id)
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

  const handleDelete = () => {
    if (confirmDelete) {
      onRemove?.();
      setConfirmDelete(false);
    } else {
      setConfirmDelete(true);
    }
  };

  const handleItemToggle = async (item: DatasetItem, isCurrentlyShown: boolean) => {
    if (!mapId || !dataset) return;
    const itemLayerId = `item-${item.stac_item_id}`;

    if (isCurrentlyShown) {
      // Remove item layer
      const backendId = backendLayerIds[itemLayerId];
      if (backendId) {
        try {
          await datasetsApi.deleteMapLayer(mapId, backendId);
        } catch (err) {
          console.error('Failed to remove item layer:', err);
        }
      }
      removeLayer(itemLayerId);
    } else {
      // Add item layer
      try {
        // 1. Init in store first (so focusLayer can find it immediately)
        initLayer(itemLayerId, 'dataset', {
          name: item.stac_item_id,
          sourceType: 'stac_item',
          parentDatasetId: dataset.id,
          stacItemId: item.stac_item_id,
        });

        // 2. Create backend map layer record (non-blocking for UX)
        datasetsApi.addMapLayer(mapId, {
          name: item.stac_item_id,
          layer_type: 'raster',
          source_type: 'stac_item',
          stac_item_id: item.stac_item_id,
          source_config: { dataset_id: dataset.id },
        }).then((bl) => {
          setBackendLayerId(itemLayerId, bl.id);
        }).catch((err) => {
          console.error('Failed to persist item layer:', err);
        });

        // 3. Fetch tile config and apply
        const cfg = await datasetsApi.getItemTileConfig(dataset.id, item.id);
        
        // Compute tileBounds from item geometry for zoom-to-layer
        const tileBounds = geometryToTileBounds(item.geometry);
        
        // Apply default preset parameters to tile URL if rendering_config exists
        let tileUrl = cfg.tile_url_template;
        let activePreset: string | null = null;
        if (cfg.rendering_config?.default_preset && cfg.rendering_config.presets) {
          const defaultPreset = cfg.rendering_config.default_preset;
          const presetConfig = cfg.rendering_config.presets[defaultPreset];
          if (presetConfig?.params) {
            // Build query string manually to avoid URL() encoding {z}/{x}/{y} placeholders
            const params = new URLSearchParams();
            Object.entries(presetConfig.params).forEach(([key, value]) => {
              if (value) params.set(key, String(value));
            });
            const qs = params.toString();
            tileUrl = qs ? `${cfg.tile_url_template}?${qs}` : cfg.tile_url_template;
            activePreset = defaultPreset;
          }
        } else if (cfg.rendering_config?.bands && cfg.rendering_config.bands.length >= 3) {
          // No preset applied - apply default RGB band selection for color rendering
          const bands = cfg.rendering_config.bands;
          const r = bands[0]?.index ?? 1;
          const g = bands[1]?.index ?? 2;
          const b = bands[2]?.index ?? 3;
          const assetBidx = `data|${r},${g},${b}`;
          
          // Build rescale from band statistics
          const p2Vals = [bands[0]?.stats?.p2, bands[1]?.stats?.p2, bands[2]?.stats?.p2].filter(v => v != null) as number[];
          const p98Vals = [bands[0]?.stats?.p98, bands[1]?.stats?.p98, bands[2]?.stats?.p98].filter(v => v != null) as number[];
          
          const params = new URLSearchParams();
          params.set('asset_bidx', assetBidx);
          if (p2Vals.length === 3 && p98Vals.length === 3) {
            const rescale = `${Math.round(Math.min(...p2Vals))},${Math.round(Math.max(...p98Vals))}`;
            params.set('rescale', rescale);
          }
          tileUrl = `${cfg.tile_url_template}?${params.toString()}`;
          
          // Set band selection in store so UI reflects the applied bands
          useMapLayersStore.getState().setLayerBandSelection(itemLayerId, { r, g, b }, null);
        }
        
        setLayerTileConfig(itemLayerId, {
          tileUrl,
          ...(tileBounds ? { tileBounds } : {}),
        });
        
        // Store rendering config for band selection UI
        if (cfg.rendering_config) {
          useMapLayersStore.getState().setLayerRenderingConfig(itemLayerId, cfg.rendering_config);
        }
        
        // Set active preset if we applied one
        if (activePreset) {
          useMapLayersStore.getState().setLayerBandSelection(itemLayerId, null, activePreset);
        }
      } catch (err) {
        console.error('Failed to add item layer:', err);
      }
    }
  };

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Position relative to the card
    const rect = cardRef.current?.getBoundingClientRect();
    if (rect) {
      setCtxMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }
  }, []);

  // Auto-dismiss confirm after 3s
  useEffect(() => {
    if (!confirmDelete) return;
    const t = setTimeout(() => setConfirmDelete(false), 3000);
    return () => clearTimeout(t);
  }, [confirmDelete]);

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
        style={{
          display: 'flex',
          alignItems: 'center',
          height: 36,
          gap: 4,
          padding: '0 4px 0 0',
        }}
      >
        {/* Drag handle */}
        <div
          {...attributes}
          {...listeners}
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

        {/* Color swatch */}
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
              if (onRename) { e.stopPropagation(); setEditing(true); }
            }}
            style={{
              flex: 1, minWidth: 0, fontSize: 12, fontWeight: 500,
              color: layer.visible ? MC.text : MC.textMuted,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              cursor: 'pointer',
              padding: '0 4px',
            }}
            title={onRename ? `${name} (double-click to rename)` : name}
          >
            {name}
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
            width: 24, height: 24,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'transparent', border: 'none',
            cursor: 'pointer', flexShrink: 0, borderRadius: 3,
            color: layer.visible ? MC.accent : MC.borderLight,
            filter: layer.visible ? `drop-shadow(0 0 3px ${MC.accent}60)` : 'none',
            transition: 'color 0.15s, filter 0.15s',
          }}
        >
          {layer.visible ? <Eye size={13} /> : <EyeOff size={13} />}
        </button>

        {/* Expand toggle */}
        {hasExpandable && (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            title={expanded ? 'Collapse' : 'Expand'}
            style={{
              width: 20, height: 20,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none',
              color: MC.textMuted, cursor: 'pointer', flexShrink: 0, borderRadius: 3,
              transition: 'transform 0.15s',
            }}
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        )}

        {/* Delete */}
        {onRemove && (
          <button
            onClick={(e) => { e.stopPropagation(); handleDelete(); }}
            title={confirmDelete ? 'Click again to confirm' : 'Remove layer'}
            style={{
              width: 20, height: 20,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: confirmDelete ? `${MC.danger}18` : 'transparent',
              border: confirmDelete ? `1px solid ${MC.danger}40` : 'none',
              color: confirmDelete ? MC.danger : MC.textMuted,
              cursor: 'pointer', flexShrink: 0, borderRadius: 3,
              opacity: confirmDelete ? 1 : 0.5,
              transition: 'all 0.15s',
            }}
          >
            <X size={11} />
          </button>
        )}
      </div>

      {/* ── Delete confirmation bar ──────────────────────────── */}
      {confirmDelete && (
        <div style={{
          padding: '4px 8px', fontSize: 10, color: MC.danger,
          background: `${MC.danger}08`,
          borderTop: `1px solid ${MC.danger}20`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
        }}>
          Click <X size={9} /> again to remove
        </div>
      )}

      {/* ── Expanded: annotation set classes + count ───────────── */}
      {expanded && annotationSet && (
        <div style={{
          padding: '4px 10px 8px 30px',
          display: 'flex', flexDirection: 'column', gap: 3,
        }}>
          {/* Annotation count */}
          {annotationSet.annotation_count != null && (
            <div style={{ fontSize: 10, color: MC.textMuted, marginBottom: 2 }}>
              {annotationSet.annotation_count} annotation{annotationSet.annotation_count !== 1 ? 's' : ''}
            </div>
          )}

          {/* Classes with color swatches */}
          {classes.length > 0 ? (
            classes.map((cls) => {
              const fillColor = cls.style?.definition?.fillColor ?? MC.accent;
              return (
                <div key={cls.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: 2,
                    background: fillColor, flexShrink: 0, opacity: 0.85,
                  }} />
                  <span style={{
                    fontSize: 11, color: MC.textSecondary,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {cls.name}
                  </span>
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
          {/* Timeline button for multi-item temporal datasets */}
          {dataset.status === 'ready' && (dataset.metadata?.file_count ?? 0) > 1 && (
            <TimelineButton datasetId={dataset.id} fileCount={dataset.metadata?.file_count ?? 0} />
          )}

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
                  const itemLayerId = `item-${item.stac_item_id}`;
                  const itemLayer = isShown ? allLayers[itemLayerId] : null;
                  return (
                    <ItemSubRow
                      key={item.id}
                      item={item}
                      isShown={isShown}
                      itemLayer={itemLayer}
                      isSelected={selectedLayerId === itemLayerId}
                      onSelect={async () => {
                        if (!isShown) {
                          await handleItemToggle(item, false);
                        }
                        focusLayer(itemLayerId);
                      }}
                      onToggle={() => handleItemToggle(item, isShown)}
                      onVisibilityToggle={() => {
                        if (itemLayer) setLayerVisible(itemLayerId, !itemLayer.visible);
                      }}
                      onRemove={() => handleItemToggle(item, true)}
                    />
                  );
                })
              )}
            </>
          )}
        </div>
      )}

      {/* ── Right-click context menu ───────────────────────────── */}
      {ctxMenu && (
        <div
          ref={ctxRef}
          style={{
            position: 'absolute',
            top: ctxMenu.y,
            left: ctxMenu.x,
            zIndex: 200,
            minWidth: 160,
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
          {onRemove && (
            <>
              <div style={{ height: 1, background: MC.border, margin: '4px 0' }} />
              <CtxMenuItem
                icon={<Trash2 size={12} />}
                label="Remove from map"
                danger
                onClick={() => { handleDelete(); setCtxMenu(null); }}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Timeline button ─────────────────────────────────────────────────────────

function TimelineButton({ datasetId, fileCount }: { datasetId: string; fileCount: number }) {
  const openTimeline = useMapLayersStore((s) => s.openTimeline);
  const timelineDatasetId = useMapLayersStore((s) => s.timelineDatasetId);
  const isActive = timelineDatasetId === datasetId;

  return (
    <button
      onClick={(e) => { e.stopPropagation(); openTimeline(datasetId); }}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '4px 8px', borderRadius: 4,
        fontSize: 10, fontWeight: 600,
        background: isActive ? MC.accentDim : 'transparent',
        border: `1px solid ${isActive ? MC.accent : MC.border}`,
        color: isActive ? MC.accent : MC.textSecondary,
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      <Clock size={11} />
      Timeline ({fileCount} frames)
    </button>
  );
}

// ── Item sub-row (individual STAC item with controls) ───────────────────────

function ItemSubRow({
  item, isShown, itemLayer, isSelected, onSelect, onToggle, onVisibilityToggle, onRemove,
}: {
  item: DatasetItem;
  isShown: boolean;
  itemLayer: LayerConfig | null;
  isSelected: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onVisibilityToggle: () => void;
  onRemove: () => void;
}) {
  const [hover, setHover] = useState(false);
  const dateStr = item.datetime
    ? new Date(item.datetime).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : null;
  const label = dateStr ?? item.filename ?? `${item.stac_item_id.slice(0, 12)}…`;
  const isVisible = isShown ? (itemLayer?.visible ?? true) : false;

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={item.stac_item_id}
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        height: 30,
        padding: '0 4px 0 6px',
        borderRadius: 4,
        background: isSelected ? MC.accentDim : hover ? MC.hoverBg : 'transparent',
        border: `1px solid ${isSelected ? MC.accent : 'transparent'}`,
        transition: 'all 0.12s',
        cursor: 'pointer',
      }}
      onClick={onSelect}
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
          if (isShown) {
            onVisibilityToggle();
          } else {
            onToggle(); // Add to map
          }
        }}
        title={isShown ? (isVisible ? 'Hide layer' : 'Show layer') : 'Add to map'}
        style={{
          width: 22, height: 22,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'transparent', border: 'none',
          cursor: 'pointer', flexShrink: 0, borderRadius: 3,
          color: isShown && isVisible ? MC.accent : MC.borderLight,
          filter: isShown && isVisible ? `drop-shadow(0 0 3px ${MC.accent}60)` : 'none',
          transition: 'color 0.15s, filter 0.15s',
        }}
      >
        {isShown && isVisible ? <Eye size={12} /> : <EyeOff size={12} />}
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
            cursor: 'pointer', flexShrink: 0, borderRadius: 3,
            color: MC.textMuted, opacity: hover ? 0.7 : 0, transition: 'opacity 0.12s',
          }}
        >
          <X size={10} />
        </button>
      )}
    </div>
  );
}

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
