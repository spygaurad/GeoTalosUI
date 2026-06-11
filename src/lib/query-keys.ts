/**
 * TanStack Query key factory.
 * Keys are org-scoped automatically via the Clerk JWT — no org_id needed in keys.
 */
export const qk = {
  projects: {
    list: () => ['projects'] as const,
    detail: (id: string) => ['projects', id] as const,
    members: (id: string) => ['projects', id, 'members'] as const,
  },

  maps: {
    list: (projectId?: string) => ['maps', projectId] as const,
    detail: (id: string) => ['maps', 'detail', id] as const,
    /** Datasets attached to a map. */
    datasets: (mapId: string) => ['maps', mapId, 'datasets'] as const,
    /** Resources intersecting an arbitrary AOI bbox (datasets, items, vectors, raster masks). */
    aoiResources: (mapId: string, bbox: string) => ['maps', mapId, 'aoi-resources', bbox] as const,
    /** Dataset items intersecting an arbitrary AOI bbox (for ad-hoc, unsaved AOIs). */
    datasetItemsInAoi: (mapId: string, datasetId: string, bbox: string) =>
      ['maps', mapId, 'datasets', datasetId, 'items-in-aoi', bbox] as const,
  },

  mapAois: {
    /** List of saved AOIs on a map. */
    list: (mapId: string) => ['maps', mapId, 'aois'] as const,
    /** One saved AOI. */
    detail: (mapId: string, aoiId: string) => ['maps', mapId, 'aois', aoiId] as const,
    /** Saved selection (datasets/items/filters) for an AOI. */
    selection: (mapId: string, aoiId: string) =>
      ['maps', mapId, 'aois', aoiId, 'selection'] as const,
    /** Saved render config (bands/rescale/colormap) for an AOI. */
    rendering: (mapId: string, aoiId: string) =>
      ['maps', mapId, 'aois', aoiId, 'rendering'] as const,
    timeline: (mapId: string, aoiId: string) => ['maps', mapId, 'aois', aoiId, 'timeline'] as const,
    timelineManifest: (mapId: string, aoiId: string) => ['maps', mapId, 'aois', aoiId, 'timeline-manifest'] as const,
    tileJson: (mapId: string, aoiId: string) => ['maps', mapId, 'aois', aoiId, 'tilejson'] as const,
  },

  datasets: {
    list: (params?: Record<string, unknown>) => ['datasets', params] as const,
    detail: (id: string) => ['datasets', id] as const,
    items: (id: string, params?: Record<string, unknown>) =>
      ['datasets', id, 'items', params] as const,
  },

  annotations: {
    list: (params: Record<string, unknown>) => ['annotations', params] as const,
    detail: (id: string) => ['annotations', id] as const,
    versions: (id: string) => ['annotations', id, 'versions'] as const,
  },

  annotationSets: {
    listByProject: (projectId: string) => ['annotation-sets', 'project', projectId] as const,
    listByMap: (mapId: string) => ['annotation-sets', 'map', mapId] as const,
    detail: (id: string) => ['annotation-sets', id] as const,
    features: (id: string) => ['annotation-sets', id, 'features'] as const,
  },

  annotationSchemas: {
    list: (params?: Record<string, unknown>) => ['annotation-schemas', params] as const,
    detail: (id: string) => ['annotation-schemas', id] as const,
    classes: (schemaId: string) => ['annotation-schemas', schemaId, 'classes'] as const,
    classDetail: (schemaId: string, classId: string) =>
      ['annotation-schemas', schemaId, 'class', classId] as const,
  },

  labelSchemas: {
    list: (params?: Record<string, unknown>) => ['label-schemas', params] as const,
    detail: (id: string) => ['label-schemas', id] as const,
  },

  tracking: {
    list: (params?: Record<string, unknown>) => ['tracked-objects', params] as const,
    detail: (id: string) => ['tracked-objects', id] as const,
    observations: (id: string) => ['tracked-objects', id, 'observations'] as const,
  },

  alerts: {
    list: (params?: Record<string, unknown>) => ['alerts', params] as const,
    detail: (id: string) => ['alerts', id] as const,
  },

  models: {
    list: (params?: Record<string, unknown>) => ['models', params] as const,
    detail: (id: string) => ['models', id] as const,
  },

  adapters: {
    list: () => ['inference-adapters'] as const,
  },

  jobs: {
    /** Backend only exposes individual job detail — no list endpoint. */
    detail: (id: string) => ['jobs', id] as const,
  },

  settings: {
    apiKeys: () => ['api-keys'] as const,
    basemaps: (params?: Record<string, unknown>) => ['basemaps', params] as const,
    bookmarks: (params?: Record<string, unknown>) => ['bookmarks', params] as const,
  },

  stac: {
    collections: () => ['stac-collections'] as const,
    search: (params: Record<string, unknown>) => ['stac-search', params] as const,
  },

  mapLayers: {
    refs: (projectId: string) => ['mapLayers', 'refs', projectId] as const,
    refData: (refId: string) => ['mapLayers', 'refData', refId] as const,
  },
  automation: {
    nodeCatalog: () => ['automation', 'node-catalog'] as const,
    pipelines: (params?: Record<string, unknown>) => ['automation', 'pipelines', params] as const,
    pipelineDetail: (id: string) => ['automation', 'pipelines', id] as const,
    pipelineRuns: (pipelineId: string) => ['automation', 'pipelines', pipelineId, 'runs'] as const,
    runDetail: (runId: string) => ['automation', 'runs', runId] as const,
    runSteps: (runId: string) => ['automation', 'runs', runId, 'steps'] as const,
    runStepDetail: (runId: string, stepId: string) =>
      ['automation', 'runs', runId, 'steps', stepId] as const,
  },
} as const;
