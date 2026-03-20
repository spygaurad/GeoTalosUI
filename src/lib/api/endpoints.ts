/**
 * Central registry of all backend API endpoint paths.
 *
 * Base URL is configured in src/lib/api/client.ts via NEXT_PUBLIC_API_URL.
 * These paths are relative to that base and map 1-to-1 with the backend routes
 * documented in docs/api-endpoints.md.
 *
 * Usage:
 *   import { EP } from '@/lib/api/endpoints';
 *   apiClient.get(EP.projects.list)
 *   apiClient.get(EP.projects.detail(id))
 */
export const EP = {
  health: 'health',

  auth: {
    sync: 'auth/sync',
  },

  organizations: {
    list: 'organizations',
    detail: (orgId: string) => `organizations/${orgId}`,
  },

  projects: {
    list: 'projects',
    create: 'projects',
    detail: (id: string) => `projects/${id}`,
    update: (id: string) => `projects/${id}`,
    delete: (id: string) => `projects/${id}`,
    members: (id: string) => `projects/${id}/members`,
    datasets: (id: string) => `projects/${id}/datasets`,
  },

  maps: {
    list: 'maps',
    create: 'maps',
    detail: (id: string) => `maps/${id}`,
    update: (id: string) => `maps/${id}`,
    delete: (id: string) => `maps/${id}`,
    layers: (mapId: string) => `maps/${mapId}/layers`,
    layerDetail: (mapId: string, layerId: string) => `maps/${mapId}/layers/${layerId}`,
    layersReorder: (mapId: string) => `maps/${mapId}/layers/reorder`,
  },

  jobs: {
    detail: (id: string) => `jobs/${id}`,
    retry: (id: string) => `jobs/${id}/retry`,
  },

  apiKeys: {
    list: 'api-keys',
    create: 'api-keys',
    delete: (id: string) => `api-keys/${id}`,
  },

  datasets: {
    list: 'datasets',
    create: 'datasets',
    detail: (id: string) => `datasets/${id}`,
    update: (id: string) => `datasets/${id}`,
    delete: (id: string) => `datasets/${id}`,
    items: (id: string) => `datasets/${id}/items`,
    itemTileConfig: (datasetId: string, itemId: string) =>
      `datasets/${datasetId}/items/${itemId}/tile-config`,
    downloadUrl: (id: string) => `datasets/${id}/download-url`,
    tileJson: (id: string) => `datasets/${id}/tilejson`,
    // Multipart upload flow — correct nested paths per API docs:
    //   Step 1: POST /datasets              → create metadata record → dataset_id
    //   Step 2: POST /datasets/{id}/uploads/initiate → start multipart upload
    //   Step 3: PUT <presigned_url>          → upload parts directly to MinIO
    //   Step 4: POST /datasets/{id}/uploads/{uid}/part-urls → more parts if needed
    //   Step 5: POST /datasets/{id}/uploads/{uid}/complete → finalize + enqueue ingestion
    //   Abort:  DELETE /datasets/{id}/uploads/{uid}
    uploadInitiate: (datasetId: string) =>
      `datasets/${datasetId}/uploads/initiate`,
    /** Fetch presigned S3 PUT URLs for parts beyond the initial batch. */
    uploadPartUrls: (datasetId: string, uploadId: string) =>
      `datasets/${datasetId}/uploads/${uploadId}/part-urls`,
    /** Proxy PUT — browser → API → MinIO (no presigned URL needed). */
    uploadPartProxy: (datasetId: string, uploadId: string, partNumber: number) =>
      `datasets/${datasetId}/uploads/${uploadId}/parts/${partNumber}`,
    uploadComplete: (datasetId: string, uploadId: string) =>
      `datasets/${datasetId}/uploads/${uploadId}/complete`,
    uploadAbort: (datasetId: string, uploadId: string) =>
      `datasets/${datasetId}/uploads/${uploadId}`,
  },

  stac: {
    search: 'stac/search',
    collections: 'stac/collections',
    collectionItems: (id: string) => `stac/collections/${id}/items`,
  },

  annotations: {
    list: 'annotations',
    create: 'annotations',
    detail: (id: string) => `annotations/${id}`,
    update: (id: string) => `annotations/${id}`,
    updateStatus: (id: string) => `annotations/${id}/status`,
    delete: (id: string) => `annotations/${id}`,
    versions: (id: string) => `annotations/${id}/versions`,
    bulkImport: 'annotations/bulk-import',
    bulkUpdate: 'annotations/bulk-update',
    bulkDelete: 'annotations/bulk-delete',
    bulkExport: 'annotations/bulk-export',
  },

  annotationSets: {
    listByMap: (mapId: string) => `maps/${mapId}/annotation-sets`,
    detail: (id: string) => `annotation-sets/${id}`,
    features: (id: string) => `annotation-sets/${id}/features`,
    addAnnotation: (id: string) => `annotation-sets/${id}/annotations`,
    annotationDetail: (setId: string, annId: string) =>
      `annotation-sets/${setId}/annotations/${annId}`,
  },

  annotationSchemas: {
    list: 'annotation-schemas',
    create: 'annotation-schemas',
    detail: (id: string) => `annotation-schemas/${id}`,
    update: (id: string) => `annotation-schemas/${id}`,
    delete: (id: string) => `annotation-schemas/${id}`,
    classes: (schemaId: string) => `annotation-schemas/${schemaId}/classes`,
    classDetail: (schemaId: string, classId: string) =>
      `annotation-schemas/${schemaId}/classes/${classId}`,
    classStyle: (schemaId: string, classId: string) =>
      `annotation-schemas/${schemaId}/classes/${classId}/style`,
  },

  // Standalone annotation classes (for direct get/update/delete)
  annotationClasses: {
    detail: (classId: string) => `annotation-classes/${classId}`,
    update: (classId: string) => `annotation-classes/${classId}`,
    delete: (classId: string) => `annotation-classes/${classId}`,
  },

  styles: {
    list: 'styles',
    create: 'styles',
    detail: (styleId: string) => `styles/${styleId}`,
    update: (styleId: string) => `styles/${styleId}`,
    delete: (styleId: string) => `styles/${styleId}`,
  },

  labelSchemas: {
    list: 'label-schemas',
    create: 'label-schemas',
    detail: (id: string) => `label-schemas/${id}`,
    delete: (id: string) => `label-schemas/${id}`,
  },

  trackedObjects: {
    list: 'tracked-objects',
    create: 'tracked-objects',
    detail: (id: string) => `tracked-objects/${id}`,
    update: (id: string) => `tracked-objects/${id}`,
    delete: (id: string) => `tracked-objects/${id}`,
    merge: 'tracked-objects/merge',
    observations: (id: string) => `tracked-objects/${id}/observations`,
  },

  models: {
    list: 'models',
    create: 'models',
    detail: (id: string) => `models/${id}`,
    update: (id: string) => `models/${id}`,
    delete: (id: string) => `models/${id}`,
  },

  inference: {
    run: 'inference',
  },

  analysis: {
    timeseries: 'analysis/timeseries',
    changeDetection: 'analysis/change-detection',
  },

  map: {
    /** Call once per session/project change — do not poll. Pass ?project_id= for project mosaic. */
    context: 'map/context',
  },

  alerts: {
    list: 'alerts',
    create: 'alerts',
    detail: (id: string) => `alerts/${id}`,
    updateStatus: (id: string) => `alerts/${id}/status`,
    delete: (id: string) => `alerts/${id}`,
  },

  alertSubscriptions: {
    list: 'alert-subscriptions',
    create: 'alert-subscriptions',
    detail: (id: string) => `alert-subscriptions/${id}`,
    update: (id: string) => `alert-subscriptions/${id}`,
    delete: (id: string) => `alert-subscriptions/${id}`,
  },

  tiles: {
    mosaicRegister: 'tiles/mosaic/register',
    mosaicInfo: (searchId: string) => `tiles/mosaic/${searchId}/info`,
    mosaicTileJson: (searchId: string) => `tiles/mosaic/${searchId}/tilejson.json`,
    mosaicTile: (searchId: string, z: number, x: number, y: number, fmt: string) =>
      `tiles/mosaic/${searchId}/tiles/${z}/${x}/${y}.${fmt}`,
    itemTile: (
      collectionId: string,
      itemId: string,
      z: number,
      x: number,
      y: number,
      fmt: string,
    ) => `tiles/item/${collectionId}/${itemId}/${z}/${x}/${y}.${fmt}`,
  },

  basemaps: {
    list: 'basemaps',
    create: 'basemaps',
    detail: (id: string) => `basemaps/${id}`,
    update: (id: string) => `basemaps/${id}`,
    delete: (id: string) => `basemaps/${id}`,
  },

  bookmarks: {
    list: 'bookmarks',
    create: 'bookmarks',
    detail: (id: string) => `bookmarks/${id}`,
    update: (id: string) => `bookmarks/${id}`,
    delete: (id: string) => `bookmarks/${id}`,
  },

  mapLayers: {
    list: (projectId: string) => `projects/${projectId}/map-layers`,
    create: (projectId: string) => `projects/${projectId}/map-layers`,
    detail: (refId: string) => `map-layers/${refId}`,
    updateStyle: (refId: string) => `map-layers/${refId}/style`,
    delete: (refId: string) => `map-layers/${refId}`,
  },
} as const;
