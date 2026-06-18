import { apiClient } from './client';
import { EP } from './endpoints';
import type { Project, ProjectMember } from '@/types/api';
import type { PaginatedResponse } from '@/types/common';

export const projectsApi = {
  list: () =>
    apiClient.get(EP.projects.list).json<PaginatedResponse<Project>>(),

  get: (id: string) =>
    apiClient.get(EP.projects.detail(id)).json<Project>(),

  create: (data: { name: string; description?: string }) =>
    apiClient.post(EP.projects.create, { json: data }).json<Project>(),

  update: (id: string, data: Partial<Pick<Project, 'name' | 'description'>>) =>
    apiClient.patch(EP.projects.update(id), { json: data }).json<Project>(),

  delete: (id: string) =>
    apiClient.delete(EP.projects.delete(id)).json<void>(),

  listMembers: (id: string) =>
    apiClient.get(EP.projects.members(id)).json<ProjectMember[]>(),
};
