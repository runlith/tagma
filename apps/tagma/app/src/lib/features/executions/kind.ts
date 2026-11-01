import { projectScopedId, projectScopedOf, type PaneContent } from '$lib/shared/panes/pane.js';

export const TERMINAL_PANE = 'terminal';

type TerminalTabAddress = { readonly projectId: number; readonly key: string };

export const terminalPane = (projectId: number, key: string): PaneContent => ({
  kind: TERMINAL_PANE,
  id: projectScopedId(projectId, key),
});

export function terminalPaneOf(id: string | null, projectId: number): TerminalTabAddress | null {
  if (id === null) return null;
  const scoped = projectScopedOf(id);
  return scoped === null ? { projectId, key: id } : { projectId: scoped.project, key: scoped.rest };
}
