import { Rung } from '@runlith/layer/Rung';
import { Workspace } from './Selection.svelte.js';
import { TileRung } from './TileRung.js';

export type ProjectAim = { readonly projectId: number };

export const ProjectRung = Rung.define<ProjectAim>()('project', { keyOf: ({ projectId }) => String(projectId), under: TileRung });

export const ProjectRungSource = ProjectRung.from(Workspace, (workspace) => {
  const project = workspace.contextProject;
  return project === null ? undefined : { projectId: project.id };
});
