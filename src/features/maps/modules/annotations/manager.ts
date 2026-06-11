/**
 * Annotations Module — Manager Extension
 *
 * Provides annotation set layer creation methods as a module extension.
 * Extracted from MapManager.ts (createAnnotationSetLayer, createMvtLayer,
 * resolveAnnotationStyle).
 *
 * Methods:
 *  - createAnnotationSetGeoJsonLayer — GeoJSON layer with per-class styling + click handler
 *  - createMvtLayer                  — VectorGrid.Protobuf MVT layer with Clerk auth
 *  - resolveAnnotationStyle          — class-based style resolver (shared by both renderers)
 */

import type L from 'leaflet';
import type { ManagerContext } from '../../core/types';
import type { LayerConfig } from '../../types';
import { useMapLayersStore, markFeatureClick } from '@/stores/mapLayersStore';
import { computeGeoStats, fmtCoord } from '../../shared/geo';
import {
  extractClassIdFromProperties,
  resolveClassStyle,
} from '../../utils/annotationStyles';
import type { GeoJSONFeatureCollection } from '@/lib/api/annotation-sets';
import { getAuthToken } from '@/lib/api/client';

export function createAnnotationsManagerExtension(ctx: ManagerContext) {
  const { L, map } = ctx;

  // ── Style resolver ───────────────────────────────────────────────────────────

  function resolveAnnotationStyle(
    config: LayerConfig,
    properties?: Record<string, unknown>,
    addFillFlag = false,
  ): Record<string, unknown> {
    const classRef = extractClassIdFromProperties(properties);
    const cs = resolveClassStyle(config.classStyles, classRef);
    const fillFlag = addFillFlag ? { fill: true } : {};

    // Distinguish verified annotations from unverified ones without touching hue
    // (classes own the color). Verified features get a solid, thicker stroke and a
    // fuller fill; unverified ones get a dashed, lighter "draft" look. Works for any
    // class color since only stroke geometry + alpha change.
    // The verified flag is read per feature: the backend places verified annotations
    // in their own set, so every feature there carries review_status === 'verified'.
    const isVerified = properties?.review_status === 'verified';
    const verifiedStyle = (baseWeight: number, baseFillOpacity: number) =>
      isVerified
        ? {
            weight: baseWeight + 1,
            fillOpacity: Math.min(baseFillOpacity * 1.6, 0.85),
          }
        : {
            weight: baseWeight,
            dashArray: '4 4',
            fillOpacity: baseFillOpacity * 0.6,
          };

    if (cs) {
      return {
        color: cs.strokeColor,
        fillColor: cs.fillColor,
        ...verifiedStyle(cs.strokeWidth, cs.fillOpacity * config.opacity),
        ...fillFlag,
      };
    }

    return {
      color: config.style.color,
      fillColor: config.style.fillColor,
      ...verifiedStyle(config.style.weight, config.style.fillOpacity * config.opacity),
      ...fillFlag,
    };
  }

  // ── GeoJSON annotation set layer ─────────────────────────────────────────────

  function createAnnotationSetGeoJsonLayer(
    config: LayerConfig,
    fc: GeoJSONFeatureCollection,
  ): L.GeoJSON | null {
    if (!fc) return null;
    const { style } = config;

    const geoJsonLayer = L.geoJSON(fc as unknown as GeoJSON.FeatureCollection, {
      pane: 'awakeforest-annotations',
      interactive: true,
      style: (feature) => {
        return resolveAnnotationStyle(
          config,
          feature?.properties as Record<string, unknown> | undefined,
        );
      },
      pointToLayer: (feature, latlng) => {
        const s = resolveAnnotationStyle(
          config,
          feature?.properties as Record<string, unknown> | undefined,
        );
        return L.circleMarker(latlng, {
          pane: 'awakeforest-annotations',
          radius: style.radius,
          ...s,
        });
      },
      onEachFeature: (feature, layer) => {
        layer.on('click', (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e);
          markFeatureClick();

          const geomStats = feature.geometry
            ? computeGeoStats(
                feature.geometry as Parameters<typeof computeGeoStats>[0],
              )
            : { featureType: 'annotation', stats: {} };

          const pointCoords =
            feature.geometry?.type === 'Point'
              ? {
                  latitude: fmtCoord(
                    (feature.geometry.coordinates as [number, number])[1],
                    'lat',
                  ),
                  longitude: fmtCoord(
                    (feature.geometry.coordinates as [number, number])[0],
                    'lng',
                  ),
                }
              : {};

          // Derive annotation_set_id from config ID (format: "annset-{uuid}")
          const annotationSetId = config.id.startsWith('annset-')
            ? config.id.slice(7)
            : undefined;
          const annotationId = (
            feature.properties?.id ??
            feature.id ??
            undefined
          ) as string | undefined;

          useMapLayersStore.getState().openFeaturePanel({
            layerType: 'annotation',
            featureType: geomStats.featureType,
            featureId: annotationId ?? config.id,
            properties: {
              ...feature.properties,
              ...geomStats.stats,
              ...pointCoords,
              ...(annotationSetId ? { _annotation_set_id: annotationSetId } : {}),
              ...(annotationId ? { _annotation_id: annotationId } : {}),
            },
            latlng: [e.latlng.lat, e.latlng.lng],
            layerRef: layer,
            layerId: config.id,
          });

          const label =
            feature.properties?.class_name ??
            feature.properties?.label ??
            'Annotation';
          L.popup({
            closeButton: false,
            className: 'af-map-popup',
            offset: [0, -6],
            maxWidth: 220,
          })
            .setLatLng(e.latlng)
            .setContent(
              `<div class="af-popup-content">
                <div class="af-popup-title">${label}</div>
                ${
                  feature.properties?.confidence != null
                    ? `<div class="af-popup-sub">Confidence: ${(
                        (feature.properties.confidence as number) * 100
                      ).toFixed(0)}%</div>`
                    : ''
                }
                <div class="af-popup-sub">See details in panel &rarr;</div>
              </div>`,
            )
            .openOn(map!);
        });
      },
    });

    // Enforce minZoom=12: hide all child paths below zoom 12.
    // Leaflet GeoJSON doesn't natively support minZoom, so we manage it via
    // zoomend events. The pointer marker (added by createLayerWithPointer)
    // remains visible at lower zoom levels.
    const applyZoomVisibility = () => {
      if (!map) return;
      const visible = map.getZoom() >= 12;
      geoJsonLayer.eachLayer((child) => {
        const el =
          (child as unknown as { _path?: SVGElement; _icon?: HTMLElement })
            ._path ??
          (child as unknown as { _icon?: HTMLElement })._icon;
        if (el) el.style.visibility = visible ? '' : 'hidden';
      });
    };

    geoJsonLayer.on('add', () => {
      map?.on('zoomend', applyZoomVisibility);
      applyZoomVisibility();
    });
    geoJsonLayer.on('remove', () => {
      map?.off('zoomend', applyZoomVisibility);
    });

    return geoJsonLayer;
  }

  // ── MVT vector tile layer ────────────────────────────────────────────────────

  function createMvtLayer(config: LayerConfig): L.Layer | null {
    if (!config.tileUrl || !config.mvtLayerName) return null;

    // leaflet.vectorgrid is a UMD bundle that expects a global `L` at eval time.
    // Expose Leaflet on window, then require the plugin lazily (first call only).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof window !== 'undefined' && !(window as any).L) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).L = L;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!(L as any).vectorGrid) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('leaflet.vectorgrid');
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Failed to load leaflet.vectorgrid', err);
        return null;
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vectorGrid: any = (L as any).vectorGrid;
    if (!vectorGrid?.protobuf) {
      // eslint-disable-next-line no-console
      console.error('leaflet.vectorgrid is not loaded');
      return null;
    }

    // Inject the Clerk Bearer token into annotation tile requests by wrapping
    // window.fetch once. This is simpler and more reliable than subclassing
    // L.VectorGrid.Protobuf, and avoids rendering failures from prototype
    // extension issues in minified builds.
    // The interceptor only adds the header for our annotation tile URLs.
    if (typeof window !== 'undefined' && !(window as any).__awfAnnotationFetchWrapped) {
      const _origFetch = window.fetch.bind(window);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).fetch = async function (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : (input as Request).url;
        if (url.includes('/annotation-sets/') && url.includes('/tiles/')) {
          const token = await getAuthToken();
          if (token) {
            const headers = new Headers(
              (init as RequestInit | undefined)?.headers,
            );
            headers.set('Authorization', `Bearer ${token}`);
            init = { ...(init ?? {}), headers };
          }
        }
        return _origFetch(input, init);
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__awfAnnotationFetchWrapped = true;
    }

    const layerName = config.mvtLayerName;

    const vg = vectorGrid.protobuf(config.tileUrl, {
      pane: 'awakeforest-annotations',
      interactive: true,
      maxNativeZoom: config.tileMaxZoom ?? 22,
      minZoom: config.tileMinZoom ?? 0,
      vectorTileLayerStyles: {
        [layerName]: (properties: Record<string, unknown>) => {
          return resolveAnnotationStyle(config, properties, true);
        },
      },
    }) as L.Layer;

    // Wire click → right panel. VectorGrid fires `click` with `layer.properties`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (vg as any).on('click', (e: any) => {
      L.DomEvent.stopPropagation(e);
      markFeatureClick();
      const props = (e.layer?.properties ?? {}) as Record<string, unknown>;
      const annotationId = (props.id ?? '') as string;
      const classId = extractClassIdFromProperties(props);
      useMapLayersStore.getState().openFeaturePanel({
        layerType: 'annotation',
        featureType: 'annotation-mvt',
        featureId: annotationId || config.id,
        properties: {
          ...props,
          _annotation_set_id: config.annotationSetId,
          _annotation_id: annotationId || undefined,
          _class_id: classId,
          // Signal to the right panel that full feature data must be fetched
          // via annotationsApi.getById(annotationId) when entering edit mode.
          _mvt: true,
        },
        latlng: [e.latlng.lat, e.latlng.lng],
        layerRef: e.layer,
        layerId: config.id,
      });
    });

    return vg;
  }

  return {
    resolveAnnotationStyle,
    createAnnotationSetGeoJsonLayer,
    createMvtLayer,
  };
}

export type AnnotationsManagerExtension = ReturnType<
  typeof createAnnotationsManagerExtension
>;
