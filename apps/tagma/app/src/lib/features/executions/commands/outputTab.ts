import { projectScopedId, projectScopedOf, type PaneContent } from '$lib/shared/panes/pane.js';
import { terminalAddress, type ExecutionAddress } from '../Repo.js';

export const OUTPUT_TAB = 'command-output';

export type OutputTab = { readonly projectId: number; readonly key: string; readonly address: ExecutionAddress };

export const outputTab = (projectId: number, key: string): PaneContent => ({ kind: OUTPUT_TAB, id: projectScopedId(projectId, key) });

export function outputTabOf(id: string | null): OutputTab | null {
  const scoped = projectScopedOf(id);
  const address = scoped === null ? null : terminalAddress(scoped.rest);
  return scoped === null || address === null ? null : { projectId: scoped.project, key: scoped.rest, address };
}
