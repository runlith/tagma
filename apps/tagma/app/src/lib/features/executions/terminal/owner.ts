import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
import { holdProject } from '$lib/features/workspace/holds.js';
import { terminalPaneOf } from '../kind.js';
import { Terminals } from '../worktrees/Terminals.svelte.js';

export function holdTerminal(id: string | null): Terminals {
  const own = ProjectRung.Current.use().projectId;
  const place = terminalPaneOf(id, own);
  if (place !== null && place.projectId !== own) holdProject(place.projectId);
  return Terminals.use();
}
