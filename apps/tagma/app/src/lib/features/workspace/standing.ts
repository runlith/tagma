import { type GraphAim, GraphRung } from './GraphRung.js';
import { type ProjectAim, ProjectRung } from './ProjectRung.js';
import type { SurfaceDeclaration } from './surface.js';

export function standingKey(
  stands: SurfaceDeclaration['stands'],
  project: ProjectAim | undefined,
  graph: GraphAim | undefined,
): string | null {
  if (stands === 'project') return project === undefined ? null : `project:${ProjectRung.keyOf(project)}`;
  return graph === undefined ? null : `graph:${GraphRung.keyOf(graph)}`;
}
