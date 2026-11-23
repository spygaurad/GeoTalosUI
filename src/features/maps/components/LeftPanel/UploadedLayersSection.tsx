'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type L from 'leaflet';
import { qk } from '@/lib/query-keys';
import { apiErrorMessage, featureLayersApi, type UploadedLayer } from '@/lib/api/feature-layers';
import { getMapManager } from '../../MapManager';
import { MC } from '../../mapColors';

/**
 * Vector layers the organization uploaded (GeoJSON or CSV). Unlike the public reference
 * layers these belong to one organization, so tiles come through an authenticated route.
 * Layers are tracked outside the component, like the reference layers, so a remount keeps them.
 */
const layersByName = new Map<string, L.Layer>();
const PALETTE = ['#0e7490', '#c2410c', '#15803d', '#7e22ce', '#be185d', '#a16207', '#1d4ed8'];

/** The same name always gets the same colour. */
function colourFor(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function UploadedLayersSection() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: qk.featureLayers.list(), queryFn: featureLayersApi.list });
  const [, setTick] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const upload = useMutation({
    mutationFn: (file: File) => featureLayersApi.upload(file),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: qk.featureLayers.list() });
      toast.success(
        `Added ${r.layer}: ${r.created.toLocaleString()} features` +
          (r.skipped ? `, ${r.skipped} skipped (${r.reasons[0] ?? 'invalid geometry'})` : ''),
      );
    },
    onError: async (err) => toast.error(await apiErrorMessage(err, 'Upload failed')),
  });

  const remove = useMutation({
    mutationFn: (name: string) => featureLayersApi.remove(name),
    onSuccess: (_r, name) => {
      layersByName.get(name)?.remove();
      layersByName.delete(name);
      queryClient.invalidateQueries({ queryKey: qk.featureLayers.list() });
    },
    onError: async (err) => toast.error(await apiErrorMessage(err, 'Could not delete the layer. Admins only.')),
  });

  const isOn = (name: string) => {
    const layer = layersByName.get(name);
    return !!(layer && getMapManager().getMap()?.hasLayer(layer));
  };

  const toggle = (layer: UploadedLayer) => {
    const map = getMapManager().getMap();
    if (!map) return;
    const existing = layersByName.get(layer.name);
    if (existing && map.hasLayer(existing)) {
      existing.remove();
      setTick((t) => t + 1);
      return;
    }
    const vg = getMapManager().createReferenceLayer({
      tileUrl: featureLayersApi.tileUrlTemplate(layer),
      layerName: layer.tile_layer,
      minZoom: 0,
      maxNativeZoom: 22,
      style: { colour: colourFor(layer.name), opacity: 0.35 },
    });
    if (!vg) return;
    vg.addTo(map);
    layersByName.set(layer.name, vg);
    const [w, s, e, n] = layer.bounds;
    map.fitBounds([[s, w], [n, e]], { maxZoom: 14 });
    setTick((t) => t + 1);
  };

  return (
    <div role="group" aria-label="My layers" style={{ padding: '4px 0 48px' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '4px 10px 6px' }}>
        <span style={{ flex: 1, fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: MC.sectionLabel }}>
          My layers
        </span>
        <button
          type="button"
          disabled={upload.isPending}
          onClick={() => fileInput.current?.click()}
          style={{ fontSize: 11, color: MC.textSecondary, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
        >
          {upload.isPending ? 'Uploading...' : 'Upload'}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".geojson,.json,.csv"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload.mutate(file);
            e.target.value = ''; // so the same file can be picked again
          }}
        />
      </div>
      {!data?.items.length && (
        <div style={{ padding: '2px 12px', fontSize: 11, color: MC.textMuted, lineHeight: 1.4 }}>
          Upload a GeoJSON or CSV file to add your own vector layer.
        </div>
      )}
      {data?.items.map((layer) => (
        <label key={layer.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', fontSize: 12, color: MC.textSecondary, cursor: 'pointer' }}>
          <input type="checkbox" checked={isOn(layer.name)} onChange={() => toggle(layer)} />
          <span aria-hidden style={{ width: 10, height: 10, borderRadius: 2, flexShrink: 0, background: colourFor(layer.name) }} />
          <span style={{ flex: 1, minWidth: 0 }} title={`Attributes: ${layer.attributes.join(', ') || 'none'}`}>
            {layer.name}
            <span style={{ marginLeft: 6, fontSize: 10, color: MC.textMuted }}>{layer.feature_count.toLocaleString()}</span>
          </span>
          <button
            type="button"
            aria-label={`Delete ${layer.name}`}
            onClick={(e) => {
              e.preventDefault();
              if (window.confirm(`Delete the layer "${layer.name}" and all its features?`)) remove.mutate(layer.name);
            }}
            style={{ fontSize: 12, color: MC.textMuted, background: 'none', border: 'none', cursor: 'pointer' }}
          >
            ×
          </button>
        </label>
      ))}
    </div>
  );
}
