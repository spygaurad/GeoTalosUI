'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import { X, Search, Database, Link, Upload, CheckCircle, Clock, AlertCircle, Loader, ArrowRight, Globe, Plus, Tags } from 'lucide-react';
import { toast } from 'sonner';
import type { Dataset, AnnotationSet, AnnotationClass } from '@/types/api';
import { datasetsApi } from '@/lib/api/datasets';
import { annotationSetsApi } from '@/lib/api/annotation-sets';
import { annotationSchemasApi } from '@/lib/api/annotation-schemas';
import { flyToAnnotationSet } from '../utils/annotationSetMap';
import { buildClassStyles } from '../utils/annotationStyles';
import { qk } from '@/lib/query-keys';
import { useMapLayersStore } from '@/stores/mapLayersStore';
import { useUploadStore } from '@/stores/uploadStore';
import { UploadWizard } from '@/features/datasets/components/UploadWizard';
import { MC, MAP_Z } from '../mapColors';
import { getMapInstance } from '@/stores/mapStore';

type LibTab = 'datasets' | 'annotations' | 'sources' | 'upload';

const STATUS_ICON: Record<string, React.ReactNode> = {
  ready:     <CheckCircle size={12} style={{ color: MC.success }} />,
  pending:   <Clock size={12} style={{ color: MC.warning }} />,
  ingesting: <Loader size={12} style={{ color: MC.info }} />,
  failed:    <AlertCircle size={12} style={{ color: MC.danger }} />,
};

interface LibraryPanelProps {
  open: boolean;
  topOffset: number;
  bottomOffset: number;
  projectId: string;
  mapId?: string;
  datasets: Dataset[];
  onClose: () => void;
  onAddDatasetToMap?: (datasetId: string) => void;
}

export function LibraryPanel({
  open,
  topOffset,
  bottomOffset,
  datasets,
  mapId,
  onClose,
  onAddDatasetToMap,
}: LibraryPanelProps) {
  const [tab, setTab] = useState<LibTab>('datasets');
  const [query, setQuery] = useState('');
  const [readyOnly, setReadyOnly] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const initLayer = useMapLayersStore((s) => s.initLayer);
  const setBackendLayerId = useMapLayersStore((s) => s.setBackendLayerId);
  const addAnnotationSetLayer = useMapLayersStore((s) => s.addAnnotationSetLayer);
  const layers = useMapLayersStore((s) => s.layers);
  const activeUpload = useUploadStore((s) => s.upload);
  const queryClient = useQueryClient();

  const filtered = datasets.filter((d) => {
    if (query && !d.name.toLowerCase().includes(query.toLowerCase())) return false;
    if (readyOnly && d.status !== 'ready') return false;
    return true;
  });

  const addToMap = async (d: Dataset) => {
    if (!mapId) {
      initLayer(d.id, 'dataset', { sourceType: 'dataset' });
      toast.success(`"${d.name}" added to map`);
      return;
    }

    setAdding(d.id);
    try {
      // 1. Init dataset as a group container (no tiles — items are the actual layers)
      initLayer(d.id, 'dataset', { sourceType: 'dataset' });

      // 2. Persist to backend
      const bl = await datasetsApi.addMapLayer(mapId, {
        name: d.name,
        layer_type: 'raster',
        source_type: 'dataset',
        dataset_id: d.id,
        opacity: 1.0,
        visible: true,
      });
      setBackendLayerId(d.id, bl.id);
      await queryClient.invalidateQueries({ queryKey: qk.maps.detail(mapId) });

      // 3. Cache rendering_config for child item layers
      const rc = d.metadata?.rendering_config;
      if (rc) {
        useMapLayersStore.getState().setLayerRenderingConfig(d.id, rc);
      }

      // 4. Fly to dataset geometry bounds
      if (d.geometry) {
        const map = getMapInstance();
        if (map) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const L = require('leaflet') as typeof import('leaflet');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const layer = L.geoJSON(d.geometry as any);
            map.fitBounds(layer.getBounds(), { padding: [40, 40], maxZoom: 16 });
          } catch {
            // ignore
          }
        }
      }

      toast.success(`"${d.name}" added to map`);
    } catch {
      toast.error(`Failed to add "${d.name}"`);
    } finally {
      setAdding(null);
    }
  };

  const isOnMap = (id: string) => !!layers[id];

  const maxPanelH = topOffset > 0
    ? `calc(100vh - ${topOffset + bottomOffset + 32}px)`
    : 'calc(100% - 32px)';

  const handleAddToMap = (datasetId: string) => {
    initLayer(datasetId, 'dataset', { sourceType: 'dataset' });
    if (onAddDatasetToMap) onAddDatasetToMap(datasetId);
    toast.success('Dataset added to map');
    setTab('datasets');
  };

  const isUploadActive = activeUpload && activeUpload.phase !== 'idle';
  const uploadPct = activeUpload?.progress.bytesTotal
    ? Math.round((activeUpload.progress.bytesUploaded / activeUpload.progress.bytesTotal) * 100)
    : 0;

  return (
    <>
      {/* ── Backdrop ────────────────────────────────────────────── */}
      <div
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: MAP_Z.libraryBackdrop,
          background: 'rgba(28,33,25,0.52)',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 0.2s ease',
        }}
      />

      {/* ── Popup panel ─────────────────────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          top: topOffset + 16,
          left: '50%',
          zIndex: MAP_Z.library,
          width: 'min(560px, calc(100vw - 32px))',
          maxHeight: maxPanelH,
          transform: open
            ? 'translateX(-50%) translateY(0) scale(1)'
            : 'translateX(-50%) translateY(-12px) scale(0.97)',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'transform 0.22s cubic-bezier(0.2,0,0,1), opacity 0.18s ease',
          background: MC.panelBg,
          border: `1px solid ${MC.panelBorder}`,
          borderRadius: 10,
          boxShadow: MC.shadowLg,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            height: 48,
            display: 'flex',
            alignItems: 'center',
            paddingLeft: 16,
            paddingRight: 10,
            borderBottom: `1px solid ${MC.navBorder}`,
            flexShrink: 0,
            gap: 8,
            background: MC.navBg,
          }}
        >
          <Database size={15} style={{ color: MC.navAccent, flexShrink: 0 }} />
          <span style={{
            flex: 1,
            fontSize: 13,
            fontWeight: 700,
            color: MC.navText,
            letterSpacing: '0.01em',
          }}>
            Library
          </span>
          <button
            onClick={onClose}
            style={{
              width: 30,
              height: 30,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              color: MC.navTextMuted,
              cursor: 'pointer',
              borderRadius: 5,
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: `1px solid ${MC.border}`, flexShrink: 0 }}>
          {([
            { id: 'datasets' as LibTab,    label: 'Rasters',     icon: <Database size={11} /> },
            { id: 'annotations' as LibTab, label: 'Annotations', icon: <Tags size={11} /> },
            { id: 'sources' as LibTab,     label: 'Sources',     icon: <Link size={11} /> },
            { id: 'upload' as LibTab,   label: 'Upload',   icon: <Upload size={11} />, badge: isUploadActive },
          ] as const).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                flex: 1,
                height: 38,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                background: 'transparent',
                color: tab === t.id ? MC.accent : MC.textMuted,
                border: 'none',
                borderBottomWidth: 2,
                borderBottomStyle: 'solid',
                borderBottomColor: tab === t.id ? MC.accent : 'transparent',
                cursor: 'pointer',
                marginBottom: -1,
                transition: 'color 0.12s',
                position: 'relative',
              }}
            >
              {t.icon}
              {t.label}
              {'badge' in t && t.badge && (
                <span style={{
                  width: 6, height: 6,
                  borderRadius: '50%',
                  background: MC.accent,
                  position: 'absolute',
                  top: 8, right: 8,
                }} />
              )}
            </button>
          ))}
        </div>

        {/* ── Datasets tab ─────────────────────────────────────── */}
        {tab === 'datasets' && (
          <>
            {/* Active upload progress row */}
            {isUploadActive && activeUpload.phase === 'uploading' && (
              <div
                onClick={() => setTab('upload')}
                style={{
                  padding: '8px 14px',
                  borderBottom: `1px solid ${MC.border}`,
                  background: MC.accentDim,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: MC.accent }}>
                    Uploading {activeUpload.datasetName}
                  </span>
                  <span style={{ fontSize: 11, color: MC.textMuted }}>
                    {activeUpload.progress.partsCompleted}/{activeUpload.progress.partsTotal} parts · {uploadPct}%
                  </span>
                </div>
                <div style={{ height: 3, borderRadius: 2, background: MC.borderLight, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${uploadPct}%`,
                    background: MC.accent,
                    borderRadius: 2,
                    transition: 'width 0.4s ease',
                  }} />
                </div>
              </div>
            )}

            {/* Ingesting row */}
            {isUploadActive && activeUpload.phase === 'ingesting' && (
              <div
                onClick={() => setTab('upload')}
                style={{
                  padding: '8px 14px',
                  borderBottom: `1px solid ${MC.border}`,
                  background: MC.accentDim,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flexShrink: 0,
                }}
              >
                <Loader size={12} style={{ color: MC.navAccent, flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: MC.accent, flex: 1 }}>
                  Processing {activeUpload.datasetName}…
                </span>
                <ArrowRight size={12} style={{ color: MC.textMuted }} />
              </div>
            )}

            {/* Search + Filter */}
            <div style={{ padding: '10px 12px', borderBottom: `1px solid ${MC.border}`, flexShrink: 0 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: MC.inputBg,
                  borderRadius: 6,
                  padding: '6px 10px',
                  border: `1px solid ${MC.inputBorder}`,
                }}
              >
                <Search size={12} style={{ color: MC.textMuted, flexShrink: 0 }} />
                <input
                  type="text"
                  placeholder="Search datasets…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  style={{
                    flex: 1,
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                    color: MC.text,
                    fontSize: 13,
                  }}
                />
              </div>
              {/* Ready-only filter toggle */}
              <button
                onClick={() => setReadyOnly((v) => !v)}
                style={{
                  marginTop: 8,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 8px',
                  borderRadius: 4,
                  border: readyOnly ? `1px solid ${MC.accent}` : `1px solid ${MC.border}`,
                  background: readyOnly ? MC.accentDim : 'transparent',
                  color: readyOnly ? MC.accent : MC.textMuted,
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 500,
                }}
              >
                <CheckCircle size={10} />
                Ready only
              </button>
            </div>

            {/* List */}
            <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
              {filtered.length === 0 ? (
                <div style={{
                  padding: '32px 20px',
                  fontSize: 13,
                  color: MC.textMuted,
                  textAlign: 'center',
                  fontStyle: 'italic',
                }}>
                  {query ? `No datasets matching "${query}"` : 'No datasets yet — upload one to get started.'}
                </div>
              ) : (
                filtered.map((d) => (
                  <div
                    key={d.id}
                    style={{
                      padding: '11px 14px',
                      borderBottom: `1px solid ${MC.border}`,
                      display: 'flex',
                      gap: 10,
                      alignItems: 'flex-start',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                        {STATUS_ICON[d.status] ?? null}
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: MC.text,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={d.name}
                        >
                          {d.name}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: MC.textMuted }}>
                        {(d.metadata?.file_count ?? 0) > 0 && `${d.metadata!.file_count!.toLocaleString()} files · `}{d.dataset_type} · {d.status}
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        if (isOnMap(d.id) || adding === d.id) return;
                        if (d.status !== 'ready') {
                          toast.info('Dataset is not ready yet');
                          return;
                        }
                        addToMap(d);
                      }}
                      disabled={isOnMap(d.id) || d.status !== 'ready' || adding === d.id}
                      style={{
                        flexShrink: 0,
                        height: 28,
                        padding: '0 10px',
                        borderRadius: 5,
                        border: `1px solid ${isOnMap(d.id) ? MC.borderLight : d.status === 'ready' ? MC.accent : MC.borderLight}`,
                        background: isOnMap(d.id) ? 'transparent' : d.status === 'ready' ? MC.accentDim : 'transparent',
                        color: isOnMap(d.id) ? MC.textMuted : d.status === 'ready' ? MC.accent : MC.textMuted,
                        cursor: isOnMap(d.id) || d.status !== 'ready' || adding === d.id ? 'default' : 'pointer',
                        fontSize: 11,
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                        transition: 'all 0.1s',
                      }}
                    >
                      {isOnMap(d.id) ? 'On map' : adding === d.id ? '…' : d.status === 'ready' ? 'Add' : d.status}
                    </button>
                  </div>
                ))
              )}
            </div>
          </>
        )}

        {/* ── Annotations tab — add annotation sets as vector layers ─ */}
        {tab === 'annotations' && (
          <AnnotationSetsTab
            onAdd={async (s) => {
              // First try embedded schema, then try the query cache
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

              const layerId = addAnnotationSetLayer({
                setId: s.id,
                name: s.name,
                classStyles: buildClassStyles(schemaClasses),
              });
              toast.success(`"${s.name}" added to map`);
              // Async: fetch bounds, set pointer, fly to annotation location
              void flyToAnnotationSet(layerId, s.id);
            }}
            isOnMap={(setId) => !!layers[`annset-${setId}`]}
          />
        )}

        {/* ── Sources tab — add external tile services ─────────── */}
        {tab === 'sources' && (
          <TileServiceTab mapId={mapId} />
        )}

        {tab === 'upload' && (
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            <UploadWizard
              mapId={mapId}
              onAddToMap={handleAddToMap}
            />
          </div>
        )}
      </div>
    </>
  );
}

// ── Annotation Sets Tab — list org sets, add as Martin MVT vector layers ─────
function AnnotationSetsTab({
  onAdd,
  isOnMap,
}: {
  onAdd: (s: AnnotationSet) => void;
  isOnMap: (setId: string) => boolean;
}) {
  const [query, setQuery] = useState('');
  const setsQ = useQuery({
    queryKey: ['annotation-sets', 'org', 'library'],
    queryFn: () => annotationSetsApi.listByOrg(),
  });
  const items = (setsQ.data?.items ?? []).filter(
    (s) => !query || s.name.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <>
      <div style={{ padding: '10px 12px', borderBottom: `1px solid ${MC.border}`, flexShrink: 0 }}>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: MC.inputBg, borderRadius: 6, padding: '6px 10px',
            border: `1px solid ${MC.inputBorder}`,
          }}
        >
          <Search size={12} style={{ color: MC.textMuted, flexShrink: 0 }} />
          <input
            type="text"
            placeholder="Search annotation sets…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: MC.text, fontSize: 13,
            }}
          />
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {setsQ.isLoading ? (
          <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: MC.textMuted }}>
            Loading…
          </div>
        ) : items.length === 0 ? (
          <div style={{ padding: '32px 20px', fontSize: 13, color: MC.textMuted, textAlign: 'center', fontStyle: 'italic' }}>
            {query ? `No sets matching "${query}"` : 'No annotation sets yet.'}
          </div>
        ) : (
          items.map((s) => {
            const onMap = isOnMap(s.id);
            return (
              <div
                key={s.id}
                style={{
                  padding: '11px 14px',
                  borderBottom: `1px solid ${MC.border}`,
                  display: 'flex', gap: 10, alignItems: 'flex-start',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <Tags size={12} style={{ color: MC.accent, flexShrink: 0 }} />
                    <span
                      style={{
                        fontSize: 13, fontWeight: 600, color: MC.text,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                      title={s.name}
                    >
                      {s.name}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: MC.textMuted }}>
                    {s.schema?.name ?? 'no schema'}
                    {typeof s.annotation_count === 'number' && ` · ${s.annotation_count} features`}
                    {s.stac_item_id && ' · attached to item'}
                  </div>
                </div>
                <button
                  onClick={() => !onMap && onAdd(s)}
                  disabled={onMap}
                  style={{
                    flexShrink: 0, height: 28, padding: '0 10px', borderRadius: 5,
                    border: `1px solid ${onMap ? MC.borderLight : MC.accent}`,
                    background: onMap ? 'transparent' : MC.accentDim,
                    color: onMap ? MC.textMuted : MC.accent,
                    cursor: onMap ? 'default' : 'pointer',
                    fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
                  }}
                >
                  {onMap ? 'On map' : 'Add'}
                </button>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}

// ── Tile Service Tab — add XYZ/WMS tile URLs (integration guide §5) ───────────
function TileServiceTab({ mapId }: { mapId?: string }) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const initLayer = useMapLayersStore((s) => s.initLayer);
  const setBackendLayerId = useMapLayersStore((s) => s.setBackendLayerId);
  const setLayerTileConfig = useMapLayersStore((s) => s.setLayerTileConfig);

  const PRESETS = [
    {
      name: 'OpenStreetMap',
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '© OpenStreetMap contributors',
    },
    {
      name: 'Esri World Imagery',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: '© Esri',
    },
    {
      name: 'OpenTopoMap',
      url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
      attribution: '© OpenTopoMap',
    },
  ];

  const addTileService = async (tileName: string, tileUrl: string) => {
    if (!tileUrl.trim()) {
      toast.error('URL is required');
      return;
    }

    // Validate URL contains {z}, {x}, {y} placeholders
    if (!tileUrl.includes('{z}') || !tileUrl.includes('{x}') || !tileUrl.includes('{y}')) {
      toast.error('URL must contain {z}, {x}, {y} placeholders');
      return;
    }

    setAdding(true);
    const layerId = `tile-svc-${Date.now()}`;
    const displayName = tileName.trim() || 'Tile Service';

    try {
      // Init in store
      initLayer(layerId, 'dataset', {
        name: displayName,
        sourceType: 'tile_service',
        tileServiceUrl: tileUrl,
      });
      setLayerTileConfig(layerId, { tileUrl });

      // Persist to backend (integration guide §5)
      if (mapId) {
        try {
          const bl = await datasetsApi.addMapLayer(mapId, {
            name: displayName,
            layer_type: 'raster', // XYZ tile services are raster layers
            source_type: 'tile_service',
            tile_service_url: tileUrl,
            visible: true,
            opacity: 1.0,
          });
          setBackendLayerId(layerId, bl.id);
        } catch {
          // Non-critical
        }
      }

      toast.success(`"${displayName}" added to map`);
      setUrl('');
      setName('');
    } catch {
      toast.error('Failed to add tile service');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
      {/* Custom URL form */}
      <div style={{ padding: '14px' }}>
        <div style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: MC.sectionLabel,
          marginBottom: 10,
        }}>
          Add tile service
        </div>

        <div style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 11, color: MC.textMuted, display: 'block', marginBottom: 4 }}>
            Name
          </label>
          <input
            type="text"
            placeholder="e.g. Sentinel-2 Tiles"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{
              width: '100%',
              background: MC.inputBg,
              border: `1px solid ${MC.inputBorder}`,
              borderRadius: 5,
              color: MC.text,
              fontSize: 12,
              padding: '6px 8px',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 11, color: MC.textMuted, display: 'block', marginBottom: 4 }}>
            Tile URL template
          </label>
          <input
            type="url"
            placeholder="https://example.com/tiles/{z}/{x}/{y}.png"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            style={{
              width: '100%',
              background: MC.inputBg,
              border: `1px solid ${MC.inputBorder}`,
              borderRadius: 5,
              color: MC.text,
              fontSize: 12,
              padding: '6px 8px',
              outline: 'none',
              boxSizing: 'border-box',
              fontFamily: 'monospace',
            }}
          />
          <div style={{ fontSize: 10, color: MC.textMuted, marginTop: 3 }}>
            Must contain {'{'} z {'}'}, {'{'} x {'}'}, {'{'} y {'}'} placeholders
          </div>
        </div>

        <button
          onClick={() => addTileService(name, url)}
          disabled={!url.trim() || adding}
          style={{
            width: '100%',
            height: 34,
            borderRadius: 5,
            border: `1.5px solid ${!url.trim() ? MC.borderLight : MC.accent}`,
            background: !url.trim() ? 'transparent' : MC.accentDim,
            color: !url.trim() ? MC.textMuted : MC.accent,
            cursor: !url.trim() || adding ? 'default' : 'pointer',
            fontSize: 12,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <Plus size={12} />
          {adding ? 'Adding…' : 'Add to map'}
        </button>
      </div>

      {/* Presets */}
      <div style={{ borderTop: `1px solid ${MC.border}`, padding: '14px' }}>
        <div style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: MC.sectionLabel,
          marginBottom: 10,
        }}>
          Quick add
        </div>

        {PRESETS.map((preset) => (
          <button
            key={preset.name}
            onClick={() => addTileService(preset.name, preset.url)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              padding: '9px 10px',
              marginBottom: 4,
              borderRadius: 5,
              border: `1px solid ${MC.border}`,
              background: 'transparent',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background 0.1s',
            }}
          >
            <Globe size={14} style={{ color: MC.accent, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: MC.text }}>{preset.name}</div>
              <div style={{
                fontSize: 10,
                color: MC.textMuted,
                fontFamily: 'monospace',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {preset.url}
              </div>
            </div>
            <Plus size={12} style={{ color: MC.textMuted, flexShrink: 0 }} />
          </button>
        ))}
      </div>
    </div>
  );
}
