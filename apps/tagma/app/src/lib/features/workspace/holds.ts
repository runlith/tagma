import type { Scope } from '@runlith/layer/Scope';
import { App } from '@runlith/layer/svelte/App.svelte';
import { GraphRung, type GraphAim } from './GraphRung.js';
import { ProjectRung } from './ProjectRung.js';
import { Workspace } from './Selection.svelte.js';
import { TileRung } from './TileRung.js';
import { Visits } from './Visits.svelte.js';

export function holdProject(projectId: number): Scope {
  App.hold(TileRung, { tileId: Workspace.use().tileIdOf(projectId) });
  return App.hold(ProjectRung, { projectId });
}

export function holdGraph(aim: GraphAim): Scope {
  holdProject(aim.projectId);
  return App.hold(GraphRung, aim);
}

export function holdGraphOf(projectId: number): Scope {
  const project = Workspace.use().find(projectId);
  const here = GraphRung.Source.use()();
  return holdGraph(project === null ? { projectId, branch: null } : Visits.use().aimOf(project, here));
}
