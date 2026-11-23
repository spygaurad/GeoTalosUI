'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type L from 'leaflet';
import { qk } from '@/lib/query-keys';
import { referenceLayersApi, type ReferenceLayer, type ReferenceLayerStyle } from '@/lib/api/reference-layers';
import { getMapManager } from '../../MapManager';
import { MC } from '../../mapColors';
import { PROTECTED_AREA_LEGEND, referenceLayerColour } from '../../referenceLayerStyles';
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
  const { data: stylesData } = useQuery({
    queryKey: qk.referenceLayers.styles(),
    queryFn: referenceLayersApi.styles,
    staleTime: Infinity,
  });
  const queryClient = useQueryClient();
  const styles = stylesData?.items ?? {};
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
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

  /** Build the Leaflet layer for a reference layer in the user's style: boxes or heatmap. */
  const makeLayer = (ref: ReferenceLayer, style: ReferenceLayerStyle | undefined) => {
    const base = {
      layerName: ref.name,
      attribution: ref.attribution,
      minZoom: ref.minzoom,
      maxNativeZoom: ref.maxzoom,
    };
    const density = referenceLayersApi.densityTileUrlTemplate(ref);
    if (style?.mode === 'heatmap' && density) {
      return getMapManager().createReferenceHeatmap({
        ...base,
        layerName: `${ref.name}_density`,
        tileUrl: density,
        colour: referenceLayerColour(ref.name, style),
        opacity: style.opacity ?? 0.9,
        radius: style.heatmap?.radius ?? 18,
        weighted: !!style.heatmap?.weight,
      });
    }
    return getMapManager().createReferenceLayer({
      ...base,
      tileUrl: referenceLayersApi.tileUrlTemplate(ref),
      style,
    });
  };

  /** Swap a visible layer for one in the new style, keeping its place on the map. */
  const redraw = (ref: ReferenceLayer, style: ReferenceLayerStyle | undefined) => {
    const map = getMapManager().getMap();
    const existing = layersByName.get(ref.name);
    if (!map || !existing || !map.hasLayer(existing)) return;
    existing.remove();
    const layer = makeLayer(ref, style);
    if (!layer) return;
    layer.addTo(map);
    layersByName.set(ref.name, layer);
    setToggleVersion((v) => v + 1);
  };

  /** Apply a style change now, and save it for the organization a moment later. */
  const changeStyle = (ref: ReferenceLayer, next: ReferenceLayerStyle) => {
    queryClient.setQueryData(qk.referenceLayers.styles(), { items: { ...styles, [ref.name]: next } });
    redraw(ref, next);
    clearTimeout(saveTimers.current.get(ref.name));
    saveTimers.current.set(
      ref.name,
      setTimeout(() => {
        referenceLayersApi.setStyle(ref.name, next).catch(() => {
          toast.error('Could not save the layer style. Members and admins can change it.');
          queryClient.invalidateQueries({ queryKey: qk.referenceLayers.styles() });
        });
      }, 400),
    );
  };

  const resetStyle = (ref: ReferenceLayer) => {
    clearTimeout(saveTimers.current.get(ref.name));
    const { [ref.name]: _dropped, ...rest } = styles;
    queryClient.setQueryData(qk.referenceLayers.styles(), { items: rest });
    redraw(ref, undefined);
    referenceLayersApi.resetStyle(ref.name).catch(() => toast.error('Could not reset the layer style.'));
  };

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
    const layer = makeLayer(ref, styles[ref.name]);
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
        const style = styles[ref.name];
        const colour = referenceLayerColour(ref.name, style);
        const customised = !!style && Object.keys(style).length > 0;
        const open = settingsFor === ref.name;
        return (
          <div key={ref.name}>
          <label
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
                background: ref.name === 'raisg_protected_areas' && !style?.colour
                  ? `linear-gradient(135deg, ${PROTECTED_AREA_LEGEND[0].color} 50%, ${PROTECTED_AREA_LEGEND[1].color} 50%)`
                  : colour,
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
            <button
              type="button"
              aria-label={`Style ${ref.title}`}
              aria-expanded={open}
              onClick={(e) => { e.preventDefault(); setSettingsFor(open ? null : ref.name); }}
              style={{ fontSize: 10, color: MC.textMuted, background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}
            >
              {customised ? 'Style *' : 'Style'}
            </button>
          </label>
          {open && (
            <StyleControls
              ref_={ref}
              style={style}
              colour={colour}
              onChange={(next) => changeStyle(ref, next)}
              onReset={() => resetStyle(ref)}
            />
          )}
          </div>
        );
      })}
    </div>
  );
}

const ROW = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: MC.textSecondary } as const;

/** Colour, opacity and, for layers with heatmap tiles, boxes or heatmap with radius and weight. */
function StyleControls({ ref_, style, colour, onChange, onReset }: {
  ref_: ReferenceLayer;
  style: ReferenceLayerStyle | undefined;
  colour: string;
  onChange: (next: ReferenceLayerStyle) => void;
  onReset: () => void;
}) {
  const s = style ?? {};
  const heat = s.mode === 'heatmap';
  const weights = ref_.attributes.filter((a) => a.weight);
  return (
    <div style={{ padding: '2px 12px 8px 34px', display: 'grid', gap: 6 }}>
      <label style={ROW}>
        Colour
        <input type="color" value={colour} onChange={(e) => onChange({ ...s, colour: e.target.value })} />
      </label>
      <label style={ROW}>
        Opacity
        <input
          type="range" min={0.1} max={1} step={0.05}
          value={s.opacity ?? (heat ? 0.9 : 0.2)}
          onChange={(e) => onChange({ ...s, opacity: Number(e.target.value) })}
        />
      </label>
      {ref_.density_tile_url && (
        <>
          <label style={ROW}>
            <input
              type="checkbox" checked={heat}
              onChange={(e) => onChange({ ...s, mode: e.target.checked ? 'heatmap' : 'boxes' })}
            />
            Show as heatmap
          </label>
          {heat && (
            <>
              <label style={ROW}>
                Radius
                <input
                  type="range" min={6} max={40} step={2} value={s.heatmap?.radius ?? 18}
                  onChange={(e) => onChange({ ...s, heatmap: { ...s.heatmap, radius: Number(e.target.value) } })}
                />
              </label>
              {weights.length > 0 && (
                <label style={ROW}>
                  Weight
                  <select
                    value={s.heatmap?.weight ?? ''}
                    onChange={(e) => onChange({ ...s, heatmap: { ...s.heatmap, weight: e.target.value || null } })}
                  >
                    <option value="">Number of areas</option>
                    {weights.map((a) => <option key={a.name} value={a.name}>{a.label}{a.unit ? ` (${a.unit})` : ''}</option>)}
                  </select>
                </label>
              )}
            </>
          )}
        </>
      )}
      <button type="button" onClick={onReset} style={{ ...ROW, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
        Reset to default
      </button>
    </div>
  );
}
