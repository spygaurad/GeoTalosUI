'use client';

import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  ReactFlow,
  addEdge,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  BackgroundVariant,
  MarkerType,
  type Connection,
  type Node,
  type Edge,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import PipelineNode, { type PipelineNodeData } from './PipelineNode';
import { NodeCatalog } from './NodeCatalog';
import { PipelineToolbar } from './PipelineToolbar';
import { RunsPanel } from './RunsPanel';
import { PipelineProvider } from './PipelineContext';
import { automationApi } from '@/lib/api/automation';
import { qk } from '@/lib/query-keys';
import type { NodeCatalogEntry } from '@/types/api';
import { isDisplayNode } from './frontend-display-nodes';

// ── Node types ────────────────────────────────────────────────────────────────

const nodeTypes = {
  pipeline: PipelineNode,
};

// ── Shared edge styles ────────────────────────────────────────────────────────

const ARROW_MARKER = {
  type: MarkerType.ArrowClosed,
  width: 14,
  height: 14,
  color: '#c4985c',
};

// ── Edge legend tooltip ───────────────────────────────────────────────────────

function EdgeLegend() {
  const [show, setShow] = useState(false);
  return (
    <div
      className="relative"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <button
        className="px-2 py-1 rounded-md"
        style={{
          fontSize: '10px',
          fontWeight: 500,
          color: '#7f5539',
          backgroundColor: '#fefcf9',
          border: '1px solid #d4c0a8',
          cursor: 'pointer',
          boxShadow: '0 1px 4px rgba(46,52,40,0.08)',
        }}
      >
        Edge legend
      </button>
      {show && (
        <div
          className="absolute bottom-full left-0 mb-2"
          style={{
            width: '200px',
            backgroundColor: '#fefcf9',
            border: '1px solid #d4c0a8',
            borderRadius: '6px',
            padding: '10px 12px',
            boxShadow: '0 4px 16px rgba(46,52,40,0.12)',
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            <svg width="40" height="8">
              <line x1="0" y1="4" x2="40" y2="4" stroke="#c4985c" strokeWidth="1.5" />
              <polygon points="36,1 40,4 36,7" fill="#c4985c" />
            </svg>
            <span style={{ fontSize: '10px', color: '#6b5d4e' }}>Data flow (solid)</span>
          </div>
          <div className="flex items-center gap-2">
            <svg width="40" height="8">
              <line x1="0" y1="4" x2="40" y2="4" stroke="#c4985c" strokeWidth="1.5" strokeDasharray="4 2" />
              <polygon points="36,1 40,4 36,7" fill="#c4985c" />
            </svg>
            <span style={{ fontSize: '10px', color: '#6b5d4e' }}>Event trigger (dashed)</span>
          </div>
          <p style={{ fontSize: '9px', color: '#b0a090', marginTop: '6px' }}>
            Arrows show data direction. Dashed edges indicate event-driven connections.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Convert API graph nodes to ReactFlow nodes */
function toRfNodes(apiNodes: Array<Record<string, unknown>>): Node[] {
  return apiNodes.map((n) => ({
    id: n.id as string,
    type: 'pipeline',
    position: n.position as { x: number; y: number },
    data: n.data as Record<string, unknown>,
    width: n.width as number | undefined,
    height: n.height as number | undefined,
  }));
}

/** Convert API graph edges to ReactFlow edges with our styling */
function toRfEdges(apiEdges: Array<Record<string, unknown>>): Edge[] {
  return apiEdges.map((e) => ({
    id: e.id as string,
    source: e.source as string,
    target: e.target as string,
    sourceHandle: e.sourceHandle as string,
    targetHandle: e.targetHandle as string,
    type: 'smoothstep',
    animated: (e.animated as boolean) ?? false,
    style: {
      stroke: '#c4985c',
      strokeWidth: 1.5,
      strokeDasharray: (e.animated as boolean) ? '6 3' : undefined,
    },
    markerEnd: ARROW_MARKER,
  }));
}

/** Extract defaults from JSON Schema config_schema */
function extractDefaults(configSchema: Record<string, unknown>): Record<string, unknown> {
  const properties = (configSchema.properties ?? configSchema) as Record<string, Record<string, unknown>>;
  const defaults: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(properties)) {
    if (typeof val === 'object' && val !== null && 'default' in val) {
      defaults[key] = val.default;
    }
  }
  return defaults;
}

// ── Builder ──────────────────────────────────────────────────────────────────

interface PipelineBuilderContentProps {
  workspaceId: string;
  projectId: string;
  pipelineId: string;
}

export function PipelineBuilderContent({
  workspaceId,
  projectId,
  pipelineId,
}: PipelineBuilderContentProps) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const isNew = pipelineId === 'new';

  // Track the real pipeline ID — starts null for new, set after first save
  const [savedId, setSavedId] = useState<string | null>(isNew ? null : pipelineId);

  // Editable pipeline name & UI state
  const [localName, setLocalName] = useState<string>(isNew ? 'New Pipeline' : '');
  const [showRuns, setShowRuns] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // ── Load pipeline ────────────────────────────────────────────────────────
  const { data: pipeline, isLoading: pipelineLoading, isError: pipelineError } = useQuery({
    queryKey: qk.automation.pipelineDetail(pipelineId),
    queryFn: () => automationApi.getPipeline(pipelineId),
    enabled: !isNew,
  });

  // ── Load node catalog ────────────────────────────────────────────────────
  const { data: catalog, isLoading: catalogLoading, isError: catalogError } = useQuery({
    queryKey: qk.automation.nodeCatalog(),
    queryFn: () => automationApi.getNodeCatalog(),
    staleTime: 5 * 60 * 1000, // 5 minutes — catalog rarely changes (#21)
  });

  // ── ReactFlow state ──────────────────────────────────────────────────────
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([] as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([] as Edge[]);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const initializedRef = useRef(false);
  const savedViewportRef = useRef<{ x: number; y: number; zoom: number } | null>(null);

  // Initialize graph from pipeline data once loaded
  useEffect(() => {
    if (!pipeline?.graph || initializedRef.current) return;
    const graphNodes = pipeline.graph.nodes as unknown as Array<Record<string, unknown>>;
    const graphEdges = pipeline.graph.edges as unknown as Array<Record<string, unknown>>;
    if (graphNodes.length > 0 || graphEdges.length > 0) {
      setNodes(toRfNodes(graphNodes));
      setEdges(toRfEdges(graphEdges));
    }
    // Store viewport for restore after init (#14)
    if (pipeline.graph.viewport) {
      savedViewportRef.current = pipeline.graph.viewport as { x: number; y: number; zoom: number };
    }
    initializedRef.current = true;
  }, [pipeline, setNodes, setEdges]);

  // Restore viewport when rfInstance is ready (#14)
  useEffect(() => {
    if (rfInstance && savedViewportRef.current) {
      rfInstance.setViewport(savedViewportRef.current);
      savedViewportRef.current = null;
    }
  }, [rfInstance]);

  // For new pipelines, mark as initialized
  useEffect(() => {
    if (isNew) {
      initializedRef.current = true;
    }
  }, [isNew]);

  // Dirty state tracking (#20)
  useEffect(() => {
    if (!initializedRef.current) return;
    setIsDirty(true);
  }, [nodes, edges]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // ── Helper: build graph payload (#5 — use real nodeType, not 'pipeline') ─
  const buildGraph = useCallback((): import('@/types/api').ReactFlowGraph => {
    const viewport = rfInstance?.getViewport();

    // Filter out frontend-only display nodes — they never go to the backend
    const backendNodes = nodes.filter((n) => {
      const d = n.data as PipelineNodeData;
      return !isDisplayNode(d.nodeType);
    });
    const displayNodeIds = new Set(
      nodes.filter((n) => isDisplayNode((n.data as PipelineNodeData).nodeType)).map((n) => n.id),
    );
    const backendEdges = edges.filter(
      (e) => !displayNodeIds.has(e.source) && !displayNodeIds.has(e.target),
    );

    return {
      nodes: backendNodes.map((n) => {
        const d = n.data as PipelineNodeData;
        return {
          id: n.id,
          type: d.nodeType ?? 'unknown',
          position: n.position,
          data: { ...d, config: d.config ?? {} },
          width: n.measured?.width,
          height: n.measured?.height,
        } as import('@/types/api').ReactFlowNode;
      }),
      edges: backendEdges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? null,
        targetHandle: e.targetHandle ?? null,
        animated: e.animated,
      })) as import('@/types/api').ReactFlowEdge[],
      viewport: viewport ?? null,
    };
  }, [nodes, edges, rfInstance]);

  // ── Save mutation (create for new, update for existing) ────────────────
  const saveMutation = useMutation({
    mutationFn: async () => {
      const graph = buildGraph();

      if (!savedId) {
        const created = await automationApi.createPipeline({
          name: localName || 'Untitled Pipeline',
          project_id: projectId,
          trigger_type: 'manual',
          graph,
        });
        return created;
      }

      return automationApi.updatePipeline(savedId, { graph });
    },
    onSuccess: (result) => {
      setIsDirty(false);
      if (!savedId) {
        setSavedId(result.id);
        toast.success('Pipeline created');
        router.replace(
          `/workspace/${workspaceId}/projects/${projectId}/automations/${result.id}`,
        );
      } else {
        toast.success('Pipeline saved');
      }
      queryClient.invalidateQueries({ queryKey: qk.automation.pipelineDetail(result.id) });
      queryClient.invalidateQueries({ queryKey: qk.automation.pipelines({ project_id: projectId }) });
    },
    onError: (err) => {
      toast.error(`Save failed: ${(err as Error).message}`);
    },
  });

  // ── Run mutation — save, validate, then run (#4) ─────────────────────────
  const runMutation = useMutation({
    mutationFn: async () => {
      let runId = savedId;

      if (!runId) {
        const graph = buildGraph();
        const created = await automationApi.createPipeline({
          name: localName || 'Untitled Pipeline',
          project_id: projectId,
          trigger_type: 'manual',
          graph,
        });
        runId = created.id;
        setSavedId(runId);
        router.replace(
          `/workspace/${workspaceId}/projects/${projectId}/automations/${runId}`,
        );
      } else {
        const graph = buildGraph();
        await automationApi.updatePipeline(runId, { graph });
      }

      // Validate before running (#4)
      const validation = await automationApi.validatePipeline(runId);
      if (!validation.valid) {
        const msgs = validation.errors.map((e) => e.message).join('; ');
        throw new Error(msgs || 'Graph validation failed');
      }

      return automationApi.runPipeline(runId);
    },
    onSuccess: (run) => {
      setIsDirty(false);
      const runDisplayId = run.id;
      toast.success('Pipeline run started', {
        description: runDisplayId ? `Run ${runDisplayId.slice(0, 8)}...` : undefined,
      });
      setShowRuns(true);
      queryClient.invalidateQueries({ queryKey: qk.automation.pipelineRuns(savedId!) });
      queryClient.invalidateQueries({ queryKey: qk.automation.pipelines({ project_id: projectId }) });
    },
    onError: (err) => {
      toast.error(`Run failed: ${(err as Error).message}`);
    },
  });

  // ── Rename handler ──────────────────────────────────────────────────────
  const handleNameChange = useCallback(
    (name: string) => {
      setLocalName(name);
      if (savedId) {
        automationApi.updatePipeline(savedId, { name }).then(() => {
          queryClient.invalidateQueries({ queryKey: qk.automation.pipelineDetail(savedId) });
          queryClient.invalidateQueries({ queryKey: qk.automation.pipelines({ project_id: projectId }) });
        });
      }
    },
    [savedId, projectId, queryClient],
  );

  // ── Connection type validation (#2) ───────────────────────────────────────
  const isValidConnection = useCallback(
    (connection: Edge | Connection) => {
      const sourceNode = nodes.find((n) => n.id === connection.source);
      const targetNode = nodes.find((n) => n.id === connection.target);
      if (!sourceNode || !targetNode) return false;

      const sourceData = sourceNode.data as PipelineNodeData;
      const targetData = targetNode.data as PipelineNodeData;

      const sourceHandle = sourceData.outputs?.find((o) => o.handle === connection.sourceHandle);
      const targetHandle = targetData.inputs?.find((i) => i.handle === connection.targetHandle);
      if (!sourceHandle || !targetHandle) return false;

      // 'any' type connects to anything
      if (targetHandle.type === 'any' || sourceHandle.type === 'any') return true;
      return sourceHandle.type === targetHandle.type;
    },
    [nodes],
  );

  // ── Handlers ─────────────────────────────────────────────────────────────
  const onConnect = useCallback(
    (params: Connection) =>
      setEdges((eds) => {
        const newEdge = addEdge(params, eds);
        return newEdge.map((e) =>
          e.id === newEdge[newEdge.length - 1]?.id
            ? {
                ...e,
                type: 'smoothstep',
                style: { stroke: '#c4985c', strokeWidth: 1.5 },
                markerEnd: ARROW_MARKER,
              }
            : e,
        );
      }),
    [setEdges],
  );

  // Clean up orphaned edges when nodes are deleted (#7)
  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      const deletedIds = new Set(deleted.map((n) => n.id));
      setEdges((eds) => eds.filter((e) => !deletedIds.has(e.source) && !deletedIds.has(e.target)));
    },
    [setEdges],
  );

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData('application/reactflow-node');
      if (!raw || !rfInstance) return;

      const entry: NodeCatalogEntry = JSON.parse(raw);
      const position = rfInstance.screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      });

      // Use crypto.randomUUID for collision-safe node IDs (#8)
      const newNode: Node = {
        id: crypto.randomUUID(),
        type: 'pipeline',
        position,
        data: {
          nodeType: entry.type,
          label: entry.label,
          category: entry.category,
          description: entry.description,
          inputs: entry.inputs,
          outputs: entry.outputs,
          config: extractDefaults(entry.config_schema),
          config_schema: entry.config_schema,
          status: entry.status,
          icon: entry.icon,
        } satisfies PipelineNodeData,
      };

      setNodes((nds) => [...nds, newNode]);
    },
    [rfInstance, setNodes],
  );

  // ── Derived state ────────────────────────────────────────────────────────
  const pipelineName = localName || pipeline?.name || (isNew ? 'New Pipeline' : 'Loading...');
  const pipelineStatus = pipeline?.status ?? 'draft';
  const categories = catalog?.categories ?? [];

  // ── Loading / error states (#16) ──────────────────────────────────────────
  if (pipelineLoading && !isNew) {
    return (
      <div className="flex items-center justify-center h-full" style={{ backgroundColor: '#f5ede0' }}>
        <div className="text-center">
          <div
            className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin mx-auto mb-3"
            style={{ borderColor: '#c4985c', borderTopColor: 'transparent' }}
          />
          <p style={{ fontSize: '0.8125rem', color: '#9a8878' }}>Loading pipeline...</p>
        </div>
      </div>
    );
  }

  if (pipelineError && !isNew) {
    return (
      <div className="flex items-center justify-center h-full" style={{ backgroundColor: '#f5ede0' }}>
        <div className="text-center">
          <p style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#b35e4c', marginBottom: '8px' }}>
            Failed to load pipeline
          </p>
          <p style={{ fontSize: '0.8125rem', color: '#9a8878', marginBottom: '16px' }}>
            The pipeline may have been deleted or you may not have access.
          </p>
          <button
            onClick={() => router.push(`/workspace/${workspaceId}/projects/${projectId}/automations`)}
            className="px-4 py-2 rounded-lg"
            style={{ fontSize: '0.8125rem', fontWeight: 500, backgroundColor: '#7f5539', color: '#f5ede0', border: 'none', cursor: 'pointer' }}
          >
            Back to automations
          </button>
        </div>
      </div>
    );
  }

  return (
    <PipelineProvider projectId={projectId} workspaceId={workspaceId}>
    <div className="flex flex-col h-full overflow-hidden">
      <PipelineToolbar
        pipelineName={pipelineName}
        pipelineStatus={pipelineStatus}
        workspaceId={workspaceId}
        projectId={projectId}
        onSave={() => saveMutation.mutate()}
        onRun={() => runMutation.mutate()}
        onNameChange={handleNameChange}
        onToggleRuns={savedId ? () => setShowRuns((v) => !v) : undefined}
        showRuns={showRuns}
        onZoomIn={() => rfInstance?.zoomIn()}
        onZoomOut={() => rfInstance?.zoomOut()}
        onFitView={() => rfInstance?.fitView({ padding: 0.2 })}
        isSaving={saveMutation.isPending}
        isRunning={runMutation.isPending}
      />

      <div className="flex flex-1 overflow-hidden">
        <NodeCatalog
          categories={categories}
          isLoading={catalogLoading}
          isError={catalogError}
        />

        <div
          ref={reactFlowWrapper}
          className="flex-1 relative"
          style={{ backgroundColor: '#f5ede0' }}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodesDelete={onNodesDelete}
            isValidConnection={isValidConnection}
            onInit={setRfInstance}
            onDrop={onDrop}
            onDragOver={onDragOver}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            defaultEdgeOptions={{
              type: 'smoothstep',
              style: { stroke: '#c4985c', strokeWidth: 1.5 },
              markerEnd: ARROW_MARKER,
            }}
            connectionLineStyle={{ stroke: '#c4985c', strokeWidth: 1.5 }}
            proOptions={{ hideAttribution: true }}
            style={{ backgroundColor: '#f5ede0' }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={1}
              color="#d4c0a8"
            />
            <Controls
              position="bottom-right"
              showInteractive={false}
              style={{
                borderRadius: '8px',
                border: '1px solid #d4c0a8',
                boxShadow: '0 2px 8px rgba(46,52,40,0.08)',
                overflow: 'hidden',
              }}
            />
          </ReactFlow>

          <div className="absolute bottom-3 left-3 flex items-center gap-3" style={{ zIndex: 10 }}>
            <EdgeLegend />
            <span style={{ fontSize: '10px', fontStyle: 'italic', color: '#b0a090' }}>
              Drag nodes onto the canvas
            </span>
          </div>
        </div>

        {showRuns && savedId && (
          <RunsPanel pipelineId={savedId} onClose={() => setShowRuns(false)} />
        )}
      </div>
    </div>
    </PipelineProvider>
  );
}
