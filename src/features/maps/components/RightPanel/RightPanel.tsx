'use client';

import { X } from 'lucide-react';
import { useMapLayersStore } from '@/stores/mapLayersStore';
import { FeaturePropertiesPanel } from './FeaturePropertiesPanel';
import { LayerStylePanel } from './LayerStylePanel';
import { NewAnnotationPanel } from './NewAnnotationPanel';
import { MeasurementPanel } from './MeasurementPanel';
import { DatasetInfoPanel } from './DatasetInfoPanel';
import { DatasetItemsPanel } from './DatasetItemsPanel';
import { AnnotationSetPanel } from './AnnotationSetPanel';
import { AnnotationDrawPanel } from './AnnotationDrawPanel';
import { AoiPanel } from './AoiPanel';
import { MC, MAP_Z } from '../../mapColors';
import { useIsCompact } from '@/hooks/use-mobile';
import type { Dataset } from '@/types/api';

const PANEL_TITLES: Record<string, string> = {
  feature: 'Feature Info',
  style: 'Layer Style',
  'new-annotation': 'Annotation Attributes',
  measurement: 'Distance Measurement',
  dataset: 'Dataset',
  items: 'Dataset Items',
  'annotation-set': 'Annotation Set',
  'annotation-draw': 'Draw Annotation',
  aoi: 'Area of Interest',
};

interface RightPanelProps {
  topOffset: number;
  bottomOffset: number;
  mapId?: string;
  projectId?: string;
  datasets?: Dataset[];
}

export function RightPanel({ topOffset, bottomOffset, mapId, projectId }: RightPanelProps) {
  const rightPanelMode = useMapLayersStore((s) => s.rightPanelMode);
  const selectedFeature = useMapLayersStore((s) => s.selectedFeature);
  const selectedLayerId = useMapLayersStore((s) => s.selectedLayerId);
  const selectedDatasetId = useMapLayersStore((s) => s.selectedDatasetId);
  const selectedItemsDatasetId = useMapLayersStore((s) => s.selectedItemsDatasetId);
  const selectedAnnotationSetId = useMapLayersStore((s) => s.selectedAnnotationSetId);
  const selectedAoiLayerId = useMapLayersStore((s) => s.selectedAoiLayerId);
  const closeRightPanel = useMapLayersStore((s) => s.closeRightPanel);
  const clearMeasurement = useMapLayersStore((s) => s.clearMeasurement);
  const layers = useMapLayersStore((s) => s.layers);
  const isCompact = useIsCompact();

  // For measurement mode, close = stop measuring
  const handleClose = rightPanelMode === 'measurement' ? clearMeasurement : closeRightPanel;

  const isOpen = rightPanelMode !== 'none';
  const title = isOpen ? (PANEL_TITLES[rightPanelMode] ?? 'Details') : '';

  // ── Desktop geometry ──────────────────────────────────────────────────────
  const panelTop = topOffset + 8;
  const maxPanelH = topOffset > 0
    ? `calc(100vh - ${topOffset + bottomOffset + 16}px)`
    : 'calc(100% - 16px)';

  // ── Shared panel content ──────────────────────────────────────────────────
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

      {/* Header */}
      <div
        style={{
          height: 40,
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 14,
          paddingRight: 8,
          borderBottom: `1px solid ${MC.navBorder}`,
          flexShrink: 0,
          background: MC.navBg,
          marginTop: isCompact ? 8 : 0,
        }}
      >
        <span style={{ flex: 1, fontSize: 11, fontWeight: 700, color: MC.navText, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          {title}
        </span>
        <button
          onClick={handleClose}
          title="Close"
          aria-label="Close panel"
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
          }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {rightPanelMode === 'new-annotation' && <NewAnnotationPanel mapId={mapId} projectId={projectId} />}
        {rightPanelMode === 'measurement' && <MeasurementPanel />}
        {rightPanelMode === 'feature' && selectedFeature && (
          <FeaturePropertiesPanel feature={selectedFeature} mapId={mapId} />
        )}
        {rightPanelMode === 'style' && selectedLayerId && (
          <LayerStylePanel
            layerId={selectedLayerId}
            layerType={layers[selectedLayerId]?.type ?? 'annotation'}
          />
        )}
        {rightPanelMode === 'dataset' && selectedDatasetId && (
          <DatasetInfoPanel datasetId={selectedDatasetId} />
        )}
        {rightPanelMode === 'items' && selectedItemsDatasetId && (
          <DatasetItemsPanel datasetId={selectedItemsDatasetId} mapId={mapId} />
        )}
        {rightPanelMode === 'annotation-set' && selectedAnnotationSetId && (
          <AnnotationSetPanel annotationSetId={selectedAnnotationSetId} mapId={mapId} />
        )}
        {rightPanelMode === 'annotation-draw' && <AnnotationDrawPanel />}
        {rightPanelMode === 'aoi' && selectedAoiLayerId && (
          <AoiPanel aoiLayerId={selectedAoiLayerId} mapId={mapId} />
        )}
      </div>
    </>
  );

  // ── Compact: full-width bottom sheet ──────────────────────────────────────
  if (isCompact) {
    return (
      <>
        {/* Backdrop */}
        {isOpen && (
          <div
            onClick={handleClose}
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0,0,0,0.4)',
              zIndex: MAP_Z.panel - 1,
              transition: 'opacity 0.2s',
            }}
          />
        )}

        {/* Bottom sheet */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            maxHeight: '70vh',
            zIndex: MAP_Z.panel,
            background: MC.panelBg,
            borderTop: `1px solid ${MC.panelBorder}`,
            borderRadius: '12px 12px 0 0',
            boxShadow: isOpen ? '0 -4px 24px rgba(0,0,0,0.18)' : 'none',
            display: 'flex',
            flexDirection: 'column',
            transform: isOpen ? 'translateY(0)' : 'translateY(110%)',
            transition: 'transform 0.25s cubic-bezier(0.2,0,0,1)',
            overflow: 'hidden',
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          }}
        >
          {panelContent}
        </div>
      </>
    );
  }

  // ── Desktop: slide-in from right ──────────────────────────────────────────
  return (
    <div
      style={{
        position: 'absolute',
        top: panelTop,
        right: 8,
        width: 320,
        maxHeight: maxPanelH,
        zIndex: MAP_Z.panel,
        background: MC.panelBg,
        border: `1px solid ${MC.panelBorder}`,
        borderRadius: 8,
        boxShadow: isOpen ? MC.shadowMd : 'none',
        display: 'flex',
        flexDirection: 'column',
        transform: isOpen ? 'translateX(0)' : 'translateX(336px)',
        transition: 'transform 0.22s cubic-bezier(0.2,0,0,1)',
        overflow: 'hidden',
      }}
    >
      {panelContent}
    </div>
  );
}
