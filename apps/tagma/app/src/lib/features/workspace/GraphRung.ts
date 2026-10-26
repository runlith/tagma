import { Router } from '@runlith/layer/Router';
import { Rung } from '@runlith/layer/Rung';
import { ProjectRung } from './ProjectRung.js';
import { Workspace } from './Selection.svelte.js';

export type GraphAim = { readonly projectId: number; readonly branch: string | null };

export const GraphRung = Rung.define<GraphAim>()('graph', {
  keyOf: ({ projectId, branch }) => `${projectId}:${branch ?? ''}`,
  under: ProjectRung,
});

export const GraphRungSource = GraphRung.from([Router, Workspace], (router, workspace) => {
  const project = workspace.contextProject;
  if (project === null) return undefined;
  return { projectId: project.id, branch: router.url.searchParams.get('branch') };
});
