import { apiClient } from './client';
import { EP } from './endpoints';
import type { GeoJSONGeometry } from '@/types/geo';

// ── STAC Item response types ────────────────────────────────────────────────

export interface StacFeature {
  type: 'Feature';
  stac_version: string;
  id: string;
  geometry: GeoJSONGeometry;
  bbox: [number, number, number, number];
  properties: {
    datetime: string;
    [key: string]: unknown;
  };
  links: Array<{ rel: string; href: string }>;
  assets: Record<string, { href: string; type?: string }>;
  collection: string;
}

/** @deprecated Use StacFeature instead */
export type StacItem = StacFeature;

export interface StacItemsResponse {
  type: 'FeatureCollection';
  features: StacFeature[];
  numberMatched?: number;
  numberReturned?: number;
  context?: {
    returned: number;
    matched: number;
    limit: number;
  };
}

export interface StacSearchParams {
  collections?: string[];
  bbox?: [number, number, number, number];
  datetime?: string;
  limit?: number;
  offset?: number;
}

// ── STAC API methods ────────────────────────────────────────────────────────

export const stacApi = {
  /**
   * List items in a STAC collection with optional spatial/temporal filters.
   * Uses pgSTAC's native bbox filtering for efficient spatial queries.
   */
  listCollectionItems: (
    collectionId: string,
    params?: {
      bbox?: string; // "minLng,minLat,maxLng,maxLat"
      datetime?: string;
      limit?: number;
      offset?: number;
    },
  ) => {
    // Backend API has max limit of 200
    const limit = Math.min(params?.limit ?? 200, 200);
    
    const searchParams: Record<string, string | number> = {
      limit,
      offset: params?.offset ?? 0,
    };
    
    // Only add bbox if provided and valid (4 comma-separated numbers)
    if (params?.bbox) {
      const parts = params.bbox.split(',');
      if (parts.length === 4 && parts.every(p => !isNaN(parseFloat(p)))) {
        searchParams.bbox = params.bbox;
      } else {
        console.warn(`[stacApi] Invalid bbox format: ${params.bbox}, skipping bbox filter`);
      }
    }
    
    if (params?.datetime) {
      searchParams.datetime = params.datetime;
    }

    console.log(`[stacApi.listCollectionItems] Calling ${EP.stac.collectionItems(collectionId)} with params:`, searchParams);

    return apiClient
      .get(EP.stac.collectionItems(collectionId), { searchParams })
      .json<StacItemsResponse>();
  },

  /**
   * Search across multiple STAC collections with spatial/temporal filters.
   * Uses POST for complex queries with bbox arrays.
   */
  search: (params: StacSearchParams) =>
    apiClient
      .post(EP.stac.search, {
        json: {
          ...(params.collections?.length ? { collections: params.collections } : {}),
          ...(params.bbox ? { bbox: params.bbox } : {}),
          ...(params.datetime ? { datetime: params.datetime } : {}),
          limit: params.limit ?? 500,
        },
      })
      .json<StacItemsResponse>(),

  /**
   * Search items in a single collection (convenience wrapper).
   * Useful for AOI timeline where we know the collection ID.
   */
  searchCollection: (
    collectionId: string,
    params: {
      bbox?: [number, number, number, number];
      datetime?: string;
      limit?: number;
    },
  ) =>
    stacApi.search({
      collections: [collectionId],
      bbox: params.bbox,
      datetime: params.datetime,
      limit: params.limit,
    }),
};
