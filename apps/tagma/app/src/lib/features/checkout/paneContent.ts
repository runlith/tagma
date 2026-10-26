import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
import { type PaneContent, projectScopedId, projectScopedOf } from '$lib/shared/panes/pane.js';

export type FileAt = { readonly line: number; readonly column: number | null };

export type FileTarget = {
  readonly projectId: number | null;
  readonly rootId: RootId | null;
  readonly path: string;
  readonly at: FileAt | null;
};

export const CHANGES_PANE = 'changes';

export const FILE_PANE = 'file';

export const COMMIT_PANE = 'commit';

export const changesPane: PaneContent = { kind: CHANGES_PANE, id: CHANGES_PANE };

type Stored = readonly [projectId: number | null, rootId: string | null, path: string, line: number | null, column: number | null];

export const filePane = (target: FileTarget): PaneContent => ({
  kind: FILE_PANE,
  id: JSON.stringify([target.projectId, target.rootId, target.path, target.at?.line ?? null, target.at?.column ?? null] satisfies Stored),
});

const whole = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0;

export function fileTargetOf(id: string | null): FileTarget | null {
  let stored: unknown;
  try {
    stored = JSON.parse(id ?? 'null');
  } catch {
    return null;
  }
  if (!Array.isArray(stored) || stored.length !== 5) return null;
  const [projectId, rootId, path, line, column] = stored as unknown[];
  if (!(projectId === null || whole(projectId)) || !(rootId === null || (typeof rootId === 'string' && rootId !== ''))) return null;
  if (typeof path !== 'string' || path === '' || (rootId === null) !== (projectId === null)) return null;
  return {
    projectId,
    rootId: rootId as RootId | null,
    path,
    at: whole(line) ? { line, column: whole(column) ? column : null } : null,
  };
}

export const sameFile = (one: FileTarget | null, two: FileTarget): boolean =>
  one !== null && one.projectId === two.projectId && one.rootId === two.rootId && one.path === two.path;

export const commitPaneId = (projectId: number, sha: string): string => projectScopedId(projectId, sha);

export function commitOf(id: string | null): { readonly projectId: number; readonly sha: string } | null {
  const scoped = projectScopedOf(id);
  return scoped === null || !/^[0-9a-f]{7,64}$/u.test(scoped.rest) ? null : { projectId: scoped.project, sha: scoped.rest };
}

export const commitPane = (projectId: number, sha: string): PaneContent => ({ kind: COMMIT_PANE, id: commitPaneId(projectId, sha) });
