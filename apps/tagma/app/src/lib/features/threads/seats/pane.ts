import { type PaneContent, projectScopedId, projectScopedOf } from '$lib/shared/panes/pane.js';

export const THREAD_PANE = 'thread';

export type PaneThread = { readonly home: number | null; readonly threadId: string | null };

export function paneThread(id: string | null): PaneThread {
  const scoped = projectScopedOf(id);
  return scoped === null ? { home: null, threadId: id } : { home: scoped.project, threadId: scoped.rest || null };
}

export const threadPaneId = ({ home, threadId }: PaneThread): string | null =>
  home === null ? threadId : projectScopedId(home, threadId ?? '');

export const threadOf = (pane: PaneContent): string | null => (pane.kind === THREAD_PANE ? paneThread(pane.id).threadId : null);
