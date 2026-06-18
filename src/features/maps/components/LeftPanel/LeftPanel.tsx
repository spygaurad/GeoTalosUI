'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { Layers, ChevronLeft, ChevronRight, ChevronDown, Plus, ChevronUp } from 'lucide-react';
import { AnnotationSetPicker } from './AnnotationSetPicker';
import type { AnnotationSet as ApiAnnotationSet, AnnotationClass } from '@/types/api';
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
import type { Dataset, Annotation, TrackedObject, Alert, AnnotationSetMount } from '@/types/api';
import { useMapLayersStore } from '@/stores/mapLayersStore';
import { qk } from '@/lib/query-keys';
import { annotationSchemasApi } from '@/lib/api/annotation-schemas';
import { annotationClassesApi } from '@/lib/api/annotation-classes';
import { flyToAnnotationSet } from '../../utils/annotationSetMap';
import { buildClassStyles, resolveClassStyle } from '../../utils/annotationStyles';
import { annotationSetsApi, buildRasterTileUrl } from '@/lib/api/annotation-sets';
import { datasetsApi } from '@/lib/api/datasets';
import { MC, MAP_Z } from '../../mapColors';
import { useIsCompact } from '@/hooks/use-mobile';
import { asNonEmptyText, getClassDescription } from '@/features/maps/utils/mapTextUtils';
import {
  findContainingAoiId,
  type AoiCandidate,
  type Bbox,
} from '@/features/maps/utils/annotationSetHierarchy';

type PanelTab = 'layers' | 'legend';
const CLASS_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface LegendClassItem {
  key: string;
  color: string;
  label: string;
  description?: string;
}

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
  annotationSets?: AnnotationSetMount[];
  onRemoveDataset?: (datasetId: string) => void;
  onRemoveAnnotationSet?: (setId: string) => void;
  onRemoveAoi?: (aoiLayerId: string) => void;
  onRenameAnnotationSet?: (setId: string, newName: string) => void;
}

export function LeftPanel({
  open,
  onToggle,
  topOffset,
  bottomOffset,
  projectId,
  mapId,
  datasets,
  annotations,
  trackedObjects,
  alerts,
  annotationSets = [],
  onRemoveDataset,
  onRemoveAnnotationSet,
  onRemoveAoi,
  onRenameAnnotationSet,
}: LeftPanelProps) {
  const [tab, setTab] = useState<PanelTab>('layers');
  // Which AOI layers are expanded to reveal their nested child layers.
  // Default collapsed so the list stays tidy until the user opts in.
  const [expandedAois, setExpandedAois] = useState<Record<string, boolean>>({});
  const [selectedSchemaId, setSelectedSchemaId] = useState<string | null>(null);
  const [expandedSchemas, setExpandedSchemas] = useState<Record<string, boolean>>({});
  const isCompact = useIsCompact();
  const queryClient = useQueryClient();
  const [legendClassMeta, setLegendClassMeta] = useState<Record<string, { name: string; description?: string }>>({});
  const layers = useMapLayersStore((s) => s.layers);
  const applyReorder = useMapLayersStore((s) => s.applyReorder);
  const removeLayer = useMapLayersStore((s) => s.removeLayer);
  const addAnnotationSetLayer = useMapLayersStore((s) => s.addAnnotationSetLayer);

  // Fetch available annotation schemas for the legend browser
  const { data: schemasData } = useQuery({
    queryKey: qk.annotationSchemas.list(),
    queryFn: () => annotationSchemasApi.list(100),
  });
  const schemas = schemasData?.items ?? [];

  // Fetch classes for selected schema
  const { data: selectedSchemaData } = useQuery({
    queryKey: selectedSchemaId ? qk.annotationSchemas.classes(selectedSchemaId) : [],
    queryFn: () => selectedSchemaId ? annotationSchemasApi.getClasses(selectedSchemaId) : Promise.resolve({ items: [] }),
    enabled: !!selectedSchemaId,
  });
  const selectedSchemaClasses = selectedSchemaData?.items ?? [];

  // Picker state — `mode` drives which filters the picker uses.
  type PickerMode =
    | { kind: 'standalone' }
    | { kind: 'dataset'; datasetId: string; parentLayerId: string }
    | { kind: 'stacItem'; stacItemId: string; parentLayerId: string };
  const [picker, setPicker] = useState<PickerMode | null>(null);

  const handlePickSet = useCallback(
    async (s: ApiAnnotationSet) => {
      let schemaClasses =
        s.schema?.classes ??
        (s.schema_id
          ? queryClient.getQueryData<{ items: AnnotationClass[] }>(
              qk.annotationSchemas.classes(s.schema_id)
            )?.items
          : undefined);

      // If schema classes not available from cache, fetch them now
      if (!schemaClasses && s.schema_id) {
        try {
          const resp = await annotationSchemasApi.getClasses(s.schema_id);
          schemaClasses = resp.items;
          // Cache for future use
          queryClient.setQueryData(qk.annotationSchemas.classes(s.schema_id), resp);
        } catch {
          // Silently fail — will use default fallback colors
        }
      }

      const classStyles = buildClassStyles(schemaClasses);

      // Check if this annotation set is a raster segmentation mask.
      // If it has a saved raster config, render it as an authenticated raster tile layer.
      const rasterConfig = await annotationSetsApi.getRasterConfig(s.id);
      const isRasterMask = !!rasterConfig;
      const rasterTileUrl = rasterConfig ? buildRasterTileUrl(rasterConfig) : undefined;

      if (!picker) return;
      let layerId: string;
      if (picker.kind === 'standalone') {
        layerId = addAnnotationSetLayer({ setId: s.id, name: s.name, classStyles, isRasterMask, tileUrl: rasterTileUrl });
      } else if (picker.kind === 'dataset') {
        layerId = addAnnotationSetLayer({
          setId: s.id,
          name: s.name,
          classStyles,
          parentLayerId: picker.parentLayerId,
          datasetId: picker.datasetId,
          isRasterMask,
          tileUrl: rasterTileUrl,
        });
      } else {
        layerId = addAnnotationSetLayer({
          setId: s.id,
          name: s.name,
          classStyles,
          parentLayerId: picker.parentLayerId,
          stacItemId: picker.stacItemId,
          isRasterMask,
          tileUrl: rasterTileUrl,
        });
      }
      // Persist the layer on the backend via the mount endpoint — symmetric with
      // removal's unmount. This is the single source `listByMap` reads back on
      // reload, so adding a set now survives a refresh. The mount is idempotent
      // server-side, so re-adding an already-mounted set is a no-op.
      if (mapId) {
        const created = useMapLayersStore.getState().layers[layerId];
        void annotationSetsApi
          .mount(mapId, {
            annotation_set_id: s.id,
            visible: created?.visible ?? true,
            opacity: created?.opacity ?? 1,
            z_index: created?.zIndex ?? 0,
          })
          .then(() =>
            queryClient.invalidateQueries({ queryKey: qk.annotationSets.listByMap(mapId) }),
          )
          .catch(() => {
            // Layer still shows locally; it just won't persist until the next add.
          });
      }

      // For vector annotation sets, zoom to the annotation bounds.
      // Raster masks don't have annotations so skip the fly-to.
      if (!isRasterMask) {
        void flyToAnnotationSet(layerId, s.id);
      }
    },
    [picker, addAnnotationSetLayer, queryClient, mapId],
  );

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
  const annotationSetById = useMemo(
    () => new Map(annotationSets.map((set) => [set.annotation_set_id, set])),
    [annotationSets],
  );
  // Mount rows carry only schema_id (no embedded schema/classes), so there's
  // nothing to pre-seed here — legend class metadata is fetched on demand for
  // every class id found in layer.classStyles below.
  const schemaClassIds = useMemo(() => new Set<string>(), []);
  const legendClassIdsToFetch = useMemo(() => {
    const ids = new Set<string>();
    for (const layer of Object.values(layers)) {
      if (layer.sourceType !== 'annotation_set' || !layer.classStyles) continue;
      for (const classKey of Object.keys(layer.classStyles)) {
        if (!CLASS_ID_RE.test(classKey)) continue;
        if (legendClassMeta[classKey]) continue;
        if (schemaClassIds.has(classKey)) continue;
        ids.add(classKey);
      }
    }
    return [...ids];
  }, [layers, legendClassMeta, schemaClassIds]);

  useEffect(() => {
    if (legendClassIdsToFetch.length === 0) return;
    let cancelled = false;
    Promise.allSettled(
      legendClassIdsToFetch.map((classId) => annotationClassesApi.get(classId)),
    ).then((results) => {
      if (cancelled) return;
      setLegendClassMeta((prev) => {
        const next = { ...prev };
        for (const result of results) {
          if (result.status !== 'fulfilled') continue;
          const cls = result.value;
          next[cls.id] = {
            name: cls.name,
            description: asNonEmptyText(cls.description) ?? getClassDescription(cls),
          };
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [legendClassIdsToFetch]);

  const loadedAnnotationLegendSections = useMemo(() => {
    const sections: Array<{ layerId: string; title: string; description?: string; classes: LegendClassItem[] }> = [];
    for (const [layerId, layer] of Object.entries(layers)) {
      if (layer.sourceType !== 'annotation_set') continue;
      const setId = layer.annotationSetId ?? (layerId.startsWith('annset-') ? layerId.slice(7) : undefined);
      const annSet = setId ? annotationSetById.get(setId) : undefined;
      // Mount rows have no embedded schema; class rows come from layer.classStyles
      // + fetched legendClassMeta (the fallback block below).
      const schemaClasses: AnnotationClass[] = [];
      const classRows: LegendClassItem[] = [];

      for (const cls of schemaClasses) {
        const resolved = resolveClassStyle(layer.classStyles, cls.id);
        classRows.push({
          key: cls.id,
          color: resolved?.fillColor ?? cls.style?.definition?.fillColor ?? MC.accent,
          label: cls.name || cls.path || legendClassMeta[cls.id]?.name || `Class ${cls.id.slice(0, 8)}`,
          description: getClassDescription(cls) ?? legendClassMeta[cls.id]?.description,
        });
      }

      if (classRows.length === 0 && layer.classStyles) {
        const allEntries = Object.entries(layer.classStyles);
        const uuidEntries = allEntries.filter(([key]) => CLASS_ID_RE.test(key));
        const sourceEntries = uuidEntries.length > 0 ? uuidEntries : allEntries;
        const seen = new Set<string>();
        for (const [key, style] of sourceEntries) {
          const meta = CLASS_ID_RE.test(key) ? legendClassMeta[key] : undefined;
          const label = meta?.name ?? (CLASS_ID_RE.test(key) ? `Class ${key.slice(0, 8)}` : key);
          const dedupeKey = `${label}|${style.fillColor}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);
          classRows.push({
            key,
            color: style.fillColor,
            label,
            description: meta?.description,
          });
        }
      }

      const title =
        asNonEmptyText(layer.name) ??
        asNonEmptyText(annSet?.set_name) ??
        (setId ? `Annotation set ${setId.slice(0, 8)}` : 'Annotation set');
      const rasterSuffix = layer.isRasterMask ? ' (raster mask)' : '';
      sections.push({
        layerId,
        title: title + rasterSuffix,
        classes: classRows,
      });
    }
    return sections;
  }, [layers, annotationSetById, legendClassMeta]);
  const hasLegendItems =
    loadedAnnotationLegendSections.length > 0 ||
    Object.entries(annotationsByLabel).length > 0 ||
    datasets.length > 0 ||
    trackedObjects.length > 0 ||
    alerts.length > 0;

  // ── Build a hierarchical layer list for the "all layers" view ──
  // - Item layers (item-*) are nested inside their parent dataset card, not shown top-level
  // - Child layers (with parentAoiId) are rendered after their parent AOI
  const allLayerEntries = Object.entries(layers)
    .filter(([id]) => !id.startsWith('item-'))
    .sort(([, a], [, b]) => b.zIndex - a.zIndex); // top of stack first

  // AOI auto-nest: the backend has no AOI↔annotation-set link, so we derive one
  // here — an annotation-set layer whose extent falls entirely inside an AOI's
  // bbox is shown nested under that AOI. Smallest containing AOI wins.
  const aoiCandidates: AoiCandidate[] = Object.entries(layers)
    .filter(([, l]) => l.type === 'aoi' && Array.isArray(l.aoiBbox))
    .map(([id, l]) => ({ id, bbox: l.aoiBbox as Bbox }));

  const derivedAoiParent = new Map<string, string>();
  if (aoiCandidates.length > 0) {
    for (const [id, layer] of Object.entries(layers)) {
      if (layer.sourceType !== 'annotation_set' || layer.parentAoiId) continue;
      const setId = id.startsWith('annset-') ? id.replace('annset-', '') : null;
      const set = setId ? annotationSets.find((s) => s.annotation_set_id === setId) : null;
      const extent = (set?.extent_4326 ?? layer.bounds ?? null) as Bbox | null;
      const aoiId = findContainingAoiId(extent, aoiCandidates);
      if (aoiId) derivedAoiParent.set(id, aoiId);
    }
  }

  // Separate top-level layers from child layers.
  // A layer is a "child" if:
  //  • it has parentAoiId (AOI-bounded dataset), OR
  //  • it is an annotation_set layer nested under a dataset or an AOI (derived).
  const isAnnSetChild = (id: string, layer: typeof layers[string]) =>
    layer.sourceType === 'annotation_set' &&
    ((!!layer.parentDatasetId && !!layers[layer.parentDatasetId]) || derivedAoiParent.has(id));

  const topLevelEntries = allLayerEntries.filter(
    ([id, layer]) => !layer.parentAoiId && !isAnnSetChild(id, layer),
  );
  const childLayersByParent = new Map<string, typeof allLayerEntries>();
  for (const entry of allLayerEntries) {
    const [id, layer] = entry;
    const parentId =
      layer.parentAoiId ??
      derivedAoiParent.get(id) ??
      (isAnnSetChild(id, layer) ? layer.parentDatasetId : undefined);
    if (parentId) {
      const existing = childLayersByParent.get(parentId) ?? [];
      existing.push(entry);
      childLayersByParent.set(parentId, existing);
    }
  }

  // Build flattened display list: parent followed by its children
  const sortedLayerEntries: Array<[string, typeof layers[string], boolean]> = [];
  for (const [id, layer] of topLevelEntries) {
    sortedLayerEntries.push([id, layer, false]); // false = not a child layer
    const children = childLayersByParent.get(id);
    if (children) {
      // AOI children are hidden behind the AOI's expand arrow; other parents
      // (e.g. datasets) keep their existing always-visible nesting.
      if (layer.type === 'aoi' && !expandedAois[id]) continue;
      for (const [childId, childLayer] of children) {
        sortedLayerEntries.push([childId, childLayer, true]); // true = child layer
      }
    }
  }

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
          onClick={() => setPicker({ kind: 'standalone' })}
          title="Add annotation layer"
          aria-label="Add annotation layer"
          style={{
            width: 26,
            height: 26,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            border: 'none',
            color: MC.navAccent,
            cursor: 'pointer',
            borderRadius: 4,
            flexShrink: 0,
          }}
        >
          <Plus size={14} />
        </button>
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
                    {sortedLayerEntries.map(([id, layer, isChild]) => {
                      // For regular datasets: layerId === datasetId
                      // For AOI child datasets: use sourceDatasetId from layer config
                      const datasetId = layer.sourceType === 'dataset'
                        ? (isChild ? (layer.sourceDatasetId ?? null) : id)
                        : null;
                      const dataset = datasetId ? datasets.find((d) => d.id === datasetId) : undefined;
                      // Set id is derivable from the layer itself (persisted in
                      // base_layers), so renaming works even when the map-mounts
                      // metadata query hasn't loaded the full annSet object.
                      const annSetId = id.startsWith('annset-')
                        ? id.replace('annset-', '')
                        : (layer.annotationSetId ?? null);
                      const annSet = annSetId ? annotationSets.find((s) => s.annotation_set_id === annSetId) : null;

                      // Resolve display name
                      let displayName: string;
                      if (layer.type === 'aoi') {
                        displayName = layer.name ?? 'AOI';
                      } else if (isChild && layer.name) {
                        // Child layers already have descriptive names like "Dataset Name (in AOI 1)"
                        displayName = layer.name;
                      } else if (dataset) {
                        displayName = dataset.name;
                      } else if (annSet?.set_name) {
                        displayName = annSet.set_name;
                      } else if (id === 'tracking-all') {
                        displayName = `${trackedObjects.length} tracked object${trackedObjects.length !== 1 ? 's' : ''}`;
                      } else if (id === 'alerts-all') {
                        displayName = `${alerts.length} alert${alerts.length !== 1 ? 's' : ''}`;
                      } else {
                        displayName = layer.tileServiceUrl
                          ? `${layer.name ?? 'Tile Service'} (Basemap)`
                          : (layer.name ?? id);
                      }

                      // Remove handler — always available for all layer types
                      const isAnnotationSetLayer = layer.sourceType === 'annotation_set';
                      let handleRemove: (() => void) | undefined;

                      if (isChild) {
                        // Child layers always removable via removeLayer
                        handleRemove = () => removeLayer(id);
                      } else if (layer.type === 'aoi' && onRemoveAoi) {
                        // AOI layers use the API callback if available
                        handleRemove = () => onRemoveAoi(id);
                      } else if (layer.type === 'aoi') {
                        // Fall back to removeLayer if no API handler
                        handleRemove = () => removeLayer(id);
                      } else if (dataset && onRemoveDataset) {
                        // Datasets use the API callback if available
                        handleRemove = () => onRemoveDataset(dataset.id);
                      } else if (isAnnotationSetLayer && annSetId && onRemoveAnnotationSet) {
                        // Annotation sets use the API callback. Gate on annSetId
                        // (derived from the layer), NOT the joined annSet object —
                        // mounts key on `annotation_set_id` so annSet is undefined,
                        // which previously fell through to a local-only removeLayer
                        // and never hit the backend.
                        handleRemove = () => onRemoveAnnotationSet(annSetId);
                      } else if (isAnnotationSetLayer || layer.type === 'tracking' || layer.type === 'alert') {
                        // Fall back to removeLayer for annotation sets, tracking, alerts
                        handleRemove = () => removeLayer(id);
                      } else if (layer.tileServiceUrl) {
                        // Tile service / basemap layers — removable. Drop the backend
                        // layer too (if persisted) so it doesn't reappear on reload,
                        // then remove locally to fall back to the default basemap.
                        handleRemove = () => {
                          const backendId = useMapLayersStore.getState().backendLayerIds[id];
                          if (mapId && backendId) {
                            void datasetsApi.deleteMapLayer(mapId, backendId).catch(() => {});
                          }
                          removeLayer(id);
                        };
                      } else {
                        // Other layer types are not removable
                        handleRemove = undefined;
                      }

                      // Rename handler (annotation sets only). Gate on the id, not
                      // the joined annSet object, so it stays available when the
                      // mounts metadata query fails/loads late.
                      const handleRename = annSetId && onRenameAnnotationSet
                        ? (newName: string) => onRenameAnnotationSet(annSetId, newName)
                        : undefined;

                      return (
                        <div
                          key={id}
                          style={{
                            marginLeft: isChild ? 20 : 0,
                            position: 'relative',
                          }}
                        >
                          {isChild && (
                            <div
                              style={{
                                position: 'absolute',
                                left: -12,
                                top: 0,
                                bottom: 0,
                                width: 1,
                                background: MC.borderLight,
                              }}
                            />
                          )}
                          {(() => {
                            const aoiChildCount =
                              layer.type === 'aoi' ? childLayersByParent.get(id)?.length ?? 0 : 0;
                            const aoiToggle =
                              layer.type === 'aoi' && aoiChildCount > 0
                                ? () => setExpandedAois((p) => ({ ...p, [id]: !p[id] }))
                                : undefined;
                            return (
                              <LayerCard
                                id={id}
                                name={displayName}
                                type={layer.type}
                                dataset={dataset}
                                annotationSet={annSet ?? undefined}
                                mapId={mapId}
                                onRemove={handleRemove}
                                onRename={handleRename}
                                aoiExpanded={aoiToggle ? !!expandedAois[id] : undefined}
                                onToggleAoiExpand={aoiToggle}
                                childCount={aoiToggle ? aoiChildCount : undefined}
                              />
                            );
                          })()}
                          {/* Inline "Add annotation layer" affordance on dataset / stac_item layers */}
                          {(layer.sourceType === 'dataset' || layer.sourceType === 'stac_item') && (
                            <button
                              onClick={() => {
                                if (layer.sourceType === 'stac_item' && layer.stacItemId) {
                                  setPicker({ kind: 'stacItem', stacItemId: layer.stacItemId, parentLayerId: id });
                                } else if (datasetId) {
                                  setPicker({ kind: 'dataset', datasetId, parentLayerId: id });
                                }
                              }}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  marginLeft: 28,
                                  padding: '2px 6px',
                                  background: 'transparent',
                                  border: 'none',
                                  color: MC.accent,
                                  fontSize: 10,
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                }}
                              >
                                <Plus size={11} /> Add annotation layer
                              </button>
                            )}
                        </div>
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
            {/* Schema browser */}
            {schemas.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: MC.sectionLabel,
                  marginBottom: 6,
                }}>
                  Annotation Schemas
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {schemas.map((schema) => (
                    <div key={schema.id}>
                      <button
                        onClick={() => {
                          setSelectedSchemaId(selectedSchemaId === schema.id ? null : schema.id);
                          if (selectedSchemaId !== schema.id) {
                            setExpandedSchemas((prev) => ({ ...prev, [schema.id]: true }));
                          }
                        }}
                        style={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '6px 8px',
                          background: selectedSchemaId === schema.id ? MC.accentDim : 'transparent',
                          border: `1px solid ${selectedSchemaId === schema.id ? MC.accent : MC.border}`,
                          borderRadius: 4,
                          cursor: 'pointer',
                          color: MC.text,
                          fontSize: 11,
                          fontWeight: 500,
                          textAlign: 'left',
                          transition: 'all 0.15s',
                        }}
                      >
                        {selectedSchemaId === schema.id ? (
                          <ChevronDown size={12} style={{ flexShrink: 0, color: MC.accent }} />
                        ) : (
                          <ChevronRight size={12} style={{ flexShrink: 0, color: MC.textMuted }} />
                        )}
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {schema.name}
                        </span>
                        {selectedSchemaId === schema.id && selectedSchemaClasses.length > 0 && (
                          <span style={{ fontSize: 9, color: MC.textMuted, flexShrink: 0 }}>
                            {selectedSchemaClasses.length}
                          </span>
                        )}
                      </button>

                      {/* Classes for selected schema */}
                      {selectedSchemaId === schema.id && (
                        <div style={{ padding: '6px 8px 8px 28px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {selectedSchemaClasses.length > 0 ? (
                            selectedSchemaClasses.map((cls) => {
                              const fillColor = cls.style?.definition?.fillColor ?? MC.accent;
                              return (
                                <div key={cls.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                                  <div style={{
                                    width: 8,
                                    height: 8,
                                    borderRadius: 2,
                                    background: fillColor,
                                    flexShrink: 0,
                                    opacity: 0.85,
                                    marginTop: 2,
                                  }} />
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <span style={{
                                      fontSize: 11,
                                      color: MC.textSecondary,
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                      display: 'block',
                                    }}>
                                      {cls.name || cls.path || `Class ${cls.id.slice(0, 8)}`}
                                    </span>
                                    {cls.description && (
                                      <span style={{
                                        fontSize: 10,
                                        color: MC.textMuted,
                                        lineHeight: 1.3,
                                        display: '-webkit-box',
                                        WebkitLineClamp: 2,
                                        WebkitBoxOrient: 'vertical',
                                        overflow: 'hidden',
                                      }}>
                                        {cls.description}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })
                          ) : (
                            <div style={{ fontSize: 10, color: MC.textMuted, fontStyle: 'italic', padding: '3px 0' }}>
                              No classes in schema
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div style={{ height: 1, background: MC.border, margin: '12px 0' }} />
              </div>
            )}

            {/* Annotation sets with class legends */}
            {loadedAnnotationLegendSections.map((section) => (
              <LegendSection key={section.layerId} title={section.title} subtitle={section.description}>
                {section.classes.map((cls) => (
                  <LegendRow
                    key={cls.key}
                    color={cls.color}
                    label={cls.label}
                    description={cls.description}
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

            {!hasLegendItems && (
              <div style={{ padding: '20px 0', fontSize: 12, color: MC.textMuted, textAlign: 'center', fontStyle: 'italic' }}>
                Add layers to build a legend.
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );

  // ── Picker modal (rendered in both compact & desktop modes) ───────────────
  const pickerEl = (
    <AnnotationSetPicker
      open={!!picker}
      onClose={() => setPicker(null)}
      title={
        picker?.kind === 'standalone'
          ? 'Add annotation layer'
          : picker?.kind === 'dataset'
            ? 'Attach annotation layer to dataset'
            : 'Attach annotation layer to item'
      }
      projectId={picker && picker.kind !== 'standalone' ? projectId : undefined}
      filters={
        picker?.kind === 'standalone'
          ? { unattached: true }
          : picker?.kind === 'dataset'
            ? { datasetId: picker.datasetId }
            : picker?.kind === 'stacItem'
              ? { stacItemId: picker.stacItemId }
              : undefined
      }
      onPick={handlePickSet}
    />
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
        {pickerEl}
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
      {pickerEl}
    </>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────
function LegendSection({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
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
      {subtitle && (
        <div style={{
          fontSize: 11,
          color: MC.textMuted,
          marginBottom: 6,
          lineHeight: 1.35,
        }}>
          {subtitle}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{children}</div>
    </div>
  );
}

function LegendRow({
  color, label, description, count, shape,
}: {
  color: string; label: string; description?: string; count?: number; shape: 'circle' | 'square';
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
      <div style={{
        width: 12, height: 12,
        borderRadius: shape === 'circle' ? '50%' : 2,
        background: color,
        flexShrink: 0,
        opacity: 0.85,
        marginTop: description ? 2 : 1,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{
          display: 'block',
          fontSize: 12,
          color: MC.textSecondary,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }} title={label}>
          {label}
        </span>
        {description && (
          <span style={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            fontSize: 11,
            color: MC.textMuted,
            lineHeight: 1.3,
          }} title={description}>
            {description}
          </span>
        )}
      </div>
      {typeof count === 'number' && (
        <span style={{ fontSize: 11, color: MC.textMuted, flexShrink: 0 }}>
          {count.toLocaleString()}
        </span>
      )}
    </div>
  );
}
