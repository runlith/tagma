import type { Scope } from '@runlith/layer/Scope';
import { App } from '@runlith/layer/svelte/App.svelte';
import { ProjectRung } from './ProjectRung.js';
import { Workspace } from './Selection.svelte.js';
import { TileRung } from './TileRung.js';

export function holdProject(projectId: number): Scope {
  App.hold(TileRung, { tileId: Workspace.use().tileIdOf(projectId) });
  return App.hold(ProjectRung, { projectId });
}
