'use client';

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import type { AnnotationClass } from '@/types/api';
import { useAnnotationSetFeatures } from '@/features/maps/hooks/useAnnotations';
import {
  extractClassIdFromProperties,
  normalizeClassStyleDefinition,
} from '@/features/maps/utils/annotationStyles';

// Dynamically import Leaflet GeoJSON since it requires browser globals
const GeoJSON = dynamic(() => import('react-leaflet').then((m) => m.GeoJSON), {
  ssr: false,
  loading: () => null,
});

interface AnnotationLayerProps {
  annotationSetId: string;
  schemaClasses: Record<string, AnnotationClass>;
  onFeatureClick?: (featureId: string, classId: string) => void;
}

/**
 * AnnotationLayer
 * Renders annotation features on the map with class-based styling.
 * - Fetches GeoJSON features from the annotation set
 * - Applies styles based on annotation class colors
 * - Handles feature interactions
 */
export function AnnotationLayer({
  annotationSetId,
  schemaClasses,
  onFeatureClick,
}: AnnotationLayerProps) {
  const { data: geoJsonData, isLoading, error } = useAnnotationSetFeatures(annotationSetId);
  const classList = useMemo(() => Object.values(schemaClasses), [schemaClasses]);
  const resolveClass = useMemo(() => {
    return (classRef: string | undefined) => {
      if (!classRef) return null;
      const byId = schemaClasses[classRef];
      if (byId) return byId;
      const alias = classRef.trim().toLowerCase();
      return classList.find((c) => c.name.toLowerCase() === alias || c.path?.toLowerCase() === alias) ?? null;
    };
  }, [classList, schemaClasses]);

  // Style function that maps feature class to style
  const styleFunction = useMemo(() => {
    return (feature: any) => {
      const classRef = extractClassIdFromProperties(feature?.properties as Record<string, unknown> | undefined);
      const annotationClass = resolveClass(classRef);
      const style = normalizeClassStyleDefinition(annotationClass?.style?.definition as Record<string, unknown> | undefined);

      return {
        fillColor: style.fillColor,
        color: style.strokeColor,
        weight: style.strokeWidth,
        opacity: 0.8,
        fillOpacity: style.fillOpacity,
      };
    };
  }, [resolveClass]);

  // Event handlers
  const onEachFeature = (feature: any, layer: any) => {
    const featureId = feature.id;
    const classRef = extractClassIdFromProperties(feature.properties as Record<string, unknown> | undefined);
    const annotationClass = resolveClass(classRef);

    layer.on('click', () => {
      onFeatureClick?.(featureId, annotationClass?.id ?? classRef ?? '');
    });

    // Add popup with feature info
    const className = annotationClass?.name ?? 'Unknown';
    const confidence = feature.properties?.confidence;
    let popupContent = `<strong>${className}</strong>`;
    if (confidence !== null && confidence !== undefined) {
      popupContent += `<br/>Confidence: ${(confidence * 100).toFixed(1)}%`;
    }
    layer.bindPopup(popupContent);
  };

  if (isLoading) return null;
  if (error) return null;
  if (!geoJsonData || geoJsonData.features.length === 0) return null;

  return (
    <GeoJSON
      data={geoJsonData}
      style={styleFunction}
      onEachFeature={onEachFeature}
      pointToLayer={(feature, latlng) => {
        const classRef = extractClassIdFromProperties(feature.properties as Record<string, unknown> | undefined);
        const annotationClass = resolveClass(classRef);
        const style = normalizeClassStyleDefinition(annotationClass?.style?.definition as Record<string, unknown> | undefined);

        // Use Leaflet's CircleMarker for point features
        const L = require('leaflet') as typeof import('leaflet');
        return new L.CircleMarker(latlng, {
          radius: 6,
          fillColor: style.fillColor,
          color: style.strokeColor,
          weight: style.strokeWidth,
          opacity: 0.8,
          fillOpacity: style.fillOpacity,
        });
      }}
    />
  );
}
