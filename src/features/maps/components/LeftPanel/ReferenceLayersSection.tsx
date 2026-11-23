'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type L from 'leaflet';
import { qk } from '@/lib/query-keys';
import { referenceLayersApi, type ReferenceLayer } from '@/lib/api/reference-layers';
import { getMapManager } from '../../MapManager';
import { MC } from '../../mapColors';
import {
  DEFAULT_REFERENCE_LAYER_COLOR,
  PROTECTED_AREA_LEGEND,
  REFERENCE_LAYER_COLORS,
} from '../../referenceLayerStyles';
import { useIsCompact } from '@/hooks/use-mobile';

/**
 * Global, read-only reference layers (static tilesets shared by every
 * organization). Toggling adds or removes a VectorGrid directly on the map;
 * the credit line goes to Leaflet's attribution control.
 * Layers are tracked outside the component so a panel remount (e.g. crossing
 * the compact breakpoint) keeps them; leaving the editor destroys the map and
 * the layers with it, and isOn() then reads false.
 * ponytail: on/off state is per session, not saved with the map. Persist it in
 * map_layers if users need reference layers restored on reload.
 */
const layersByName = new Map<string, L.Layer>();

export function isReferenceLayerOn(name: string): boolean {
  const layer = layersByName.get(name);
  const map = getMapManager().getMap();
  return !!(layer && map?.hasLayer(layer));
}

export function ReferenceLayersSection() {
  const { data } = useQuery({
    queryKey: qk.referenceLayers.list(),
    queryFn: referenceLayersApi.list,
    staleTime: Infinity,
  });
  const isCompact = useIsCompact();
  // Re-render after a toggle or map zoom; the map itself holds the truth.
  const [toggleVersion, setToggleVersion] = useState(0);
  const [, setZoomTick] = useState(0);

  useEffect(() => {
    const map = getMapManager().getMap();
    if (!map) return;
    const onZoomEnd = () => setZoomTick((t) => t + 1);
    map.on('zoomend', onZoomEnd);
    return () => {
      map.off('zoomend', onZoomEnd);
    };
  }, [toggleVersion, data]);

  const toggle = (ref: ReferenceLayer) => {
    const map = getMapManager().getMap();
    if (!map) return;
    const existing = layersByName.get(ref.name);
    layersByName.delete(ref.name);
    if (existing && map.hasLayer(existing)) {
      existing.remove();
      setToggleVersion((v) => v + 1);
      return;
    }
    const layer = getMapManager().createReferenceLayer({
      tileUrl: referenceLayersApi.tileUrlTemplate(ref),
      layerName: ref.name,
      attribution: ref.attribution,
      minZoom: ref.minzoom,
      maxNativeZoom: ref.maxzoom,
    });
    if (!layer) return;
    layer.addTo(map);
    layersByName.set(ref.name, layer);
    setToggleVersion((v) => v + 1);
  };

  if (!data?.items.length) return null;

  const mapZoom = getMapManager().getMap()?.getZoom();

  return (
    // In the compact bottom sheet, Leaflet's scale bar (z 1000) sits over the
    // sheet's last rows; the extra bottom padding keeps these rows above it.
    <div role="group" aria-label="Reference layers" style={{ padding: isCompact ? '8px 0 48px' : '8px 0 4px' }}>
      <div style={{
        padding: '4px 10px 6px',
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: MC.sectionLabel,
      }}>
        Reference layers
      </div>
      {data.items.map((ref) => {
        const on = isReferenceLayerOn(ref.name);
        const belowMinZoom = on && mapZoom !== undefined && mapZoom < ref.minzoom;
        return (
          <label
            key={ref.name}
            title={ref.description ?? undefined}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '5px 12px',
              fontSize: 12,
              color: MC.textSecondary,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={on}
              onChange={() => toggle(ref)}
            />
            <span
              aria-hidden
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                flexShrink: 0,
                background: ref.name === 'raisg_protected_areas'
                  ? `linear-gradient(135deg, ${PROTECTED_AREA_LEGEND[0].color} 50%, ${PROTECTED_AREA_LEGEND[1].color} 50%)`
                  : REFERENCE_LAYER_COLORS[ref.name] ?? DEFAULT_REFERENCE_LAYER_COLOR,
              }}
            />
            <span style={{ flex: 1, minWidth: 0 }}>
              {ref.title}
              {belowMinZoom && (
                <span style={{ marginLeft: 6, fontSize: 10, color: MC.textMuted, whiteSpace: 'nowrap' }}>
                  zoom in to see
                </span>
              )}
            </span>
          </label>
        );
      })}
    </div>
  );
}
