import { apiClient } from './client';
import { EP } from './endpoints';
import type {
  Pipeline,
  PipelineRun,
  RunDetailRead,
  PipelineRunStep,
  NodeCatalogResponse,
  ReactFlowGraph,
  GraphValidationResult,
} from '@/types/api';
import type { PaginatedResponse } from '@/types/common';

export const automationApi = {
  // ── Node Catalog ──────────────────────────────────────────────────────────

  getNodeCatalog: () =>
    apiClient.get(EP.automation.nodeCatalog).json<NodeCatalogResponse>(),

  // ── Pipelines ─────────────────────────────────────────────────────────────

  listPipelines: (params?: Record<string, string>) =>
    apiClient
      .get(EP.automation.pipelines, { searchParams: params })
      .json<PaginatedResponse<Pipeline>>(),

  getPipeline: (id: string) =>
    apiClient.get(EP.automation.pipelineDetail(id)).json<Pipeline>(),

  createPipeline: (data: {
    name: string;
    description?: string;
    project_id?: string;
    trigger_type: string;
    trigger_config?: Record<string, unknown>;
    graph?: ReactFlowGraph;
  }) =>
    apiClient
      .post(EP.automation.pipelines, { json: data })
      .json<Pipeline>(),

  updatePipeline: (
    id: string,
    data: Partial<Pick<Pipeline, 'name' | 'description' | 'trigger_type' | 'trigger_config' | 'graph' | 'status'>>,
  ) =>
    apiClient
      .patch(EP.automation.pipelineDetail(id), { json: data })
      .json<Pipeline>(),

  deletePipeline: (id: string) =>
    apiClient.delete(EP.automation.pipelineDetail(id)).json<void>(),

  validatePipeline: (id: string) =>
    apiClient
      .post(EP.automation.pipelineValidate(id))
      .json<GraphValidationResult>(),

  duplicatePipeline: (id: string) =>
    apiClient
      .post(EP.automation.pipelineDuplicate(id))
      .json<Pipeline>(),

  // ── Runs ──────────────────────────────────────────────────────────────────

  runPipeline: (id: string) =>
    apiClient
      .post(EP.automation.pipelineRun(id))
      .json<PipelineRun>(),

  listPipelineRuns: (pipelineId: string, params?: Record<string, string>) =>
    apiClient
      .get(EP.automation.pipelineRuns(pipelineId), { searchParams: params })
      .json<PaginatedResponse<PipelineRun>>(),

  getRunDetail: (runId: string) =>
    apiClient.get(EP.automation.runDetail(runId)).json<RunDetailRead>(),

  cancelRun: (runId: string) =>
    apiClient.post(EP.automation.runCancel(runId)).json<PipelineRun>(),

  retryRun: (runId: string) =>
    apiClient.post(EP.automation.runRetry(runId)).json<PipelineRun>(),

  // ── Steps ─────────────────────────────────────────────────────────────────

  getRunSteps: (runId: string) =>
    apiClient.get(EP.automation.runSteps(runId)).json<PipelineRunStep[]>(),

  getRunStepDetail: (runId: string, stepId: string) =>
    apiClient
      .get(EP.automation.runStepDetail(runId, stepId))
      .json<PipelineRunStep>(),

  // ── Cross-pipeline runs ───────────────────────────────────────────────────

  listProjectRuns: (projectId: string, params?: Record<string, string>) =>
    apiClient
      .get(EP.automation.projectRuns(projectId), { searchParams: params })
      .json<PaginatedResponse<PipelineRun>>(),
};
