import Copy from '@lucide/svelte/icons/copy';
import MessagesSquare from '@lucide/svelte/icons/messages-square';
import PanelRight from '@lucide/svelte/icons/panel-right';
import type { Resolver } from '@runlith/layer/key';
import { Router } from '@runlith/layer/Router';
import { paneThread, THREAD_PANE } from './seats/pane.js';
import type { Link, LinkItems, LinkKind } from '$lib/features/opening/Link.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { THREAD_LINK, threadLink, type ThreadRef } from '$lib/features/presence/link.js';
import { type OpenTarget, ShellOps, shellActs } from '$lib/features/workspace/ShellOps.js';
import { ThreadNames } from '$lib/shared/threads/Names.svelte.js';
import { Addresses } from '$lib/features/workspace/Addresses.js';
import { ThreadList } from './List.svelte.js';

const open = (app: Resolver, link: Link<ThreadRef>, target: OpenTarget): Promise<void> =>
  shellActs(app.resolve(ShellOps), app.resolve(Notices)).openThread(
    { projectId: link.target.projectId ?? app.resolve(ThreadList).homeOf(link.target.threadId), threadId: link.target.threadId },
    target,
  );

const threads: LinkKind<ThreadRef> = {
  kind: THREAD_LINK,
  what: (app, link) => {
    const { threadId, projectId } = link.target;
    return (
      app
        .resolve(ThreadNames)
        .of(threadId, projectId === undefined ? undefined : String(projectId))
        ?.label.trim() || threadId
    );
  },
  beside: { words: 'Open beside', icon: PanelRight, open: (app, link) => open(app, link, 'beside') },
  full: { words: 'Open in Agents', icon: MessagesSquare, open: (app, link) => open(app, link, 'main') },
  tab: {
    kind: THREAD_PANE,
    link: (_app, id) => {
      const { home, threadId } = paneThread(id);
      return threadId === null ? null : threadLink({ threadId, projectId: home ?? undefined });
    },
  },
};

const copies: LinkItems<ThreadRef> = {
  kind: THREAD_LINK,
  order: 100,
  group: 'copies',
  acts: (app, link) => [
    {
      id: 'copy-link',
      words: 'Copy link',
      icon: Copy,
      run: () => {
        const { threadId, projectId } = link.target;
        const home = app.resolve(ThreadNames).of(threadId, projectId === undefined ? undefined : String(projectId))?.home;
        const router = app.resolve(Router);
        return navigator.clipboard.writeText(new URL(app.resolve(Addresses).thread(threadId, home ?? undefined), router.url).href);
      },
    },
  ],
};

export const links = [threads];

export const items = [copies];
