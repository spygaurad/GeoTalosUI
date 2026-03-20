'use client';

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import type { AnnotationClass } from '@/types/api';
import { useAnnotationSetFeatures } from '@/features/maps/hooks/useAnnotations';

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

  // Style function that maps feature class to style
  const styleFunction = useMemo(() => {
    return (feature: any) => {
      const classId = feature?.properties?.class_id;
      const annotationClass = classId ? schemaClasses[classId] : null;
      const fillColor = (annotationClass?.style?.definition?.fillColor as string) ?? '#ff0000';
      const strokeColor = (annotationClass?.style?.definition?.strokeColor as string) ?? '#800000';

      return {
        fillColor,
        color: strokeColor,
        weight: (annotationClass?.style?.definition?.strokeWidth as number) ?? 2,
        opacity: 0.8,
        fillOpacity: (annotationClass?.style?.definition?.fillOpacity as number) ?? 0.7,
      };
    };
  }, [schemaClasses]);

  // Event handlers
  const onEachFeature = (feature: any, layer: any) => {
    const featureId = feature.id;
    const classId = feature.properties?.class_id;

    layer.on('click', () => {
      onFeatureClick?.(featureId, classId);
    });

    // Add popup with feature info
    const className = schemaClasses[classId]?.name ?? 'Unknown';
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
        const classId = feature.properties?.class_id;
        const annotationClass = classId ? schemaClasses[classId] : null;
        const fillColor = (annotationClass?.style?.definition?.fillColor as string) ?? '#ff0000';

        // Use Leaflet's CircleMarker for point features
        const { L } = require('leaflet');
        return new L.CircleMarker(latlng, {
          radius: 6,
          fillColor,
          color: (annotationClass?.style?.definition?.strokeColor as string) ?? '#800000',
          weight: 2,
          opacity: 0.8,
          fillOpacity: 0.7,
        });
      }}
    />
  );
}
